/**
 * Booking interruption layer.
 *
 * Runs BEFORE the existing classifyIntent → decideRoute flow so that
 * general questions, "wait" / "stop" / "i have other questions", and
 * explicit cancel/restart/continue commands never get trapped in the
 * booking slot-fill loop.
 *
 * Pure functions (no DB, no IO) so the unit tests can exercise every
 * branch with no mocking.
 */

'use strict';

// Note: detectLanguage + answerFromWebsiteKnowledge are used by the
// orchestrator (./orchestrator.js), not here. This file only holds the
// pure pattern-detection + reply-templating logic.

// ---- Patterns ---------------------------------------------------------------

// Explicit booking control — clears draft / resumes / cancels the whole flow
// Note: \b word-boundary does not work cleanly with Arabic in JS regex even
// with the `u` flag, so we use lookbehind/lookahead for whitespace + EOL.
const CANCEL_BOOKING_PATTERNS = [
  /(?:^|\s)(cancel\s*(the\s*)?booking|cancel\s*my\s*booking|stop\s*(the\s*)?booking|stop\s*booking|quit\s*booking)(?=\s|$)/iu,
  /(?:^|\s)(إلغاء|ألغي|إلغي|كنسل)(?:\s*(الحجز|حجز))?(?=\s|$)/u,
  /(?:^|\s)(stornieren|stornierung|buchung\s*stornieren)(?=\s|$)/iu
];

const RESTART_PATTERNS = [
  /^\s*(restart|reset|start\s*over|start\s*again)\s*$/iu,
  /^\s*(ابدا\s*من\s*جديد|اعادة|إعادة|ريستارت)\s*$/u,
  /^\s*(neu\s*starten|zurücksetzen)\s*$/iu
];

