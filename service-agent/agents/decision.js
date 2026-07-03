/**
 * Decision layer — pure-JS routing, validation, and templating
 *
 * Why a separate decision layer?
 * ------------------------------
 * The Mastra agents in this project (router/intake/booking/handoff) are LLM-
 * driven. We can't make real LLM calls in unit tests (slow, expensive,
 * non-deterministic), and we don't want the service to be completely
 * unavailable when no OPENAI_API_KEY is set. This module is the seam:
 *
 *   - `classifyIntent(text, history)`         → router agent's job
 *   - `decideRoute(intent, needsHuman)`        → orchestrator's job
 *   - `validateBookingFields(slots)`           → booking agent's job
 *   - `buildPendingBooking(slots, phone)`      → booking agent's job
 *   - `urgencyFor(intent, sentiment)`          → handoff agent's job
 *   - `formatHandoffReply(language, ...)`      → handoff agent's job
 *
 * Each function is pure: same input → same output, no side effects, no
 * external state. The orchestrator (`./orchestrator.js`) glues them together
 * and is what `server.js` calls.
 *
 * When an LLM key IS configured, the Mastra agents can be invoked for richer
 * conversational replies — but the routing + booking + handoff decisions
 * still go through this layer so behaviour stays predictable.
 */

'use strict';

const {
  detectLanguage,
  parseArea,
  parsePackage,
  parsePaymentMethod,
  parseCarType,
  parseDate,
  parseTime,
  parseName,
  parsePhone,
  validateBooking
} = require('../parsers');
const { ALL_OPERATING_HOURS, REQUIRED_FIELDS } = require('./tools');

// ---------------------------------------------------------------------------
// Intent classification (router agent's job, deterministic fallback)
// ---------------------------------------------------------------------------

const VALID_INTENTS = new Set([
  'book',
  'info',
  'reschedule',
  'cancel',
  'complaint',
  'human',
  'chitchat'
]);

const GREETING_PATTERNS = [
  /^\s*(hi|hello|hey|hallo|أهل|مرحب|سلام|hi there)\b/i
];

const INFO_PATTERNS = [
  /do you serve|serve|service area|coverage|covered areas/i,
  /how much|price|prices|cost|كم|بكام|أسعار|الثمن|was kostet|preis/i,
  /which (areas?|places?)|where (do you|are you)|أين|فين|مناطق|wo/i,
  /what (are|do you have|is included)|باقات|إيش|was bieten/i,
  /hours|working|open|متى|دوام|أوقات|wann|geöffnet/i,
  /packages?|plans?|باقات|pakete/i
];

const COMPLAINT_PATTERNS = [
  /complain|complaint|شكوى|problem|issue|terrible|bad|سيئ|مشكلة|reklamation|unzufrieden/i
];

const CANCEL_PATTERNS = [
  /cancel|cancellation|إلغاء|ألغي|stornieren|stornierung|absagen/i
];

const RESCHEDULE_PATTERNS = [
  /reschedule|change (the )?(time|date|booking)|modify|تغيير|بدل|verschieben|ändern|umplanen/i
];

const HUMAN_PATTERNS = [
  /manager|supervisor|person|human|someone|مسؤول|مدير|شخص|حقيقي|mitarbeiter|persönlich|sprechen/i,
  /كلم (حد|شخص|مسؤول|انسان)/i
];

const ANGRY_PATTERNS = [
  /(fuck|shit|damn|wtf|terrible|awful|horrible)/i,
  /تافه|سيئ جدا|أسوأ|قليل الأدب/i,
  /(unverschämt|respektlos|inakzeptabel)/i
];

/**
 * Extract the structured slots the router would surface.
 * Mirrors the AGENT_PROMPTS.md router schema. Pure function.
 *
 * @param {string} text
 * @returns {{
 *   customerName: string|null,
 *   phone: string|null,
 *   area: string|null,
 *   carType: string|null,
 *   package: string|null,
 *   date: string|null,
 *   time: string|null,
 *   location: string|null,
 *   paymentMethod: string|null,
 *   addOns: string[]
 * }}
 */
