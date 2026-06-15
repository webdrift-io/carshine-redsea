/**
 * Orchestrator — ties router, intake, booking, and handoff agents together.
 *
 * Source of truth: ./AGENT_PROMPTS.md (section 5).
 *
 * ## How this works
 *
 * `handleIncomingMessage(phone, message, profileName)` is the public entry
 * point. The contract is the same one the legacy `minimax-agent.js` exported
 * (and the one `server.js` already uses):
 *
 *     { reply, bookingCreated, bookingId, humanNeeded }
 *
 * Inside, the orchestrator:
 *
 *   1. Loads / creates a chat session and persists the incoming message.
 *   2. Calls `classifyIntent()` from `./decision.js` (the deterministic,
 *      testable mirror of RouterAgent).
 *   3. Calls `decideRoute()` to pick which agent should run next.
 *   4. Runs that agent:
 *        - If the LLM-backed Mastra agent is configured (`OPENAI_API_KEY` is
 *          set AND `USE_MASTRA_AGENT !== 'false'`) we *try* to invoke the
 *          Mastra agent via `agent.generate()`.
 *        - If the LLM call fails for any reason, OR no key is configured, we
 *          fall back to the deterministic decision layer. This guarantees
 *          the service is never completely down because of a missing key.
 *   5. Persists the bot reply.
 *   6. If the booking agent created a booking, also patches the chat session
 *      status to `waiting_approval` so the admin dashboard sees it.
 *   7. Returns the standard contract.
 *
 * ## Feature flag
 *
 *   USE_MASTRA_AGENT=true   → use the new orchestrator (default for new code)
 *   USE_MASTRA_AGENT=false  → use the legacy monolith (`minimax-agent.js`)
 *   USE_MASTRA_AGENT unset  → use the new orchestrator (default)
 *
 * The legacy file is kept around as a safety net — flip the flag in `.env` to
 * roll back without redeploying code.
 */

'use strict';

const db = require('../database');
const {
  routerAgent
} = require('./router-agent');
const {
  intakeAgent
} = require('./intake-agent');
const {
  bookingAgent
} = require('./booking-agent');
const {
  handoffAgent
} = require('./handoff-agent');

const {
  classifyIntent,
  decideRoute,
  validateBookingFields,
  buildPendingBooking,
  urgencyFor,
  formatHandoffReply,
  intakeReply
} = require('./decision');

const {
  checkSlot,
  suggestAlternatives,
  createBooking,
  findCustomerBooking,
  escalateToHuman,
  _resetMem0ForTests
} = require('./tools');

// Observability — every orchestrator call is traced through langfuse.
// In LIVE mode traces also POST to cloud.langfuse.com. Tag includes
// chatSessionId, language, and finalOutcome per the spec.
const { trace } = require('../observability/langfuse');
const { answerFromWebsiteKnowledge } = require('../website-knowledge');

const ACTIVE_PROVIDER = 'mastra-multi-agent';

const SLOT_TO_SESSION_FIELD = {
  customerName: 'customerName',
  phone: 'phone',
  area: 'area',
  carType: 'carType',
  package: 'package',
  date: 'preferredDate',
  time: 'preferredTime',
  location: 'location',
  paymentMethod: 'paymentMethod'
};

const SESSION_TO_SLOT_FIELD = {
  customerName: 'customerName',
  phone: 'phone',
  area: 'area',
  carType: 'carType',
  package: 'package',
  preferredDate: 'date',
  preferredTime: 'time',
  location: 'location',
  paymentMethod: 'paymentMethod'
};

function _isGeneratedWebPhone(phone) {
  return /^web_\d+_[a-z0-9]+$/i.test(String(phone || ''));
}

function _normalizeSlotsFromSession(session) {
  const slots = {};
  for (const [sessionKey, slotKey] of Object.entries(SESSION_TO_SLOT_FIELD)) {
    const value = session?.[sessionKey];
    if (sessionKey === 'customerName' && /^(website visitor|unknown|guest customer)$/i.test(String(value || '').trim())) {
      continue;
    }
    if (sessionKey === 'phone' && _isGeneratedWebPhone(value)) {
      continue;
    }
    if (value != null && String(value).trim() !== '') slots[slotKey] = value;
  }
  const details = session?.bookingDetails || {};
  for (const [key, value] of Object.entries(details)) {
    if (value != null && String(value).trim() !== '') {
      if (key === 'preferredDate') slots.date = value;
      else if (key === 'preferredTime') slots.time = value;
      else slots[key] = value;
    }
  }
  return slots;
}

