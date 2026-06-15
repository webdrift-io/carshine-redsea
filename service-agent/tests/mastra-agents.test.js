/**
 * Tests for the Mastra multi-agent orchestrator.
 *
 * Focus: deterministic decision layer + tools. We don't make real LLM calls —
 * those are exercised in production. The deterministic layer is what makes
 * the system testable and what guarantees the external contract
 * `{ reply, bookingCreated, bookingId, humanNeeded }` is correct.
 *
 * Three required test groups (per task spec):
 *   1. router intent classification (decision.classifyIntent + decideRoute)
 *   2. booking tool with slot validation (tools.checkSlot / createBooking)
 *   3. handoff flow (tools.escalateToHuman + decision.urgencyFor)
 *
 * Plus an orchestrator-level smoke test to confirm the contract shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Use a fresh DB for each top-level describe so tests don't bleed into each
// other or into the real bookings.json.
let testCounter = 0;
function freshDb() {
  delete require.cache[require.resolve('../database')];
  delete require.cache[require.resolve('better-sqlite3')];
  delete require.cache[require.resolve('../migrations/001_create_handoff_tickets')];
  // Also clear the agents/tools + decision so they re-resolve their db.
  delete require.cache[require.resolve('../agents/tools')];
  delete require.cache[require.resolve('../agents/decision')];
  delete require.cache[require.resolve('../agents/orchestrator')];
  testCounter++;
  const tmpPath = path.join(
    process.env.TEMP || '/tmp',
    `mastra_test_${process.pid}_${testCounter}_${Date.now()}.sqlite`
  );
  process.env.DATABASE_PATH = tmpPath;
  const db = require('../database');
  return { db, tmpPath };
}

// ---------------------------------------------------------------------------
// 1. Router intent classification
// ---------------------------------------------------------------------------

describe('RouterAgent (decision.classifyIntent + decideRoute)', () => {
  let decision;
  beforeEach(() => {
    freshDb();
    decision = require('../agents/decision');
  });

  it('classifies a greeting as chitchat in English', () => {
    const r = decision.classifyIntent('Hello there');
    expect(r.intent).toBe('chitchat');
    expect(r.language).toBe('en');
    expect(r.needsHuman).toBe(false);
  });

  it('classifies a greeting as chitchat in Arabic', () => {
    const r = decision.classifyIntent('أهلاً');
    expect(r.intent).toBe('chitchat');
    expect(r.language).toBe('ar');
  });

  it('classifies a booking request with area as "book"', () => {
    const r = decision.classifyIntent('I want a car wash in El Gouna tomorrow at 10am');
    expect(r.intent).toBe('book');
    expect(r.slots.area).toBe('El Gouna');
    expect(r.slots.date).not.toBeNull();
    expect(r.slots.time).toBe('10:00');
    expect(r.needsHuman).toBe(false);
  });

  it('classifies pricing question as "info"', () => {
    const r = decision.classifyIntent('How much does the trial wash cost?');
    expect(r.intent).toBe('info');
  });

  it('classifies cancel request as "cancel" and sets needsHuman', () => {
    const r = decision.classifyIntent('I want to cancel my booking');
    expect(r.intent).toBe('cancel');
    expect(r.needsHuman).toBe(true);
  });

  it('classifies complaint as "complaint" and sets needsHuman', () => {
    const r = decision.classifyIntent('I have a serious complaint about my last wash');
    expect(r.intent).toBe('complaint');
    expect(r.needsHuman).toBe(true);
  });

  it('classifies reschedule as "reschedule" and sets needsHuman', () => {
    const r = decision.classifyIntent('Can I reschedule to next week?');
    expect(r.intent).toBe('reschedule');
    expect(r.needsHuman).toBe(true);
  });

  it('classifies explicit ask for manager as "human"', () => {
    const ar = decision.classifyIntent('عايز أكلم المسؤول');
    expect(ar.intent).toBe('human');
    expect(ar.needsHuman).toBe(true);

    const en = decision.classifyIntent('Get me a manager please');
    expect(en.intent).toBe('human');
    expect(en.needsHuman).toBe(true);
  });

  it('flags angry sentiment even when intent looks like a normal message', () => {
    const r = decision.classifyIntent('This service is fucking terrible');
    expect(r.sentiment).toBe('angry');
    expect(r.needsHuman).toBe(true);
  });

  it('extracts all booking slots from a single rich message', () => {
    const r = decision.classifyIntent(
      'My name is Ahmed, I am in Hurghada, I have a BMW, I want the Smart Plan tomorrow at 14:00, pay cash, here is my address: Marina'
    );
    expect(r.intent).toBe('book');
    expect(r.slots.customerName).toBe('Ahmed');
    expect(r.slots.area).toBe('Hurghada');
    expect(r.slots.carType).toBe('BMW');
    expect(r.slots.package).toBe('Smart Plan');
    expect(r.slots.time).toBe('14:00');
    expect(r.slots.paymentMethod).toBe('Cash');
    expect(r.slots.location).toBeTruthy();
  });

  it('decideRoute: chitchat / info → intake', () => {
    expect(decision.decideRoute({ intent: 'chitchat', needsHuman: false, slots: {} })).toBe('intake');
    expect(decision.decideRoute({ intent: 'info', needsHuman: false, slots: {} })).toBe('intake');
  });

  it('decideRoute: needsHuman → handoff (overrides intent)', () => {
    expect(decision.decideRoute({ intent: 'chitchat', needsHuman: true, slots: {} })).toBe('handoff');
    expect(decision.decideRoute({ intent: 'book', needsHuman: true, slots: {} })).toBe('handoff');
  });

  it('decideRoute: cancel/reschedule/complaint/human → handoff', () => {
    for (const intent of ['cancel', 'reschedule', 'complaint', 'human']) {
      expect(decision.decideRoute({ intent, needsHuman: false, slots: {} })).toBe('handoff');
    }
  });

  it('decideRoute: book with all fields → booking', () => {
    const slots = {
      customerName: 'Ahmed',
      phone: '+201000000000',
      area: 'El Gouna',
      carType: 'BMW',
      package: 'Smart Plan',
      date: '2099-01-01',
      time: '10:00',
      location: 'Marina',
      paymentMethod: 'Cash'
    };
    expect(decision.decideRoute({ intent: 'book', needsHuman: false, slots })).toBe('booking');
  });

  it('decideRoute: book with missing fields → intake (collects more)', () => {
    const slots = { customerName: 'Ahmed', area: 'El Gouna' };
    expect(decision.decideRoute({ intent: 'book', needsHuman: false, slots })).toBe('intake');
  });
});

// ---------------------------------------------------------------------------
// 2. Booking tool with slot validation
// ---------------------------------------------------------------------------

describe('BookingAgent tools (checkSlot + createBooking + validateBookingFields)', () => {
  let tools;
  let decision;
  let db;
  beforeEach(() => {
    const fresh = freshDb();
    db = fresh.db;
    tools = require('../agents/tools');
    decision = require('../agents/decision');
  });

  it('checkSlot: returns isAvailable=true for an open hour', () => {
    const r = tools.checkSlot({ date: '2099-01-01', time: '10:00' });
    expect(r.isAvailable).toBe(true);
    expect(r.capacity).toBe(2);
    expect(r.currentBookings).toBe(0);
  });

  it('checkSlot: returns isAvailable=false for time outside 09:00-17:00', () => {
    const early = tools.checkSlot({ date: '2099-01-01', time: '07:00' });
    expect(early.isAvailable).toBe(false);
    expect(early.reason).toBe('outside-hours');

    const late = tools.checkSlot({ date: '2099-01-01', time: '20:00' });
    expect(late.isAvailable).toBe(false);
    expect(late.reason).toBe('outside-hours');
  });

  it('checkSlot: returns isAvailable=false after 2 bookings fill the hour', () => {
    // Create two bookings at 10:00
    for (let i = 0; i < 2; i++) {
      db.createBooking(
        {
          id: `b_fill_${i}`,
          customerName: 'Filler',
          phone: '+201000000000',
          area: 'El Gouna',
          carType: 'BMW',
          package: 'Trial Wash',
          preferredDate: '2099-01-01',
          preferredTime: '10:00',
          location: 'X',
          paymentMethod: 'Cash',
          status: 'pending',
          notes: ''
        },
        null
      );
    }
    const r = tools.checkSlot({ date: '2099-01-01', time: '10:00' });
    expect(r.isAvailable).toBe(false);
    expect(r.reason).toBe('full');
    expect(r.currentBookings).toBe(2);
  });

  it('createBooking: returns missingFields when fields are absent', () => {
    const r = tools.createBooking({ customerName: 'Ahmed' });
    expect(r.bookingCreated).toBe(false);
    expect(r.bookingId).toBeNull();
    expect(r.missingFields).toContain('phone');
    expect(r.missingFields).toContain('area');
  });

  it('createBooking: persists a complete booking and returns a bookingId', () => {
    const r = tools.createBooking({
      customerName: 'Ahmed',
      phone: '+201000000000',
      area: 'El Gouna',
      carType: 'BMW',
      package: 'Smart Plan',
      preferredDate: '2099-01-01',
      preferredTime: '10:00',
      location: 'Marina',
      paymentMethod: 'Cash',
      chatSessionId: 'session_test'
    });
    expect(r.bookingCreated).toBe(true);
    expect(r.bookingId).toMatch(/^b_/);
    const persisted = db.getBooking(r.bookingId);
    expect(persisted).toBeTruthy();
    expect(persisted.status).toBe('pending');
    expect(preserved_notes_contains(persisted.notes, 'Created via AI agent'));
  });

  it('createBooking: rejects when slot is full at insert time (race-safe)', () => {
    // Pre-fill hour 14:00
    for (let i = 0; i < 2; i++) {
      db.createBooking(
        {
          id: `b_prerace_${i}`,
          customerName: 'Filler',
          phone: '+201000000000',
          area: 'El Gouna',
          carType: 'BMW',
          package: 'Trial Wash',
          preferredDate: '2099-01-01',
          preferredTime: '14:00',
          location: 'X',
          paymentMethod: 'Cash',
          status: 'pending',
          notes: ''
        },
        null
      );
    }
    const r = tools.createBooking({
      customerName: 'Ahmed',
      phone: '+201000000000',
      area: 'El Gouna',
      carType: 'BMW',
      package: 'Trial Wash',
      preferredDate: '2099-01-01',
      preferredTime: '14:00',
      location: 'Marina',
      paymentMethod: 'Cash'
    });
    expect(r.bookingCreated).toBe(false);
    expect(r.error).toBe('slot-unavailable');
    expect(r.alternatives).toBeInstanceOf(Array);
  });

  it('createBooking: tags InstaPay bookings with receipt-pending note', () => {
    const r = tools.createBooking({
      customerName: 'Ahmed',
      phone: '+201000000000',
      area: 'El Gouna',
      carType: 'BMW',
      package: 'Smart Plan',
      preferredDate: '2099-01-01',
      preferredTime: '11:00',
      location: 'Marina',
      paymentMethod: 'InstaPay'
    });
    expect(r.bookingCreated).toBe(true);
    const persisted = db.getBooking(r.bookingId);
    expect(persisted.notes).toMatch(/Awaiting receipt screenshot/);
  });

  it('validateBookingFields: returns valid=true with complete fields', () => {
    const v = decision.validateBookingFields(
      {
        customerName: 'Ahmed',
        area: 'El Gouna',
        carType: 'BMW',
        package: 'Smart Plan',
        date: '2099-01-01',
        time: '10:00',
        location: 'Marina',
        paymentMethod: 'Cash'
      },
      '+201000000000'
    );
    expect(v.valid).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.inPast).toBe(false);
  });

  it('validateBookingFields: returns missing list when fields are absent', () => {
    const v = decision.validateBookingFields(
      { customerName: 'Ahmed' },
      '+201000000000'
    );
    expect(v.valid).toBe(false);
    expect(v.missing.length).toBeGreaterThan(0);
    expect(v.missing).toContain('area');
  });

  it('validateBookingFields: rejects past dates', () => {
    const v = decision.validateBookingFields(
      {
        customerName: 'Ahmed',
        area: 'El Gouna',
        carType: 'BMW',
        package: 'Smart Plan',
        date: '2000-01-01',
        time: '10:00',
        location: 'Marina',
        paymentMethod: 'Cash'
      },
      '+201000000000'
    );
    expect(v.valid).toBe(false);
    expect(v.inPast).toBe(true);
  });

  it('validateBookingFields: rejects times outside 09:00-17:00', () => {
    const v = decision.validateBookingFields(
      {
        customerName: 'Ahmed',
        area: 'El Gouna',
        carType: 'BMW',
        package: 'Smart Plan',
        date: '2099-01-01',
        time: '20:00',
        location: 'Marina',
        paymentMethod: 'Cash'
      },
      '+201000000000'
    );
    expect(v.valid).toBe(false);
    expect(v.slotReason).toBe('outside-hours');
  });

  it('suggestAlternatives: returns up to 3 open slots on the date', () => {
    const r = tools.suggestAlternatives({ date: '2099-01-01' });
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives.length).toBeLessThanOrEqual(3);
    expect(r.alternatives[0]).toMatch(/^\d{2}:\d{2}$/);
  });

  it('suggestAlternatives: excludes a specific time and respects capacity', () => {
    // Fill 10:00, 11:00, 12:00
    const hours = [10, 11, 12];
    for (let i = 0; i < hours.length; i++) {
      for (let j = 0; j < 2; j++) {
        db.createBooking(
          {
            id: `b_alt_${hours[i]}_${j}`,
            customerName: 'Filler',
            phone: '+201000000000',
            area: 'El Gouna',
            carType: 'BMW',
            package: 'Trial Wash',
            preferredDate: '2099-01-01',
            preferredTime: `${String(hours[i]).padStart(2, '0')}:00`,
            location: 'X',
            paymentMethod: 'Cash',
            status: 'pending',
            notes: ''
          },
          null
        );
      }
    }
    const r = tools.suggestAlternatives({ date: '2099-01-01', excludeTime: '09:00' });
    expect(r.alternatives).not.toContain('09:00');
    expect(r.alternatives).not.toContain('10:00');
    expect(r.alternatives).not.toContain('11:00');
    expect(r.alternatives).not.toContain('12:00');
    // Should still find open slots in the 13:00-17:00 window
    expect(r.alternatives.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Handoff flow
// ---------------------------------------------------------------------------

describe('HandoffAgent (urgencyFor + escalateToHuman + findCustomerBooking)', () => {
  let tools;
  let decision;
  let db;
  beforeEach(() => {
    const fresh = freshDb();
    db = fresh.db;
    tools = require('../agents/tools');
    decision = require('../agents/decision');
  });

  it('urgencyFor: "high" for angry sentiment', () => {
    expect(decision.urgencyFor('complaint', 'angry', 'this is fucking terrible')).toBe('high');
  });

  it('urgencyFor: "high" for damage / safety mention in complaint', () => {
    expect(decision.urgencyFor('complaint', 'negative', 'there is damage to my car')).toBe('high');
    expect(decision.urgencyFor('complaint', 'negative', 'سيارتي اتسرقت')).toBe('high');
  });

  it('urgencyFor: "medium" for cancel / reschedule / generic complaint', () => {
    expect(decision.urgencyFor('cancel', 'neutral', 'please cancel')).toBe('medium');
    expect(decision.urgencyFor('reschedule', 'neutral', 'can I move it')).toBe('medium');
    expect(decision.urgencyFor('complaint', 'negative', 'I was unhappy with the service')).toBe('medium');
  });

  it('urgencyFor: "low" for general questions / chitchat', () => {
    expect(decision.urgencyFor('chitchat', 'neutral', 'thanks')).toBe('low');
    expect(decision.urgencyFor('info', 'neutral', 'how much is it')).toBe('low');
  });

  it('formatHandoffReply: returns Arabic / English / German templates', () => {
    expect(decision.formatHandoffReply('ar')).toMatch(/شكراً/);
    expect(decision.formatHandoffReply('en')).toMatch(/Thanks/);
    expect(decision.formatHandoffReply('de')).toMatch(/Danke/);
  });

  it('formatHandoffReply: prefixes with apology for high urgency', () => {
    expect(decision.formatHandoffReply('ar', 'high')).toMatch(/آسفين/);
    expect(decision.formatHandoffReply('en', 'high')).toMatch(/sorry/i);
  });

  it('escalateToHuman: creates a handoff ticket and returns a ticketId', () => {
    const r = tools.escalateToHuman({
      phone: '+201000000000',
      reason: 'cancel',
      summary: 'Customer wants to cancel their booking',
      urgency: 'medium',
      customerName: 'Ahmed',
      language: 'ar',
      intent: 'cancel',
      sentiment: 'neutral',
      chatSessionId: 'session_test'
    });
    expect(r.escalated).toBe(true);
    expect(r.ticketId).toMatch(/^t_/);
    expect(r.urgency).toBe('medium');

    // Verify it landed in the database
    const row = db.db
      .prepare('SELECT * FROM handoff_tickets WHERE id = ?')
      .get(r.ticketId);
    expect(row).toBeTruthy();
    expect(row.phone).toBe('+201000000000');
    expect(row.reason).toBe('cancel');
    expect(row.urgency).toBe('medium');
    expect(row.status).toBe('open');
  });

  it('escalateToHuman: rejects when required args are missing', () => {
    const r = tools.escalateToHuman({ phone: '+201000000000' });
    expect(r.escalated).toBe(false);
    expect(r.error).toMatch(/missing-args/);
  });

  it('escalateToHuman: coerces invalid urgency to "medium"', () => {
    const r = tools.escalateToHuman({
      phone: '+201000000000',
      reason: 'cancel',
      summary: 'x',
      urgency: 'catastrophic'
    });
    expect(r.escalated).toBe(true);
    expect(r.urgency).toBe('medium');
  });

  it('findCustomerBooking: returns the customer\'s bookings, newest first', () => {
    // Seed two bookings
    db.createBooking(
      {
        id: 'b_old',
        customerName: 'Ahmed',
        phone: '+201000000000',
        area: 'El Gouna',
        carType: 'BMW',
        package: 'Trial Wash',
        preferredDate: '2098-12-01',
        preferredTime: '10:00',
        location: 'X',
        paymentMethod: 'Cash',
        status: 'pending',
        notes: ''
      },
      null
    );
    db.createBooking(
      {
        id: 'b_new',
        customerName: 'Ahmed',
        phone: '+201000000000',
        area: 'El Gouna',
        carType: 'BMW',
        package: 'Smart Plan',
        preferredDate: '2099-01-01',
        preferredTime: '10:00',
        location: 'X',
        paymentMethod: 'Cash',
        status: 'pending',
        notes: ''
      },
      null
    );
    const r = tools.findCustomerBooking({ phone: '+201000000000' });
    expect(r.bookings.length).toBe(2);
    expect(r.lastBooking.id).toBe('b_new');
  });

  it('findCustomerBooking: returns empty when no bookings exist', () => {
    const r = tools.findCustomerBooking({ phone: '+209999999999' });
    expect(r.bookings).toEqual([]);
    expect(r.lastBooking).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Orchestrator end-to-end (smoke test — no LLM calls)
// ---------------------------------------------------------------------------

describe('Orchestrator (handleIncomingMessage contract)', () => {
  let orch;
  let db;
  beforeEach(() => {
    const fresh = freshDb();
    db = fresh.db;
    orch = require('../agents/orchestrator');
  });

  it('returns the standard contract shape for a greeting', async () => {
    const r = await orch.handleIncomingMessage('+201000000001', 'Hello', 'Test User');
    expect(r).toHaveProperty('reply');
    expect(r).toHaveProperty('bookingCreated');
    expect(r).toHaveProperty('bookingId');
    expect(r).toHaveProperty('humanNeeded');
    expect(typeof r.reply).toBe('string');
    expect(r.reply.length).toBeGreaterThan(0);
    expect(r.bookingCreated).toBe(false);
    expect(r.bookingId).toBeNull();
    expect(r.humanNeeded).toBe(false);
  });

  it('routes an angry message to handoff (humanNeeded=true, no booking)', async () => {
    const r = await orch.handleIncomingMessage('+201000000002', 'this is fucking terrible', 'Mad User');
    expect(r.humanNeeded).toBe(true);
    expect(r.bookingCreated).toBe(false);
  });

  it('routes a cancel request to handoff (humanNeeded=true, no booking)', async () => {
    const r = await orch.handleIncomingMessage('+201000000003', 'I want to cancel please', 'Test User');
    expect(r.humanNeeded).toBe(true);
    expect(r.bookingCreated).toBe(false);
  });

  it('creates a booking when a complete message is provided', async () => {
    const r = await orch.handleIncomingMessage(
      '+201000000004',
      'My name is Sara, I am in Hurghada, I have a Toyota, I want the Premium Plan tomorrow at 14:00, pay Vodafone Cash, location: Marina',
      'Sara'
    );
    expect(r.bookingCreated).toBe(true);
    expect(r.bookingId).toMatch(/^b_/);
    expect(r.humanNeeded).toBe(false);
    // Verify the booking is in the database
    const persisted = db.getBooking(r.bookingId);
    expect(persisted).toBeTruthy();
    expect(persisted.customerName).toBe('Sara');
    expect(persisted.area).toBe('Hurghada');
    expect(persisted.carType).toBe('TOYOTA');
    expect(persisted.package).toBe('Premium Plan');
  });

  it('does NOT create a booking for incomplete messages (asks for next field)', async () => {
    const r = await orch.handleIncomingMessage(
      '+201000000005',
      'I want a car wash in El Gouna',
      'Test User'
    );
    expect(r.bookingCreated).toBe(false);
    expect(r.bookingId).toBeNull();
    expect(r.humanNeeded).toBe(false);
    // Reply should be in the user's language (English here) and ask for the next field
    expect(r.reply.toLowerCase()).toMatch(/name|car|package|date|time|location|payment/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function preserved_notes_contains(notes, fragment) {
  return Boolean(notes) && notes.includes(fragment);
}