function extractSlots(text) {
  if (!text) {
    return {
      customerName: null,
      phone: null,
      area: null,
      carType: null,
      package: null,
      date: null,
      time: null,
      location: null,
      paymentMethod: null,
      addOns: []
    };
  }
  // parsePackage returns "<Name> - <price> EGP" but the orchestrator expects
  // the canonical name. Strip the suffix.
  let pkg = parsePackage(text);
  if (pkg) {
    if (pkg.startsWith('Essential')) pkg = 'Essential Wash';
    else if (pkg.startsWith('Smart')) pkg = 'Smart Wash';
    else if (pkg.startsWith('Premium')) pkg = 'Premium Detail';
  }
  const addOns = [];
  if (/engine\s*wash|غسيل\s*موتور|motorwäsche/i.test(text)) addOns.push('Engine Wash');
  if (/\bwax\b|شمع|wachsen/i.test(text)) addOns.push('Wax');
  if (/seat\s*cleaning|غسيل\s*كراسي|sitzreinigung/i.test(text)) addOns.push('Seat Cleaning');
  if (/paint\s*protection|حماية\s*الطلاء|lackschutz/i.test(text)) addOns.push('Paint Protection');
  // Location: look for a Google Maps link or an "address:" hint
  let location = null;
  const mapsMatch = text.match(/https?:\/\/(?:maps\.google|goo\.gl\/maps)\S+/i);
  if (mapsMatch) location = mapsMatch[0];
  else {
    const addrMatch = text.match(/(?:\baddress\b|\blocation\b|\bat\b|في|عنوان)\s*:?\s+([^\n,.]+)/i);
    if (addrMatch) location = addrMatch[1].trim();
  }
  return {
    customerName: parseName(text),
    phone: parsePhone(text),
    area: parseArea(text),
    carType: parseCarType(text),
    package: pkg,
    date: parseDate(text),
    time: parseTime(text),
    location,
    paymentMethod: parsePaymentMethod(text),
    addOns
  };
}

/**
 * Classify the customer's intent + sentiment + language + extracted slots.
 * Pure function, mirrors the RouterAgent prompt.
 *
 * @param {string} text
 * @param {Array} [_history] - ignored in deterministic mode (router uses it in LLM mode)
 * @returns {{
 *   language: 'ar'|'en'|'de',
 *   intent: 'book'|'info'|'reschedule'|'cancel'|'complaint'|'human'|'chitchat',
 *   slots: ReturnType<typeof extractSlots>,
 *   sentiment: 'positive'|'neutral'|'negative'|'angry',
 *   needsHuman: boolean
 * }}
 */
function classifyIntent(text, _history = []) {
  const language = detectLanguage(text || '');
  const lower = String(text || '').toLowerCase();

  // Sentiment first — angry overrides everything.
  const isAngry = ANGRY_PATTERNS.some((p) => p.test(text || ''));
  let sentiment = 'neutral';
  if (isAngry) sentiment = 'angry';
  else if (/(thanks|شكرا|merci|danke|great|awesome|love)/i.test(text || '')) sentiment = 'positive';
  else if (/(unfortunately|not happy|disappointed|غير راضي|leider)/i.test(text || '')) sentiment = 'negative';

  // Greeting-only short-circuits to chitchat.
  if (text && GREETING_PATTERNS.some((p) => p.test(text)) && text.trim().length < 20) {
    return {
      language,
      intent: 'chitchat',
      slots: extractSlots(text),
      sentiment,
      needsHuman: false
    };
  }

  let intent = 'chitchat';
  if (CANCEL_PATTERNS.some((p) => p.test(text || ''))) intent = 'cancel';
  else if (COMPLAINT_PATTERNS.some((p) => p.test(text || ''))) intent = 'complaint';
  else if (RESCHEDULE_PATTERNS.some((p) => p.test(text || ''))) intent = 'reschedule';
  else if (HUMAN_PATTERNS.some((p) => p.test(text || ''))) intent = 'human';
  else if (
    // Book takes priority over info when ANY of these are present:
    //  - a clear booking verb
    //  - an area (El Gouna, Hurghada, Sahl Hasheesh) — usually "I am in X"
    //  - a date (e.g. "tomorrow", "next Friday")
    // "I want the Smart Wash" alone is treated as info, not as book.
    /(book|booking|reserve|حجز|احجز|reservieren|termin|buchen)/i.test(text || '') ||
    (extractSlots(text).area && !INFO_PATTERNS.some((p) => p.test(text || ''))) ||
    extractSlots(text).date
  ) {
    intent = 'book';
  } else if (INFO_PATTERNS.some((p) => p.test(text || ''))) {
    intent = 'info';
  }

  const slots = extractSlots(text);
  const needsHuman =
    intent === 'complaint' ||
    intent === 'cancel' ||
    intent === 'reschedule' ||
    intent === 'human' ||
    sentiment === 'angry';

  if (!VALID_INTENTS.has(intent)) intent = 'chitchat';

  return { language, intent, slots, sentiment, needsHuman };
}