function _mergeSlots(existingSlots = {}, newSlots = {}) {
  return {
    ...existingSlots,
    ...Object.fromEntries(
      Object.entries(newSlots || {}).filter(([, value]) =>
        value != null &&
        !(Array.isArray(value) && value.length === 0) &&
        String(value).trim() !== ''
      )
    )
  };
}

function _hasBookingProgress(slots = {}) {
  return ['area', 'carType', 'package', 'date', 'time', 'location'].some((key) =>
    slots?.[key] != null && String(slots[key]).trim() !== ''
  );
}

function _persistCollectedSlots(session, slots, nextField, language) {
  const bookingDetails = {
    ...session.bookingDetails,
    ...slots
  };
  if (slots.date) bookingDetails.preferredDate = slots.date;
  if (slots.time) bookingDetails.preferredTime = slots.time;
  const update = {
    bookingDetails,
    lastAskedField: nextField || null,
    language: language || session.language || 'en'
  };
  for (const [slotKey, sessionKey] of Object.entries(SLOT_TO_SESSION_FIELD)) {
    const value = slots?.[slotKey];
    if (value != null && String(value).trim() !== '') update[sessionKey] = value;
  }
  if (update.preferredDate == null && slots.date) update.preferredDate = slots.date;
  if (update.preferredTime == null && slots.time) update.preferredTime = slots.time;
  const updated = db.updateChat(session.id, update);
  return updated ? db.getChat(session.id) : session;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

function _getOrCreateSession(phone, profileName) {
  const existing = db
    .getChatsByStatus('active')
    .find((c) => c.phone === phone && c.status === 'active');
  if (existing) {
    return db.getChat(existing.id);
  }
  const session = {
    id: 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    customerName: profileName || 'Unknown',
    phone,
    area: '',
    carType: '',
    package: '',
    preferredDate: '',
    preferredTime: '',
    location: '',
    paymentMethod: '',
    status: 'active',
    language: 'en',
    lastAskedField: 'customerName',
    bookingDetails: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return session;
}

function _persistIncomingMessage(session, message) {
  if (!db.getChat(session.id)) {
    db.createChat(session, { text: message, timestamp: new Date().toISOString() });
  } else {
    db.addMessage(session.id, 'customer', message, new Date().toISOString());
  }
}

function _persistBotReply(session, reply) {
  db.addMessage(session.id, 'bot', reply, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Mastra agent invocation (best-effort, falls back to deterministic layer)
// ---------------------------------------------------------------------------

/**
 * Try to invoke a Mastra agent. Returns null if the call fails or no API key
 * is configured. The orchestrator treats the deterministic decision layer as
 * the source of truth — the Mastra call is purely additive (it can produce
 * a richer reply text, but the routing + booking + handoff actions still go
 * through `./decision.js` + `./tools.js`).
 */
async function _tryMastraGenerate(agent, message, opts = {}) {
  if (process.env.ENABLE_LLM_REPLY_TEXT !== 'true') return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.USE_MASTRA_AGENT === 'false') return null;
  if (typeof agent.generate !== 'function') return null;
  try {
    const result = await agent.generate({
      messages: [
        ...(opts.history || []),
        { role: 'user', content: message }
      ]
    });
    return result;
  } catch (err) {
    console.warn('[Orchestrator] Mastra generate failed; falling back:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-agent deterministic handlers
// ---------------------------------------------------------------------------

/**
 * Intake handler — used when router/intake agent is selected.
 * Returns { reply, needsHuman, reason, updatedSlots }.
 */
function _handleIntake(routerOutput, session) {
  const { language, slots } = routerOutput;

  // Merge with previously-collected session details so we don't re-ask.
  const merged = _mergeSlots(_normalizeSlotsFromSession(session), slots);
  // The "missing field" determines what to ask next.
  const FIELD_ORDER = [
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
  let nextField = null;
  for (const f of FIELD_ORDER) {
    const key = f === 'preferredDate' ? 'date' : f === 'preferredTime' ? 'time' : f;
    if (!merged[key] || String(merged[key]).trim() === '') {
      nextField = f;
      break;
    }
  }
  const reply = intakeReply(language, nextField, { customerName: merged.customerName });
  return {
    reply,
    needsHuman: false,
    reason: null,
    nextField,
    mergedSlots: merged
  };
}

/**
 * Booking handler — used when booking agent is selected.
 * Returns the standard booking output contract.
 */
function _handleBooking(routerOutput, phone, session) {
  const { slots } = routerOutput;
  const effectivePhone = _isGeneratedWebPhone(phone) ? null : phone;
  const v = validateBookingFields(slots, effectivePhone);
  if (!v.valid) {
    return {
      reply: intakeReply(routerOutput.language, v.missing?.[0] || 'customerName', {
        customerName: slots.customerName
      }),
      bookingCreated: false,
      bookingId: null,
      missingFields: v.missing,
      humanNeeded: false
    };
  }
  // Slot check.
  const slot = checkSlot({ date: slots.date, time: slots.time });
  if (!slot.isAvailable) {
    const alts = suggestAlternatives({ date: slots.date, excludeTime: slots.time }).alternatives;
    return {
      reply: intakeReply(routerOutput.language, null),
      bookingCreated: false,
      bookingId: null,
      slotUnavailable: { date: slots.date, alternatives: alts },
      humanNeeded: false
    };
  }
  // Persist.
  const pending = buildPendingBooking(slots, effectivePhone);
  // `buildPendingBooking` returns { date, time } (the canonical slot keys),
  // but the database/booking contract uses { preferredDate, preferredTime }.
  // Map them so createBooking's required-field check passes.
  const result = createBooking({
    ...pending,
    preferredDate: pending.date,
    preferredTime: pending.time,
    chatSessionId: session.id
  });
  if (!result.bookingCreated) {
    if (result.error === 'slot-unavailable') {
      return {
        reply: intakeReply(routerOutput.language, null),
        bookingCreated: false,
        bookingId: null,
        slotUnavailable: { date: slots.date, alternatives: result.alternatives || [] },
        humanNeeded: false
      };
    }
    return {
      reply: intakeReply(routerOutput.language, null),
      bookingCreated: false,
      bookingId: null,
      humanNeeded: false,
      error: result.error
    };
  }
  // Mark the session as waiting_approval so the dashboard sees it.
  try {
    db.updateChat(session.id, {
      status: 'waiting_approval',
      lastAskedField: '',
      bookingDetails: {}
    });
  } catch (err) {
    // Non-fatal: booking is already created, dashboard will just show a stale session.
  }
  const reply = _bookingConfirmation(routerOutput.language, result.bookingId, slots);
  return {
    reply,
    bookingCreated: true,
    bookingId: result.bookingId,
    missingFields: null,
    humanNeeded: false
  };
}

function _bookingConfirmation(language, bookingId, slots) {
  if (language === 'ar') {
    return `تمام! حجزت لك ${slots.package || 'الباقة'} يوم ${slots.date} الساعة ${slots.time}. رقم الحجز: ${bookingId}. هنتواصل معاك للتأكيد.`;
  }
  if (language === 'de') {
    return `Alles klar! Gebucht: ${slots.package || 'Paket'} am ${slots.date} um ${slots.time}. Buchungsnummer: ${bookingId}. Wir melden uns zur Bestätigung.`;
  }
  return `All set! Booked: ${slots.package || 'package'} on ${slots.date} at ${slots.time}. Booking ID: ${bookingId}. We'll reach out to confirm.`;
}

/**
 * Handoff handler — used when handoff agent is selected.
 * Returns { reply, escalated, ticketId, urgency, humanNeeded }.
 */
function _handleHandoff(routerOutput, phone, message, session) {
  const { language, intent, sentiment } = routerOutput;
  const urgency = urgencyFor(intent, sentiment, message);

  // Look up the customer's last booking (if any) for context.
  const lookup = findCustomerBooking({ phone });
  const lastBooking = lookup.lastBooking;
  const summaryParts = [];
  if (lastBooking) {
    summaryParts.push(
      `Last booking: ${lastBooking.package} on ${lastBooking.preferredDate} ${lastBooking.preferredTime} (${lastBooking.status})`
    );
  }
  summaryParts.push(`Customer wants to: ${intent}`);
  if (sentiment === 'angry') summaryParts.push('Customer is angry');

  const ticket = escalateToHuman({
    phone,
    reason: intent,
    urgency,
    summary: summaryParts.join('. '),
    customerName: lastBooking?.customerName || session?.customerName || null,
    language,
    intent,
    sentiment,
    chatSessionId: session.id
  });

  return {
    reply: formatHandoffReply(language, urgency),
    escalated: ticket.escalated,
    ticketId: ticket.ticketId,
    urgency,
    humanNeeded: true
  };
}

// ---------------------------------------------------------------------------
// Public entry point — `handleIncomingMessage(phone, message, profileName)`
// ---------------------------------------------------------------------------

/**
 * Handle a customer message. Returns the standard contract used by server.js.
 *
 * @param {string} phone
 * @param {string} message
 * @param {string} [profileName]
 * @returns {Promise<{reply: string, bookingCreated: boolean, bookingId: string|null, humanNeeded: boolean}>}
 */
async function handleIncomingMessage(phone, message, profileName) {
  // 0. Open the session id up front (sync) so we always have a
  //    stable chatSessionId to attach to inner agent traces.
  const preSession = _getOrCreateSession(phone, profileName);
  const sessionIdForTrace = preSession.id;
  const languageForTrace = (function () {
    try { return require('../parsers').detectLanguage(message); } catch (e) { void e; return 'en'; }
  })();

  // Outer trace: every call goes through here.
  return trace(
    {
      sessionId: sessionIdForTrace,
      name: 'orchestrator.handleIncomingMessage',
      metadata: {
        chatSessionId: sessionIdForTrace,
        language: languageForTrace,
        finalOutcome: 'pending',
        phone
      },
      input: message
    },
    async () => {
      const result = await _handleIncomingMessageInner(phone, message, profileName, preSession);

      // Emit a follow-up "outcome" trace tagged with the final outcome.
      const outcome = result && result.bookingCreated
        ? 'booking_created'
        : (result && result.humanNeeded ? 'human_handoff' : 'replied');

      await trace(
        {
          sessionId: sessionIdForTrace,
          name: 'orchestrator.outcome',
          metadata: {
            chatSessionId: sessionIdForTrace,
            language: languageForTrace,
            finalOutcome: outcome,
            bookingCreated: Boolean(result && result.bookingCreated),
            bookingId: (result && result.bookingId) || null,
            humanNeeded: Boolean(result && result.humanNeeded)
          },
          input: outcome
        },
        async () => outcome
      );

      return result;
    }
  );
}

async function _handleIncomingMessageInner(phone, message, profileName, session) {
  // 1. Persist incoming
  _persistIncomingMessage(session, message);

  // 2. Router (deterministic)
  const history = (session.messages || []).slice(-10).map((m) => ({
    role: m.sender === 'bot' ? 'assistant' : 'user',
    content: m.text
  }));
  const routerOutput = classifyIntent(message, history);
  if (session.language && session.language !== 'en' && routerOutput.language === 'en') {
    routerOutput.language = session.language;
  }
  if (
    session.lastAskedField === 'location' &&
    !routerOutput.slots.location &&
    !routerOutput.slots.time &&
    !routerOutput.slots.date &&
    !routerOutput.slots.phone &&
    typeof message === 'string' &&
    message.trim().length >= 4
  ) {
    routerOutput.slots.location = message.trim().slice(0, 300);
  }
  if (
    session.lastAskedField === 'phone' &&
    !routerOutput.slots.phone &&
    typeof message === 'string' &&
    /(\+?20\s?1\d{9}|01\d{9})/.test(message)
  ) {
    routerOutput.slots.phone = message.match(/(\+?20\s?1\d{9}|01\d{9})/)[1].replace(/\s/g, '');
  }
  routerOutput.slots = _mergeSlots(_normalizeSlotsFromSession(session), routerOutput.slots);
  session = _persistCollectedSlots(session, routerOutput.slots, session.lastAskedField, routerOutput.language);

  // 3. Decide which agent to call (orchestrator). The phone is passed in
  //    from the webhook so a customer who hasn't typed their number yet can
  //    still be routed to the BookingAgent once all other fields are present.
  const route = decideRoute(routerOutput, _isGeneratedWebPhone(phone) ? null : phone);
  if (process.env.ORCHESTRATOR_DEBUG) {
    console.log('[orch] route=', route, 'intent=', routerOutput.intent, 'phone=', phone);
    console.log('[orch] slots=', JSON.stringify(routerOutput.slots));
  }

  // 4. Best-effort: ask the Mastra agent for a richer reply (non-blocking
  //    improvement — failure is fine, deterministic layer is authoritative).
  let enrichedReply = null;
  if (route === 'intake') {
    const m = await _tryMastraGenerate(intakeAgent, message, { history });
    if (m && typeof m.text === 'string') enrichedReply = m.text;
  } else if (route === 'booking') {
    const m = await _tryMastraGenerate(bookingAgent, message, { history });
    if (m && typeof m.text === 'string') enrichedReply = m.text;
  } else if (route === 'handoff') {
    const m = await _tryMastraGenerate(handoffAgent, message, { history });
    if (m && typeof m.text === 'string') enrichedReply = m.text;
  } else if (route === 'router') {
    const m = await _tryMastraGenerate(routerAgent, message, { history });
    if (m && typeof m.text === 'string') enrichedReply = m.text;
  }

  // 5. Run the deterministic handler (authoritative for actions)
  let outcome;
  const knowledgeReply = answerFromWebsiteKnowledge(message, routerOutput.language);
  if (route === 'handoff') {
    outcome = _handleHandoff(routerOutput, _isGeneratedWebPhone(phone) ? (routerOutput.slots.phone || phone) : phone, message, session);
  } else if (knowledgeReply && (routerOutput.intent === 'info' || !_hasBookingProgress(routerOutput.slots))) {
    outcome = {
      reply: knowledgeReply,
      bookingCreated: false,
      bookingId: null,
      humanNeeded: false
    };
  } else if (route === 'booking') {
    outcome = _handleBooking(routerOutput, phone, session);
  } else {
    // intake or router — same surface
    outcome = _handleIntake(routerOutput, session);
    session = _persistCollectedSlots(session, outcome.mergedSlots, outcome.nextField, routerOutput.language);
  }

  // 6. Optionally upgrade the reply text with the Mastra-generated version.
  const finalReply = enrichedReply || outcome.reply;

  // 7. Persist the bot reply
  _persistBotReply(session, finalReply);

  // 8. Standard contract
  return {
    reply: finalReply,
    bookingCreated: !!outcome.bookingCreated,
    bookingId: outcome.bookingId || null,
    humanNeeded: !!outcome.humanNeeded
  };
}

// ---------------------------------------------------------------------------
// Legacy compatibility shim
// ---------------------------------------------------------------------------

// `minimax-agent.js` exported `fallbackResponse` which the existing
// `gemini-chatbot.test.js` references indirectly through `gemini-chatbot.js`.
// We re-export it here so server.js can read a single ACTIVE_PROVIDER constant.
const { detectLanguage } = require('../parsers');
const { FALLBACK_RESPONSES } = (() => {
  // Minimal fallback to mirror minimax-agent.fallbackResponse for legacy callers.
  const ar = {
    greeting: 'أهلاً بك في كار شاين Red Sea! تحب تحجز غسيل تجريبي (150 جنيه) ولا باقة شهرية؟',
    ask_name: 'يا ريت تقولي اسمك بالكامل؟',
    ask_area: 'حضرتك في أي منطقة؟ (الجونة، الغردقة، أو سهل حشيش)؟',
    error: 'محتاج معلومات أكتر عشان أقدر أساعدك.',
    human: 'هنوصلك بمسؤول يرد عليك فوراً.'
  };
  const en = {
    greeting: "Welcome to CarShine Red Sea! Would you like to book a Trial Wash (150 EGP) or a monthly plan?",
    ask_name: 'What is your full name please?',
    ask_area: 'Which area are you in?',
    error: 'I need a bit more information to help you.',
    human: "I'll connect you with a human agent right away."
  };
  const de = {
    greeting: 'Willkommen bei CarShine Red Sea! Möchten Sie eine Probe-Wäsche buchen?',
    ask_name: 'Wie ist Ihr vollständiger Name?',
    ask_area: 'In welchem Gebiet sind Sie?',
    error: 'Ich brauche noch ein paar Informationen.',
    human: 'Ich verbinde Sie sofort mit einem Mitarbeiter.'
  };
  return { FALLBACK_RESPONSES: { ar, en, de } };
})();

function fallbackResponse(message, _existingDetails = {}) {
  const lower = String(message || '').toLowerCase();
  const lang = detectLanguage(message);
  const r = FALLBACK_RESPONSES[lang] || FALLBACK_RESPONSES.en;
  if (
    lower.includes('cancel') ||
    lower.includes('إلغاء') ||
    lower.includes('stornieren') ||
    lower.includes('complain') ||
    lower.includes('شكوى') ||
    lower.includes('problem')
  ) {
    return { REPLY: r.human, PENDING_BOOKING: null, HUMAN_NEED: true };
  }
  if (lower.includes('hi') || lower.includes('hello') || lower.includes('أهل') || lower.includes('hallo')) {
    return { REPLY: r.greeting, PENDING_BOOKING: null, HUMAN_NEED: false };
  }
  return { REPLY: r.ask_name, PENDING_BOOKING: null, HUMAN_NEED: false };
}

module.exports = {
  // Public contract
  handleIncomingMessage,

  // Agent instances (for tests + future use)
  routerAgent,
  intakeAgent,
  bookingAgent,
  handoffAgent,

  // Re-exports so callers (server.js, tests) don't need to know the file layout
  classifyIntent,
  decideRoute,
  validateBookingFields,
  buildPendingBooking,
  urgencyFor,
  formatHandoffReply,
  intakeReply,

  checkSlot,
  suggestAlternatives,
  createBooking,
  findCustomerBooking,
  escalateToHuman,

  // Legacy shims
  fallbackResponse,
  ACTIVE_PROVIDER,

  // Test helpers
  _resetMem0ForTests
};
