/**
 * Mastra Tools — CarShine Red Sea multi-agent system
 *
 * Six tools wired up for the agents defined in `./router-agent.js`,
 * `./intake-agent.js`, `./booking-agent.js`, `./handoff-agent.js`:
 *
 *   1. lookupCustomerTool       — returns past bookings for a phone + Mem0
 *   2. checkSlotTool            — checks whether a (date, time) slot has capacity
 *   3. suggestAlternativesTool  — finds 3 open slots on the same date
 *   4. createBookingTool        — persists a booking (calls db.createBooking)
 *   5. findCustomerBookingTool  — looks up a customer's bookings
 *   6. escalateToHumanTool      — creates a handoff_tickets row
 *
 * Each tool uses `createTool` from `@mastra/core/tools` with a Zod input schema.
 * The `execute` function is a thin wrapper around the existing
 * `service-agent/database.js` API + a small Mem0 stub.
 *
 * Design notes
 * ------------
 * - Tools are deliberately small and pure: no LLM calls, no async I/O beyond
 *   better-sqlite3 (synchronous) and an in-memory Mem0 stub. This makes them
 *   safe to call from tests without an OPENAI_API_KEY.
 * - All "side effects" (db.createBooking, handoff ticket creation) live in
 *   these tools — agents never touch the DB directly. This is what the
 *   AGENT_PROMPTS.md doc requires.
 * - `execute` is also exported as a plain function (e.g. `lookupCustomer`)
 *   so the orchestrator + tests can call them without going through the
 *   Mastra runtime.
 */

'use strict';

const { createTool } = require('@mastra/core/tools');
const { z } = require('zod');
const db = require('../database');
const {
  applyHandoffTicketsMigration
} = require('../migrations/001_create_handoff_tickets');
const {
  checkSlotV2,
  suggestAlternativesV2,
  createAgentBooking,
  getBookingsV2ByPhone,
  getBookingV2ByRef: getBookingV2ByRefFromBridge,
  ALL_OPERATING_HOURS: BRIDGE_OPERATING_HOURS
} = require('../services/agent-booking-bridge');

// ---------------------------------------------------------------------------
// Mem0 — real wrapper
//
// `service-agent/memory/mem0.js` does the actual work. In LIVE mode
// (MEM0_API_KEY set) it calls the Mem0 API; in DRY-RUN mode it
// derives a profile from `db.getBookingsByPhone(phone)`. We keep
// the in-memory `_mem0Memory` cache as a write-through layer for
// `mem0Remember` so test code (and any session-scoped overrides)
// can still seed data without round-tripping through Mem0.
// ---------------------------------------------------------------------------

const mem0Wrapper = require('../memory/mem0');

const _mem0Memory = new Map();

/**
 * Translate the wrapper's flat shape into the shape tools.js /
 * callers historically expect:
 *   { phone, customerName, facts: [], updatedAt, totalBookings, lastBooking, firstSeen, preferences, mode }
 *
 * If the live wrapper returned a memory whose `customerName` we can
 * extract, use it. Otherwise fall back to the most recent booking.
 */
function _wrapMem0Result(phone, wrapperResult) {
  if (!wrapperResult) return null;

  // customerName: prefer the most-recent booking if it has one,
  // otherwise null (the wrapper returns no name on its own).
  let customerName = null;
  if (wrapperResult.lastBooking && wrapperResult.lastBooking.customerName) {
    customerName = wrapperResult.lastBooking.customerName;
  }

  // facts: turn the preferences object into a flat list of strings
  // so the existing tools that read `mem0.facts` still work.
  const facts = [];
  const prefs = wrapperResult.preferences || {};
  if (prefs.preferredArea) facts.push('preferredArea: ' + prefs.preferredArea);
  if (prefs.preferredPackage) facts.push('preferredPackage: ' + prefs.preferredPackage);
  if (prefs.preferredPaymentMethod) facts.push('preferredPaymentMethod: ' + prefs.preferredPaymentMethod);
  if (prefs.preferredTimeOfDay) facts.push('preferredTimeOfDay: ' + prefs.preferredTimeOfDay);
  if (wrapperResult.totalBookings) facts.push('totalBookings: ' + wrapperResult.totalBookings);
  if (wrapperResult.firstSeen) facts.push('firstSeen: ' + wrapperResult.firstSeen);

  return {
    phone,
    customerName,
    facts,
    updatedAt: new Date().toISOString(),
    totalBookings: wrapperResult.totalBookings || 0,
    firstSeen: wrapperResult.firstSeen || null,
    lastBooking: wrapperResult.lastBooking || null,
    preferences: wrapperResult.preferences || null,
    mode: wrapperResult.mode || 'dry-run'
  };
}