// ---------------------------------------------------------------------------
// Routing decision (orchestrator's job)
// ---------------------------------------------------------------------------

const VALID_AGENTS = new Set(['router', 'intake', 'booking', 'handoff']);

/**
 * Decide which agent to call next given the router output.
 * Pure function, mirrors the orchestrator prompt.
 *
 * Rules:
 *   - needsHuman=true  → handoff (overrides intent)
 *   - intent ∈ {cancel, reschedule, complaint, human} → handoff
 *   - intent = chitchat | info → intake
 *   - intent = book:
 *     - if all booking fields present → booking
 *     - else → intake (collect missing, then re-router)
 *
 * @param {ReturnType<typeof classifyIntent>} routerOutput
 * @param {string} [phone] - phone is supplied by the webhook (not the chat
 *                           content). When present, it's used in the "all
 *                           fields present" check so the orchestrator can
 *                           route to the BookingAgent even when the customer
 *                           hasn't typed their number yet.
 * @returns {'router'|'intake'|'booking'|'handoff'}
 */
function decideRoute(routerOutput, phone) {
  if (!routerOutput || typeof routerOutput !== 'object') return 'router';
  const { intent, needsHuman, slots } = routerOutput;
  if (needsHuman) return 'handoff';
  if (intent === 'cancel' || intent === 'reschedule' || intent === 'complaint' || intent === 'human') {
    return 'handoff';
  }
  const allPresent = REQUIRED_FIELDS.every((f) => {
    const key = f === 'preferredDate' ? 'date' : f === 'preferredTime' ? 'time' : f;
    const v = key === 'phone' ? (phone || slots?.[key]) : slots?.[key];
    return v != null && String(v).trim() !== '';
  });
  if (allPresent) return 'booking';
  if (intent === 'chitchat' || intent === 'info') return 'intake';
  if (intent === 'book') {
    const allBookFieldsPresent = REQUIRED_FIELDS.every((f) => {
      // REQUIRED_FIELDS uses 'preferredDate' / 'preferredTime' but slots uses
      // 'date' / 'time'. Map them. Phone comes from the webhook when present.
      const key = f === 'preferredDate' ? 'date' : f === 'preferredTime' ? 'time' : f;
      const v = key === 'phone' ? (phone || slots?.[key]) : slots?.[key];
      return v != null && String(v).trim() !== '';
    });
    return allBookFieldsPresent ? 'booking' : 'intake';
  }
  return 'intake';
}

// ---------------------------------------------------------------------------
// Booking validation (booking agent's job)
// ---------------------------------------------------------------------------

/**
 * Validate that the slots produced by router + intake are bookable.
 * Returns { valid, missing, slotOk, slotReason, inPast }.
 *
 * @param {Object} slots
 * @param {string} [phone] - phone is required for booking but may be passed
 *                           in separately by the orchestrator (it's known from
 *                           the webhook, not the chat content).
 */
function validateBookingFields(slots, phone) {
  const candidate = {
    customerName: slots?.customerName,
    phone: phone || slots?.phone,
    area: slots?.area,
    carType: slots?.carType,
    package: slots?.package,
    preferredDate: slots?.date,
    preferredTime: slots?.time,
    location: slots?.location,
    paymentMethod: slots?.paymentMethod
  };
  const v = validateBooking(candidate);

  // Future-date check (router strips past dates to null, but belt + braces)
  let inPast = false;
  if (candidate.preferredDate) {
    const [y, m, d] = candidate.preferredDate.split('-').map(Number);
    if (y && m && d) {
      const target = new Date(y, m - 1, d);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      inPast = target.getTime() < today.getTime();
    }
  }

  // Time-window check (09:00-17:00, inclusive)
  let slotReason = null;
  if (candidate.preferredTime) {
    const hour = parseInt(String(candidate.preferredTime).split(':')[0], 10);
    if (Number.isNaN(hour) || hour < 9 || hour > 17) {
      slotReason = 'outside-hours';
    }
  }

  return {
    valid: v.valid && !inPast && !slotReason,
    missing: v.missing,
    inPast,
    slotReason
  };
}