const CONTINUE_BOOKING_PATTERNS = [
  /^\s*(continue(\s+booking)?|resume(\s+booking)?|go\s+on|proceed(\s+booking)?|let'?s\s+continue)\s*$/iu,
  /^\s*(كمل|استكمل|استأنف|تابع|كمّل)\s*$/u,
  /^\s*(weiter|fortsetzen|fortfahren)\s*$/iu
];

// General conversational phrases that should NEVER be treated as booking data.
// When these match, the bot should answer politely + offer to continue.
//
// IMPORTANT: "greeting" is intentionally NOT in this list. A greeting is the
// start of a new session and should use the proper GREETING_REPLIES, not
// the interrupt_with_progress reply.
//
// Also: pure acknowledgments like "thanks", "ok", "got it" are NOT in this
// list. They are valid turns in a booking flow (e.g. "ok, I confirm 10 AM")
// and should fall through to the slot-fill machinery.
const INTERRUPT_PHRASES = [
  /(?:^|\s)(wait|hold\s+on|hold\s+up|stop\s+here|not\s+now|hold\s+off)(?=\s|$)/iu,
  /\b(i\s*have\s*(other|another)\s*(question|questions|q))\b/iu,
  /\b(one\s+more\s+(question|thing)|another\s+(question|thing))\b/iu,
  /\b(before\s+that|actually|by\s+the\s+way|btw)\b/iu,
  /^\s*(help|support)\s*$/iu,
  /^\s*(how\s+are\s+you|how'?s\s+it\s+going|how\s+do\s+you\s+do|are\s+you\s+there)\s*[.?!]?\s*$/iu,
  /^\s*(?:لا\s*يهم|no\s+worries)\s*$/iu
];

// STRONG knowledge triggers — explicit "tell me about pricing" signals that
// are NEVER a valid booking-slot answer. These fire even without a question
// mark ("price", "how much", "packages").
const STRONG_KNOWLEDGE_TRIGGERS = [
  /\b(price|prices|cost|how\s*much|packages?|بكام|سعر|أسعار|باقات?|preis|kosten|pakete?)\b/iu
];

// WEAK knowledge triggers — keywords that ALSO appear as legitimate booking
// answers ("El Gouna" is an area answer, "Trial Wash" contains "wash",
// "InstaPay" is a payment method). These must ONLY be treated as a question
// when the message is actually QUESTION-SHAPED (see isQuestionShaped), so a
// user typing their area / package / payment method during slot-fill is not
// hijacked by the interruption layer.
const WEAK_KNOWLEDGE_TRIGGERS = [
  /\b(area|areas|where|location|locations|coverage|gouna|hurghada|sahl|منطقة|فين|أين|الجونة|الغردقة|سهل\s*حشيش|gebiet|wo)\b/iu,
  /\b(hours|working|open|when|موعد|مواعيد|الساعة|دوام|وقت|wann|uhr|geöffnet)\b/iu,
  /\b(payment|pay|instapay|cash|vodafone|fawry|دفع|انستاباي|كاش|فوري|bezahlen)\b/iu,
  /\b(service|services|include|includes|wash|clean|inside|outside|interior|exterior|خدمة|غسيل|تنظيف|داخلي|خارجي|wäsche|reinigen)\b/iu,
  /\b(phone|whatsapp|contact|رقم|واتساب|تواصل|telefon|kontakt)\b/iu
];

// Backwards-compatible export (used by some callers/tests) — the union.
const KNOWLEDGE_TRIGGERS = [...STRONG_KNOWLEDGE_TRIGGERS, ...WEAK_KNOWLEDGE_TRIGGERS];

// Interrogative markers — used to decide whether a WEAK knowledge keyword is
// really a question ("do you serve Hurghada?") versus a slot answer ("Hurghada").
const QUESTION_MARKERS = [
  /\?|؟/,
  /\b(how|what|which|where|when|why|who|whom|do\s+you|does|did|can\s+you|could\s+you|would\s+you|will\s+you|is\s+it|are\s+you|is\s+there|are\s+there|tell\s+me|i\s+want\s+to\s+know|i'?d\s+like\s+to\s+know|explain|what'?s)\b/iu,
  /\b(هل|ازاي|إزاي|ليه|ليش|امتى|إمتى|فين|وين|كام|بكام|ممكن\s*تقول|عايز\s*اعرف|عاوز\s*اعرف|عايز\s*أعرف)\b/u,
  /\b(wie|was|wo|wann|warum|wieviel|wie\s*viel|kann\s+ich|können\s+sie|gibt\s+es|ist\s+es)\b/iu
];

function isQuestionShaped(text = '') {
  return QUESTION_MARKERS.some((p) => p.test(text));
}

// ---- Detection helpers -----------------------------------------------------

function matchesAny(text, patterns) {
  if (!text) return false;
  for (const p of patterns) if (p.test(text)) return true;
  return false;
}

/**
 * Decide what to do with the current message. Returns one of:
 *   { action: 'cancel_booking' }
 *   { action: 'restart' }
 *   { action: 'continue_booking' }
 *   { action: 'interrupt' }          (general Q or pause)
 *   { action: 'passthrough' }         (let the regular flow handle it)
 */
function detectInterruption(text = '') {
  if (!text || !text.trim()) return { action: 'passthrough' };

  if (matchesAny(text, CANCEL_BOOKING_PATTERNS)) {
    return { action: 'cancel_booking' };
  }
  if (matchesAny(text, RESTART_PATTERNS)) {
    return { action: 'restart' };
  }
  if (matchesAny(text, CONTINUE_BOOKING_PATTERNS)) {
    return { action: 'continue_booking' };
  }
  if (matchesAny(text, INTERRUPT_PHRASES)) {
    return { action: 'interrupt' };
  }
  // STRONG knowledge keywords (price/cost/packages) are always a question.
  if (matchesAny(text, STRONG_KNOWLEDGE_TRIGGERS)) {
    return { action: 'interrupt' };
  }
  // WEAK keywords (area/service/payment/contact words) are ONLY a question
  // when phrased as one — otherwise they are slot-fill answers like
  // "El Gouna", "Trial Wash", "InstaPay" and must pass through.
  if (isQuestionShaped(text) && matchesAny(text, WEAK_KNOWLEDGE_TRIGGERS)) {
    return { action: 'interrupt' };
  }
  return { action: 'passthrough' };
}

// ---- Reply templates -------------------------------------------------------

const REPLY = {
  cancel_booking: {
    ar: 'تمام، ألغيت الحجز. لو احتجت أي حاجة تانية — سعر، باقات، أو حجز جديد — قولي في أي وقت.',
    en: 'Done — I cleared the booking draft. Whenever you need me again — pricing, packages, or a new booking — just let me know.',
    de: 'Alles klar — ich habe den Buchungsentwurf gelöscht. Wenn du wieder etwas brauchst — Preise, Pakete oder eine neue Buchung — sag einfach Bescheid.'
  },
  restart: {
    ar: 'ابدأنا من جديد. تحب تحجز غسيل ولا عندك سؤال؟',
    en: "Fresh start. Would you like to book a wash, or do you have a question first?",
    de: 'Frischer Start. Möchtest du eine Wäsche buchen, oder hast du zuerst eine Frage?'
  },
  continue_booking: {
    ar: 'تمام، كملنا. تحب تكمّل الحجز؟',
    en: "Got it. Want to continue the booking where we left off?",
    de: 'Alles klar. Möchtest du die Buchung an der Stelle fortsetzen, wo wir aufgehört haben?'
  },
  interrupt_with_progress: {
    ar: 'طبعاً، تحت أمرك. وبعد ما نخلص كده، عايز تكمّل الحجز اللي بدأناه ولا نلغيها؟',
    en: "Of course — happy to help with that first. After this, would you like to continue the booking we started, change something, or stop for now?",
    de: 'Klar, helfe gerne zuerst dabei. Möchtest du danach die gestartete Buchung fortsetzen, etwas ändern, oder erstmal stoppen?'
  },
  interrupt_no_progress: {
    ar: 'طبعاً، تحت أمرك. قول لي.',
    en: "Of course — happy to help. What would you like to know?",
    de: 'Klar, gerne. Was möchtest du wissen?'
  },
  greeting_only: {
    ar: 'أهلاً! 🚗 تحب تحجز غسيل ولا عندك سؤال الأول؟',
    en: "Hi there! 🚗 Would you like to book a wash, or do you have a question first?",
    de: 'Hallo! 🚗 Möchtest du eine Wäsche buchen, oder hast du zuerst eine Frage?'
  }
};

/**
 * Build the user-facing reply for an interruption action.
 *
 * @param {{action: string}} detection       - the detection result
 * @param {boolean} hasBookingProgress       - whether the user already has slots collected
 * @param {string} language
 * @param {string} knowledgeAnswer           - optional knowledge-base answer to append
 * @returns {string}
 */
function buildInterruptionReply(detection, hasBookingProgress, language, knowledgeAnswer) {
  const lang = ['ar', 'en', 'de'].includes(language) ? language : 'en';
  let base;
  if (detection.action === 'cancel_booking') base = REPLY.cancel_booking[lang];
  else if (detection.action === 'restart') base = REPLY.restart[lang];
  else if (detection.action === 'continue_booking') base = REPLY.continue_booking[lang];
  else if (detection.action === 'interrupt') {
    base = hasBookingProgress
      ? REPLY.interrupt_with_progress[lang]
      : REPLY.interrupt_no_progress[lang];
  } else {
    base = REPLY.interrupt_no_progress[lang];
  }
  if (knowledgeAnswer) {
    return `${knowledgeAnswer}\n\n${base}`;
  }
  return base;
}

/**
 * Clear the booking draft for a session.
 *
 * Sets `lastAskedField` to `area` (the first intake question after the
 * customer identity has been established in the new greeting) so the
 * next user message lands on the proper first slot-fill question,
 * not on `customerName` (which the user already gave on the first
 * turn of the original session and is preserved as session.customerName).
 */
function clearBookingDraft(session) {
  return {
    customerName: session?.customerName || '',
    phone: session?.phone || '',
    area: '',
    carType: '',
    package: '',
    preferredDate: '',
    preferredTime: '',
    location: '',
    paymentMethod: '',
    status: 'active',
    lastAskedField: 'area',
    bookingDetails: {}
  };
}

module.exports = {
  CANCEL_BOOKING_PATTERNS,
  RESTART_PATTERNS,
  CONTINUE_BOOKING_PATTERNS,
  INTERRUPT_PHRASES,
  KNOWLEDGE_TRIGGERS,
  STRONG_KNOWLEDGE_TRIGGERS,
  WEAK_KNOWLEDGE_TRIGGERS,
  QUESTION_MARKERS,
  isQuestionShaped,
  matchesAny,
  detectInterruption,
  buildInterruptionReply,
  clearBookingDraft
};