async function mem0Lookup(phone) {
  if (!phone) return null;

  // 1. Check the in-memory cache first (lets tests / callers seed).
  if (_mem0Memory.has(String(phone))) {
    return _mem0Memory.get(String(phone));
  }

  // 2. Otherwise delegate to the real wrapper.
  try {
    const result = await mem0Wrapper.lookupCustomer({ phone });
    return _wrapMem0Result(phone, result);
  } catch (e) {
    console.warn('[tools/mem0] lookup failed:', e.message);
    return null;
  }
}

async function mem0Remember(phone, payload) {
  if (!phone) return;
  const existing = _mem0Memory.get(String(phone)) || { phone, facts: [], updatedAt: null };
  existing.facts = [...(existing.facts || []), ...(payload.facts || [])].slice(-20);
  existing.updatedAt = new Date().toISOString();
  _mem0Memory.set(String(phone), existing);
}

/** Test helper — clears the in-memory Mem0 cache. */
function _resetMem0ForTests() {
  _mem0Memory.clear();
}

/** Test helper — seed Mem0 with a known value (used by tests). */
function _seedMem0ForTests(phone, value) {
  _mem0Memory.set(String(phone), value);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the handoff_tickets table exists. Idempotent and cheap.
 * Done lazily on first call to `escalateToHumanTool` so we don't slow startup.
 */
let _handoffMigrationApplied = false;
function _ensureHandoffTable() {
  if (_handoffMigrationApplied) return;
  try {
    // `db` exposes the raw better-sqlite3 instance as `db.db`.
    applyHandoffTicketsMigration(db.db);
    _handoffMigrationApplied = true;
  } catch (err) {
    // If the migration cannot run, surface the error — escalation must persist.
    throw new Error('Failed to ensure handoff_tickets table: ' + err.message);
  }
}

/** Generate a ticket id. */
function _newTicketId() {
  return 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

/** Generate a booking id. */
function _newBookingId() {
  return 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// 1. lookupCustomerTool
// ---------------------------------------------------------------------------

const lookupCustomer = async ({ phone }) => {
  if (!phone) return { found: false, phone: null, bookings: [], mem0: null };
  const v2Bookings = getBookingsV2ByPhone(phone);
  const legacyBookings = db.getBookingsByPhone ? db.getBookingsByPhone(phone) : [];
  const safeBookings = v2Bookings.length > 0 ? v2Bookings : legacyBookings;
  const mem0 = await mem0Lookup(phone);
  return {
    found: safeBookings.length > 0 || !!mem0,
    phone,
    bookings: safeBookings,
    mem0,
    customerName: safeBookings[0]?.customerName || mem0?.customerName || null,
    lastBooking: safeBookings[0] || null
  };
};

const lookupCustomerTool = createTool({
  id: 'lookupCustomer',
  description:
    'Look up a returning customer by phone number. Returns past bookings, ' +
    'the most recent booking, and any Mem0-stored preferences. ' +
    'Use this whenever a phone number is known and you want to greet a ' +
    'returning customer by name or reference their last visit.',
  inputSchema: z.object({
    phone: z.string().describe('Customer phone number (E.164 or local format)')
  }),
  outputSchema: z.object({
    found: z.boolean(),
    phone: z.string().nullable(),
    bookings: z.array(z.any()),
    mem0: z.any().nullable(),
    customerName: z.string().nullable(),
    lastBooking: z.any().nullable()
  }),
  execute: async ({ context }) => lookupCustomer(context)
});

// ---------------------------------------------------------------------------
// 2. checkSlotTool
// ---------------------------------------------------------------------------

const checkSlot = ({ date, time }) => checkSlotV2({ date, time });

const checkSlotTool = createTool({
  id: 'checkSlot',
  description:
    'Check whether a (date, HH:MM) slot has capacity for a new booking. ' +
    'Capacity is 2 washes per hour. Returns { isAvailable, currentBookings, capacity, reason }. ' +
    'Use BEFORE calling createBooking. If isAvailable=false, call suggestAlternatives.',
  inputSchema: z.object({
    date: z.string().describe('Booking date in YYYY-MM-DD format'),
    time: z.string().describe('Booking time in HH:MM (24-hour) format')
  }),
  outputSchema: z.object({
    date: z.string(),
    time: z.string(),
    isAvailable: z.boolean(),
    currentBookings: z.number(),
    capacity: z.number(),
    reason: z.string()
  }),
  execute: async ({ context }) => checkSlot(context)
});

// ---------------------------------------------------------------------------
// 3. suggestAlternativesTool
// ---------------------------------------------------------------------------

const ALL_OPERATING_HOURS = BRIDGE_OPERATING_HOURS;

const suggestAlternatives = ({ date, excludeTime, max = 3 } = {}) =>
  suggestAlternativesV2({ date, excludeTime, max });

const suggestAlternativesTool = createTool({
  id: 'suggestAlternatives',
  description:
    'Given a date, return up to 3 HH:MM times on that date that still have ' +
    'capacity (less than 2 bookings in that hour). Use when checkSlot ' +
    'returns isAvailable=false. Optionally exclude a specific time.',
  inputSchema: z.object({
    date: z.string().describe('Booking date in YYYY-MM-DD format'),
    excludeTime: z.string().optional().describe('Optional HH:MM to exclude')
  }),
  outputSchema: z.object({
    date: z.string(),
    alternatives: z.array(z.string()),
    capacity: z.number()
  }),
  execute: async ({ context }) => suggestAlternatives(context)
});

// ---------------------------------------------------------------------------
// 4. createBookingTool
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = [
  'customerName',
  'phone',
  'area',
  'carType',
  'package',
  'preferredDate',
  'preferredTime',
  'location',
  'paymentMethod'
];

const createBooking = (input = {}) => {
  const missing = REQUIRED_FIELDS.filter(
    (f) => !input[f] || String(input[f]).trim() === ''
  );
  if (missing.length) {
    return { bookingCreated: false, bookingId: null, missingFields: missing, error: null };
  }

  const slot = checkSlotV2({
    date: input.preferredDate,
    time: input.preferredTime
  });
  if (!slot.isAvailable) {
    return {
      bookingCreated: false,
      bookingId: null,
      missingFields: null,
      error: 'slot-unavailable',
      alternatives: suggestAlternativesV2({
        date: input.preferredDate,
        excludeTime: input.preferredTime
      }).alternatives
    };
  }

  try {
    const result = createAgentBooking({
      ...input,
      notes: (input.notes ? input.notes + ' ' : '') + 'Created via AI agent'
    });
    if (!result.bookingCreated) {
      return {
        bookingCreated: false,
        bookingId: null,
        missingFields: result.missingFields,
        error: result.error,
        alternatives: result.alternatives
      };
    }
    return {
      bookingCreated: true,
      bookingId: result.bookingId,
      bookingV2Id: result.bookingV2Id,
      missingFields: null,
      error: null,
      booking: result.booking
    };
  } catch (err) {
    return { bookingCreated: false, bookingId: null, missingFields: null, error: err.message };
  }
};

const createBookingTool = createTool({
  id: 'createBooking',
  description:
    'Persist a booking to the database. All 9 required fields must be ' +
    'present (customerName, phone, area, carType, package, preferredDate, ' +
    'preferredTime, location, paymentMethod). Re-validates slot capacity ' +
    'before insert. Returns { bookingCreated, bookingId, missingFields, error }. ' +
    'For InstaPay, the booking is still created with a "Awaiting receipt screenshot" note — admin verifies before approval.',
  inputSchema: z.object({
    customerName: z.string(),
    phone: z.string(),
    area: z.enum(['El Gouna', 'Hurghada', 'Sahl Hasheesh']),
    carType: z.string(),
    package: z.enum(['Trial Wash', 'Smart Plan', 'Premium Plan']),
    preferredDate: z.string().describe('YYYY-MM-DD'),
    preferredTime: z.string().describe('HH:MM 24h, 09:00-17:00'),
    location: z.string(),
    paymentMethod: z.enum([
      'Cash',
      'InstaPay',
      'Vodafone Cash',
      'Orange Cash',
      'Fawry',
      'Bank Transfer'
    ]),
    notes: z.string().optional(),
    chatSessionId: z.string().optional(),
    id: z.string().optional()
  }),
  outputSchema: z.object({
    bookingCreated: z.boolean(),
    bookingId: z.string().nullable(),
    missingFields: z.array(z.string()).nullable(),
    error: z.string().nullable(),
    alternatives: z.array(z.string()).optional(),
    booking: z.any().optional()
  }),
  execute: async ({ context }) => createBooking(context)
});

// ---------------------------------------------------------------------------
// 5. findCustomerBookingTool
// ---------------------------------------------------------------------------

const findCustomerBooking = ({ phone }) => {
  if (!phone) return { phone, bookings: [], lastBooking: null };
  const v2Bookings = getBookingsV2ByPhone(phone);
  const bookings = v2Bookings.length > 0
    ? v2Bookings
    : db.getAllBookings().filter((b) => b.phone === phone);
  return { phone, bookings, lastBooking: bookings[0] || null };
};

const findCustomerBookingTool = createTool({
  id: 'findCustomerBooking',
  description:
    'Look up a customer\'s bookings by phone number. Returns all of their ' +
    'bookings sorted newest-first plus the most recent one. ' +
    'Use this in the HandoffAgent to summarize what the customer wants to ' +
    'cancel / reschedule / complain about.',
  inputSchema: z.object({
    phone: z.string()
  }),
  outputSchema: z.object({
    phone: z.string(),
    bookings: z.array(z.any()),
    lastBooking: z.any().nullable()
  }),
  execute: async ({ context }) => findCustomerBooking(context)
});

// ---------------------------------------------------------------------------
// 6. escalateToHumanTool
// ---------------------------------------------------------------------------

const VALID_URGENCY = ['low', 'medium', 'high'];

const escalateToHuman = (input = {}) => {
  _ensureHandoffTable();
  const {
    phone,
    reason,
    urgency = 'medium',
    summary,
    customerName = null,
    language = 'en',
    intent = null,
    sentiment = null,
    chatSessionId = null,
    metadata = null
  } = input;
  if (!phone || !reason || !summary) {
    return { escalated: false, ticketId: null, error: 'missing-args (phone, reason, summary required)' };
  }
  const safeUrgency = VALID_URGENCY.includes(urgency) ? urgency : 'medium';
  const now = new Date().toISOString();
  const ticket = {
    id: _newTicketId(),
    phone,
    customerName,
    reason,
    urgency: safeUrgency,
    summary,
    status: 'open',
    language,
    intent,
    sentiment,
    chatSessionId,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null
  };
  try {
    db.db
      .prepare(
        `INSERT INTO handoff_tickets
          (id, phone, customerName, reason, urgency, summary, status, language,
           intent, sentiment, chatSessionId, metadata, createdAt, updatedAt, resolvedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ticket.id,
        ticket.phone,
        ticket.customerName,
        ticket.reason,
        ticket.urgency,
        ticket.summary,
        ticket.status,
        ticket.language,
        ticket.intent,
        ticket.sentiment,
        ticket.chatSessionId,
        ticket.metadata,
        ticket.createdAt,
        ticket.updatedAt,
        ticket.resolvedAt
      );
  } catch (err) {
    return { escalated: false, ticketId: null, error: err.message };
  }
  return { escalated: true, ticketId: ticket.id, urgency: safeUrgency, ticket };
};

const escalateToHumanTool = createTool({
  id: 'escalateToHuman',
  description:
    'Create a human-handoff ticket. Use this whenever the customer is ' +
    'cancelling, rescheduling, complaining, or has explicitly asked for a ' +
    'person. urgency should be "high" for damage / theft / safety / angry ' +
    'sentiment, "medium" for cancel/reschedule, "low" for general questions. ' +
    'Returns { escalated, ticketId, urgency, error }.',
  inputSchema: z.object({
    phone: z.string(),
    reason: z.string().describe('Short reason (e.g. "cancel", "complaint", "reschedule")'),
    summary: z.string().describe('One-sentence summary of what the customer wants'),
    urgency: z.enum(['low', 'medium', 'high']).default('medium'),
    customerName: z.string().optional(),
    language: z.enum(['ar', 'en', 'de']).default('en'),
    intent: z.string().optional(),
    sentiment: z.string().optional(),
    chatSessionId: z.string().optional(),
    metadata: z.record(z.any()).optional()
  }),
  outputSchema: z.object({
    escalated: z.boolean(),
    ticketId: z.string().nullable(),
    urgency: z.string().optional(),
    error: z.string().optional(),
    ticket: z.any().optional()
  }),
  execute: async ({ context }) => escalateToHuman(context)
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

module.exports = {
  // Mastra tools
  lookupCustomerTool,
  checkSlotTool,
  suggestAlternativesTool,
  createBookingTool,
  findCustomerBookingTool,
  escalateToHumanTool,

  // Plain functions (so tests + the orchestrator can call them without Mastra runtime)
  lookupCustomer,
  checkSlot,
  suggestAlternatives,
  createBooking,
  findCustomerBooking,
  escalateToHuman,

  getBookingV2ByRef: getBookingV2ByRefFromBridge,
  mem0Lookup,
  mem0Remember,
  _resetMem0ForTests,
  _seedMem0ForTests,

  // Constants (re-exported so tests don't have to duplicate)
  REQUIRED_FIELDS,
  ALL_OPERATING_HOURS
};