// ---------------------------------------------------------------------------
// Build a normalized pending booking (booking agent's job)
// ---------------------------------------------------------------------------

function buildPendingBooking(slots, phone) {
  return {
    customerName: slots?.customerName || null,
    phone: phone || slots?.phone || null,
    area: slots?.area || null,
    carType: slots?.carType || null,
    package: slots?.package || null,
    date: slots?.date || null,
    time: slots?.time || null,
    location: slots?.location || null,
    paymentMethod: slots?.paymentMethod || null,
    notes: (slots?.addOns && slots.addOns.length) ? `Add-ons: ${slots.addOns.join(', ')}` : null
  };
}

// ---------------------------------------------------------------------------
// Handoff (escalation agent's job)
// ---------------------------------------------------------------------------

const URGENCY_RULES = {
  high: (intent, sentiment) =>
    sentiment === 'angry' ||
    (intent === 'complaint' && /(damage|theft|stolen|safety|broken|injured|تالف|مسروق|خطر)/i.test(arguments[2] || '')),
  medium: (intent) => intent === 'cancel' || intent === 'reschedule' || intent === 'complaint',
  low: () => true
};

/**
 * Determine urgency for a handoff ticket.
 * @param {string} intent
 * @param {string} sentiment
 * @param {string} [rawMessage] - the original message text (for "damage" detection)
 * @returns {'high'|'medium'|'low'}
 */
function urgencyFor(intent, sentiment, rawMessage) {
  if (
    sentiment === 'angry' ||
    (intent === 'complaint' &&
      /(damage|theft|stolen|safety|broken|injured|تالف|مسروق|اتسرق|سرقت|خطر)/i.test(rawMessage || ''))
  ) {
    return 'high';
  }
  if (intent === 'cancel' || intent === 'reschedule' || intent === 'complaint') return 'medium';
  return 'low';
}

const HANDOFF_REPLIES = {
  ar: 'شكراً لصبرك. هيتم التواصل معاك خلال 10 دقايق على الواتساب.',
  en: 'Thanks for your patience. The team will reach out on WhatsApp within 10 minutes.',
  de: 'Danke für Ihre Geduld. Das Team meldet sich innerhalb von 10 Minuten per WhatsApp.'
};

/**
 * Format the user-facing reply for a handoff.
 * @param {'ar'|'en'|'de'} language
 * @param {string} [urgency]
 */
function formatHandoffReply(language = 'en', urgency = 'medium') {
  const base = HANDOFF_REPLIES[language] || HANDOFF_REPLIES.en;
  if (urgency === 'high' && language === 'ar') return 'آسفين على اللي حصل. ' + base;
  if (urgency === 'high' && language === 'de') return 'Es tut uns leid. ' + base;
  if (urgency === 'high') return "We're sorry that happened. " + base;
  return base;
}

// ---------------------------------------------------------------------------
// Intake (greeting + slot collection) — minimal template replies
// Pure functions; the LLM agent can override these in production.
// ---------------------------------------------------------------------------

const ASK_NEXT_FIELD = {
  customerName: {
    ar: 'يا ريت تقولي اسمك بالكامل؟',
    en: 'What is your full name please?',
    de: 'Wie ist Ihr vollständiger Name?'
  },
  phone: {
    ar: 'ممكن رقم واتساب للتأكيد؟',
    en: 'What WhatsApp phone number should we use to confirm?',
    de: 'Welche WhatsApp-Nummer sollen wir zur Bestätigung nutzen?'
  },
  area: {
    ar: 'حضرتك في أي منطقة؟ (الجونة، الغردقة، أو سهل حشيش)؟',
    en: 'Which area are you in? (El Gouna, Hurghada, or Sahl Hasheesh)?',
    de: 'In welchem Gebiet sind Sie? (El Gouna, Hurghada oder Sahl Hasheesh)?'
  },
  carType: {
    ar: 'إيه نوع عربيتك؟',
    en: 'What type of car do you have?',
    de: 'Welchen Fahrzeugtyp haben Sie?'
  },
  package: {
    ar: 'تحب تختار أنهي باقة؟\n1. الغسلة الأساسية 250 جنيه\n2. الغسلة الذكية 300 جنيه\n3. تفصيل بريميوم 350 جنيه',
    en: 'Which package?\n1. Essential Wash - 250 EGP\n2. Smart Wash - 300 EGP\n3. Premium Detail - 350 EGP',
    de: 'Welches Paket?\n1. Essential Wash - 250 EGP\n2. Smart Wash - 300 EGP\n3. Premium Detail - 350 EGP'
  },
  preferredDate: {
    ar: 'حابب الغسيل يكون يوم إيه؟',
    en: 'What date would you like?',
    de: 'Welches Datum?'
  },
  preferredTime: {
    ar: 'الساعة كام؟ (بين 9 الصبح و5 بالليل)',
    en: 'What time? (between 9 AM and 5 PM)',
    de: 'Welche Uhrzeit? (zwischen 9 und 17 Uhr)'
  },
  location: {
    ar: 'ممكن تبعتلنا العنوان أو لوكيشن جوجل مابس؟',
    en: 'Please send your address or Google Maps location.',
    de: 'Bitte senden Sie Ihre Adresse oder Google Maps.'
  },
  paymentMethod: {
    ar: 'طريقة الدفع إيه؟ (كاش، InstaPay على رقم 01555567205، فودافون كاش، فوري)',
    en: 'How will you pay? (Cash, InstaPay to 01555567205, Vodafone Cash, Fawry)',
    de: 'Wie möchten Sie bezahlen? (Bargeld, InstaPay an 01555567205, Vodafone Cash, Fawry)'
  }
};

const GREETING_REPLIES = {
  ar: 'أهلاً بك في كار شاين Red Sea! 🚗✨ تحب تحجز الغسلة الأساسية (250 جنيه) ولا الغسلة الذكية؟',
  en: "Welcome to CarShine Red Sea! 🚗✨ We offer premium mobile car wash in El Gouna, Hurghada, and Sahl Hasheesh. Would you like to book an Essential Wash (250 EGP) or Smart Wash?",
  de: 'Willkommen bei CarShine Red Sea! 🚗✨ Mobile Autowäsche in El Gouna, Hurghada, Sahl Hasheesh. Möchten Sie Essential Wash (250 EGP) oder Smart Wash buchen?'
};

/**
 * Generate a deterministic intake reply for a given language + missing field.
 * @param {string} language
 * @param {string|null} missingField
 * @param {{customerName?: string}} [opts]
 */
function intakeReply(language, missingField, opts = {}) {
  if (!missingField) {
    const name = opts.customerName;
    if (opts.returningCustomer && name) {
      const last = opts.lastBooking;
      const lastHint = last?.preferredDate
        ? (language === 'ar'
          ? ` آخر حجز كان ${last.preferredDate}`
          : language === 'de'
            ? ` Letzte Buchung: ${last.preferredDate}`
            : ` Last booking: ${last.preferredDate}`)
        : '';
      if (language === 'ar') {
        return `منورنا تاني يا ${name}!${lastHint} تحب تحجز الغسلة الأساسية ولا الغسلة الذكية؟`;
      }
      if (language === 'de') {
        return `Willkommen zurück, ${name}!${lastHint} Möchten Sie Essential Wash oder Smart Wash buchen?`;
      }
      return `Welcome back, ${name}!${lastHint} Would you like to book an Essential Wash or Smart Wash?`;
    }
    return GREETING_REPLIES[language] || GREETING_REPLIES.en;
  }
  const tpl = ASK_NEXT_FIELD[missingField];
  if (!tpl) {
    return tpl?.en || GREETING_REPLIES[language] || GREETING_REPLIES.en;
  }
  // Personalized greeting when we have the name and the next field is not the name itself
  if (opts.customerName && missingField !== 'customerName' && language === 'ar') {
    return `${tpl.ar} (${opts.customerName})`;
  }
  return (tpl[language] || tpl.en);
}

// ---------------------------------------------------------------------------
// Chitchat / smalltalk / off-topic replies
// ---------------------------------------------------------------------------

const HOWAREYOU_PATTERNS = [
  /how are you|how'?s it going|how do you do|how have you been/i,
  /(ازيك|إزيك|عامل ايه|عامل إيه|كيف حالك|أخبارك|اخبارك)/i,
  /wie geht('?s| es dir| es Ihnen)/i
];

const QUESTION_LEADIN_PATTERNS = [
  /(other|another|more) (question|questions)|i have (a )?question|can i ask|i want to ask|just asking/i,
  /(عندي|عايز اسأل|ممكن سؤال|سؤال تاني|أسئلة)/i,
  /(noch eine|andere) frage|ich habe eine frage|darf ich fragen/i
];

const THANKS_PATTERNS = [
  /thank|thanks|thx|appreciate/i, /شكرا|متشكر|تسلم/i, /danke|vielen dank/i
];

const HOWAREYOU_REPLIES = {
  en: "I'm doing great, thanks for asking! 😊 How can I help with your car wash today — pricing, service areas, or booking a wash?",
  ar: 'الحمد لله تمام، شكراً لسؤالك! 😊 أقدر أساعدك إزاي النهارده — الأسعار، المناطق، ولا تحب نحجزلك غسيل؟',
  de: 'Mir geht es gut, danke der Nachfrage! 😊 Wie kann ich helfen — Preise, Servicegebiete oder eine Wäsche buchen?'
};

const QUESTION_LEADIN_REPLIES = {
  en: 'Of course! Ask me anything about our car wash — packages, prices, service areas, payment, or booking a slot. 🚗',
  ar: 'بكل سرور! اسألني أي حاجة عن غسيل السيارات — الباقات، الأسعار، المناطق، الدفع، أو حجز موعد. 🚗',
  de: 'Natürlich! Fragen Sie mich alles zur Autowäsche — Pakete, Preise, Gebiete, Zahlung oder Terminbuchung. 🚗'
};

const THANKS_REPLIES = {
  en: "You're welcome! 😊 Want me to book a wash for you or share our packages?",
  ar: 'العفو! 😊 تحب أحجزلك غسيل ولا أبعتلك الباقات؟',
  de: 'Gern geschehen! 😊 Soll ich eine Wäsche buchen oder die Pakete zeigen?'
};

const OFFTOPIC_REFUSAL = {
  en: 'Sorry, I can only help with CarShine Red Sea car wash services, bookings, packages, payment steps, and WhatsApp handoff. You can WhatsApp our team at +20 155 556 7205.',
  ar: 'آسف، أقدر أساعدك بس في خدمات كار شاين ريد سي لغسيل السيارات، الحجوزات، الباقات، خطوات الدفع، والتحويل لواتساب. كلّم فريقنا على واتساب: ‎+20 155 556 7205.',
  de: 'Entschuldigung, ich kann nur bei CarShine Red Sea helfen: Autowäsche, Buchungen, Pakete, Zahlung und WhatsApp-Weiterleitung. WhatsApp-Team: +20 155 556 7205.'
};

/**
 * Reply for chitchat/smalltalk turns when no booking is in progress.
 * Greetings → warm welcome (keeps returning-customer personalization).
 * "How are you" / thanks / "I have a question" → friendly on-topic reply.
 * Anything clearly off-topic → a polite, scoped refusal (per AGENTS.md).
 */
function chitchatReply(language, message, opts = {}) {
  const lang = HOWAREYOU_REPLIES[language] ? language : 'en';
  const text = String(message || '');
  if (HOWAREYOU_PATTERNS.some((p) => p.test(text))) return HOWAREYOU_REPLIES[lang];
  if (QUESTION_LEADIN_PATTERNS.some((p) => p.test(text))) return QUESTION_LEADIN_REPLIES[lang];
  if (THANKS_PATTERNS.some((p) => p.test(text))) return THANKS_REPLIES[lang];
  // Greeting (or empty first turn) → warm welcome.
  if (!text.trim() || GREETING_PATTERNS.some((p) => p.test(text))) {
    return intakeReply(language, null, opts);
  }
  // Otherwise the message is off-topic for a car-wash assistant → refuse politely.
  return OFFTOPIC_REFUSAL[lang];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

module.exports = {
  // Router
  extractSlots,
  classifyIntent,
  // Orchestrator
  decideRoute,
  // Booking
  validateBookingFields,
  buildPendingBooking,
  // Handoff
  urgencyFor,
  formatHandoffReply,
  // Intake templates
  intakeReply,
  chitchatReply,
  // Re-exports
  ALL_OPERATING_HOURS,
  REQUIRED_FIELDS
};
