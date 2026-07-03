/**
 * MiniMax AI Agent Module
 * 
 * Integrates MiniMax API as the autonomous agent brain.
 * This is what the user asked to integrate so the agent can:
 * - Answer users directly
 * - Handle bookings
 * - Send notifications
 * - Manage calendar
 * - Be the chat assistant on the website
 * 
 * Falls back to Gemini if MiniMax is unavailable.
 * Falls back to rule-based response if no API is configured.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');
const { trace } = require('./observability/langfuse');

// ============================================================================
// CONFIGURATION
// ============================================================================

const MiniMax_API_KEY=process.env.MiniMax_API_KEY;
const MiniMax_MODEL = process.env.MiniMax_MODEL || 'MiniMax-M3';
const MiniMax_API_URL = process.env.MiniMax_URL || 'https://api.MiniMax.io/v1/text/chatcompletion_v2';

const GEMINI_API_KEY=process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Active agent provider: 'minimax' | 'gemini' | 'fallback'
let ACTIVE_PROVIDER = 'fallback';
if (MiniMax_API_KEY) ACTIVE_PROVIDER = 'minimax';
else if (GEMINI_API_KEY) ACTIVE_PROVIDER = 'gemini';

if (ACTIVE_PROVIDER === 'fallback') {
  console.warn('[Agent] No AI provider configured - using rule-based fallback');
} else {
  console.log(`[Agent] Active provider: ${ACTIVE_PROVIDER} (${ACTIVE_PROVIDER === 'minimax' ? MiniMax_MODEL : GEMINI_MODEL})`);
}

// ============================================================================
// WEBSITE CONTENT (Knowledge Base)
// ============================================================================

const WEBSITE_CONTENT = `CarShine Red Sea - Premium Mobile Car Wash Service in Egypt.
Areas served: El Gouna, Hurghada, Sahl Hasheesh.

PACKAGES:
1. Essential Wash - 250 EGP (one-time, exterior, glass, wheels, light interior refresh)
2. Smart Wash - 300 EGP (complete exterior, glass, tires, light interior, reminders)
3. Premium Detail - 350 EGP (fuller interior refresh, priority slot, finish check, add-on discounts)

ADD-ONS:
- Engine Wash: 75 EGP
- Wax: 50 EGP
- Seat Cleaning: 60 EGP
- Paint Protection: 100 EGP

PAYMENT METHODS: Cash, InstaPay, Vodafone Cash, Orange Cash, Fawry, Bank Transfer.
INSTAPAY: Customers inside Egypt can pay to mobile number 01555567205 and should send a receipt screenshot before final confirmation.

OPERATING HOURS: 9:00 AM - 6:00 PM daily.
SLOT CAPACITY: Maximum 2 washes per hour. Washes take 30-60 minutes.

CONTACT: WhatsApp booking preferred.`;

const BOOKING_FIELDS = [
  'customerName', 'area', 'carType', 'package', 'preferredDate',
  'preferredTime', 'location', 'paymentMethod', 'phone'
];

function buildSystemPrompt(language = 'en') {
  return `You are Layla, the AI Booking Assistant for CarShine Red Sea - a premium mobile car wash service in Egypt.
Your job is to help customers book a car wash quickly and naturally. You should be warm, efficient, and multilingual.

### KNOWLEDGE BASE
${WEBSITE_CONTENT}

### LANGUAGE
You MUST reply in the user's language:
- Egyptian Arabic (colloquial, warm, friendly): "يا فندم", "منورنا", "حبيبي", "تمام يا باشا", "حاضر من عينيا". Use colloquial terms. Do NOT use formal Fusha Arabic.
- English (professional and friendly)
- German (reliable, precise, polite)

### BOOKING PROCESS
To complete a booking, you must collect these details (extract from the conversation):
1. Full name
2. WhatsApp number
3. Area: must be 'El Gouna', 'Hurghada', or 'Sahl Hasheesh'
4. Car type/model
5. Package: Essential Wash, Smart Wash, or Premium Detail
6. Date in YYYY-MM-DD format
7. Time in HH:MM format (24-hour, between 09:00 and 17:00)
8. Google Maps location or detailed address
9. Payment method (Cash, InstaPay, Vodafone Cash, Orange Cash, Fawry, Bank Transfer). If InstaPay, tell the customer to pay to 01555567205 and send the receipt screenshot.

If any details are missing, ask for them ONE at a time in the REPLY. Be conversational, not robotic.
If the slot is unavailable (already 2 bookings in that hour, or outside 09:00-17:00), explain and suggest alternatives.

### CURRENT CONTEXT
- Date now: ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' })} (Timezone: Africa/Cairo, ISO: ${new Date().toISOString()})
- Language detected: ${language}

### HUMAN TAKEOVER
Set HUMAN_NEED to true if the customer:
- Wants to cancel or reschedule
- Has a complaint
- Asks something you cannot answer
- Explicitly asks for a human/manager

### OUTPUT FORMAT
You MUST output a single JSON object (no other text, no markdown):

{
  "REPLY": "your chat response in the user's language",
  "PENDING_BOOKING": {
    "name": "extracted name or null",
    "whatsapp": "extracted phone or null",
    "area": "El Gouna/Hurghada/Sahl Hasheesh or null",
    "carType": "extracted car type or null",
    "package": "Essential Wash/Smart Wash/Premium Detail or null",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "location": "address/maps URL or null",
    "paymentMethod": "Cash/InstaPay/Vodafone Cash/Orange Cash/Fawry/Bank Transfer or null",
    "notes": "any add-ons or special requests"
  } | null,
  "HUMAN_NEED": true | false
}

Set PENDING_BOOKING to null if ANY required field is missing.`;
}

// ============================================================================
// MiniMax API CLIENT
// ============================================================================

async function callMiniMax(messages, language = 'en') {
  const systemPrompt = buildSystemPrompt(language);
  
  // OpenAI-compatible format (works with MiniMax-M3 and similar APIs)
  const apiMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  
  const res = await fetch(MiniMax_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + MiniMax_API_KEY
    },
    body: JSON.stringify({
      model: MiniMax_MODEL,
      max_tokens: 1024,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: apiMessages
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax API error: ${res.status} - ${err}`);
  }
  
  const data = await res.json();
  
  // OpenAI-compatible: data.choices[0].message.content
  // Also handle MiniMax-specific error response (base_resp.status_code)
  if (data.base_resp && data.base_resp.status_code && data.base_resp.status_code !== 0) {
    const code = data.base_resp.status_code;
    const msg = data.base_resp.status_msg || 'Unknown error';
    if (code === 1008) {
      throw new Error('MiniMax account has insufficient balance. Please top up at MiniMax.io');
    }
    if (code === 1002 || code === 1004) {
      throw new Error('MiniMax rate limit exceeded. Please wait and retry.');
    }
    if (code === 1001 || code === 1003) {
      throw new Error('MiniMax authentication failed. Check your API key.');
    }
    throw new Error('MiniMax API error (' + code + '): ' + msg);
  }
  
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid MiniMax response: no choices/message (status: ' + JSON.stringify(data.base_resp || {}) + ')');
  }
  
  let text = data.choices[0].message.content.trim();
  text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  
  return JSON.parse(text);
}
// ============================================================================
// GEMINI API CLIENT (fallback)
// ============================================================================

let genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

async function callGemini(userMessage, chatHistory, language) {
  if (!genAI) throw new Error('Gemini not configured');
  
  const systemPrompt = buildSystemPrompt(language);
  
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
      maxOutputTokens: 1024
    },
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] }
  });
  
  // Build conversation history
  const history = chatHistory.slice(-10).map(msg => ({
    role: msg.sender === 'bot' ? 'model' : 'user',
    parts: [{ text: msg.text }]
  }));
  
  const chat = model.startChat({ history });
  const result = await chat.sendMessage(userMessage);
  const text = result.response.text();
  
  return JSON.parse(text);
}

// ============================================================================
// RULE-BASED FALLBACK (when no API configured)
// ============================================================================

const FALLBACK_RESPONSES = {
  ar: {
    greeting: 'أهلاً بك في كار شاين Red Sea! 🚗✨ تحب تحجز الغسلة الأساسية (250 جنيه) ولا الغسلة الذكية؟',
    ask_name: 'يا ريت تقولي اسمك بالكامل؟',
    ask_area: 'حضرتك في أي منطقة؟ (الجونة، الغردقة، أو سهل حشيش)؟',
    ask_car: 'إيه نوع عربيتك؟',
    ask_package: 'تحب تختار أنهي باقة؟\n1. الغسلة الأساسية 250 جنيه\n2. الغسلة الذكية 300 جنيه\n3. تفصيل بريميوم 350 جنيه',
    ask_date: 'حابب الغسيل يكون يوم إيه؟',
    ask_time: 'الساعة كام؟ (بين 9 الصبح و5 بالليل)',
    ask_location: 'ممكن تبعتلنا العنوان أو لوكيشن جوجل مابس؟',
    ask_payment: 'طريقة الدفع إيه؟ (كاش، InstaPay على رقم 01555567205، فودافون كاش، فوري)',
    error: 'محتاج معلومات أكتر عشان أقدر أساعدك.',
    human: 'هنوصلك بمسؤول يرد عليك فوراً.'
  },
  en: {
    greeting: "Welcome to CarShine Red Sea! 🚗✨ We offer premium mobile car wash in El Gouna, Hurghada, and Sahl Hasheesh. Would you like to book an Essential Wash (250 EGP) or Smart Wash?",
    ask_name: 'What is your full name please?',
    ask_area: 'Which area are you in? (El Gouna, Hurghada, or Sahl Hasheesh)?',
    ask_car: 'What type of car do you have?',
    ask_package: 'Which package?\n1. Essential Wash - 250 EGP\n2. Smart Wash - 300 EGP\n3. Premium Detail - 350 EGP',
    ask_date: 'What date would you like?',
    ask_time: 'What time? (between 9 AM and 5 PM)',
    ask_location: 'Please send your address or Google Maps location.',
    ask_payment: 'How will you pay? (Cash, InstaPay to 01555567205, Vodafone Cash, Fawry)',
    error: 'I need a bit more information to help you.',
    human: "I'll connect you with a human agent right away."
  },
  de: {
    greeting: 'Willkommen bei CarShine Red Sea! 🚗✨ Mobile Autowäsche in El Gouna, Hurghada, Sahl Hasheesh. Möchten Sie eine Essential Wash (250 EGP) buchen?',
    ask_name: 'Wie ist Ihr vollständiger Name?',
    ask_area: 'In welchem Gebiet sind Sie? (El Gouna, Hurghada oder Sahl Hasheesh)?',
    ask_car: 'Welchen Fahrzeugtyp haben Sie?',
    ask_package: 'Welches Paket?\n1. Essential Wash - 250 EGP\n2. Smart Wash - 300 EGP\n3. Premium Detail - 350 EGP',
    ask_date: 'Welches Datum?',
    ask_time: 'Welche Uhrzeit? (zwischen 9 und 17 Uhr)',
    ask_location: 'Bitte senden Sie Ihre Adresse oder Google Maps.',
    ask_payment: 'Wie möchten Sie bezahlen? (Bargeld, InstaPay an 01555567205, Vodafone Cash, Fawry)',
    error: 'Ich brauche noch ein paar Informationen.',
    human: 'Ich verbinde Sie sofort mit einem Mitarbeiter.'
  }
};

function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'en';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/(hallo|gut|tag|bitte|waschen|auto|deutsch|ich|mochte|möchte|ja|nein)/i.test(text)) return 'de';
  return 'en';
}

function fallbackResponse(message, existingDetails = {}) {
  const lower = (message || '').toLowerCase();
  const lang = detectLanguage(message);
  const r = FALLBACK_RESPONSES[lang];
  
  // Detect human takeover
  if (lower.includes('cancel') || lower.includes('إلغاء') || lower.includes('stornieren') ||
      lower.includes('complain') || lower.includes('شكوى') || lower.includes('problem')) {
    return { REPLY: r.human, PENDING_BOOKING: null, HUMAN_NEED: true };
  }
  
  // Greeting
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('أهل') || lower.includes('مرحب') || lower.includes('hallo')) {
    return { REPLY: r.greeting, PENDING_BOOKING: null, HUMAN_NEED: false };
  }
  
  // Determine which field to ask for next
  if (!existingDetails.customerName) return { REPLY: r.ask_name, PENDING_BOOKING: null, HUMAN_NEED: false };
  if (!existingDetails.area) return { REPLY: r.ask_area, PENDING_BOOKING: null, HUMAN_NEED: false };
  if (!existingDetails.carType) return { REPLY: r.ask_car, PENDING_BOOKING: null, HUMAN_NEED: false };
  if (!existingDetails.package) return { REPLY: r.ask_package, PENDING_BOOKING: null, HUMAN_NEED: false };
  if (!existingDetails.preferredDate) return { REPLY: r.ask_date, PENDING_BOOKING: null, HUMAN_NEED: false };
  if (!existingDetails.preferredTime) return { REPLY: r.ask_time, PENDING_BOOKING: null, HUMAN_NEED: false };
  if (!existingDetails.location) return { REPLY: r.ask_location, PENDING_BOOKING: null, HUMAN_NEED: false };
  if (!existingDetails.paymentMethod) return { REPLY: r.ask_payment, PENDING_BOOKING: null, HUMAN_NEED: false };
  
  return { REPLY: r.error, PENDING_BOOKING: null, HUMAN_NEED: false };
}

// ============================================================================
// UNIFIED AI AGENT (the brain)
// ============================================================================

async function getAgentResponse(userMessage, chatHistory = [], existingDetails = {}, language = null, sessionId = null) {
  const lang = language || detectLanguage(userMessage);

  return trace(
    {
      sessionId: sessionId || 'session_unbound',
      name: 'orchestrator.getAgentResponse',
      metadata: {
        chatSessionId: sessionId || null,
        language: lang,
        provider: ACTIVE_PROVIDER
      },
      input: userMessage
    },
    async () => {
      // Try MiniMax first
      if (ACTIVE_PROVIDER === 'minimax') {
        try {
          const messages = chatHistory.slice(-10).map(m => ({
            role: m.sender === 'bot' ? 'assistant' : 'user',
            content: m.text
          }));
          messages.push({ role: 'user', content: userMessage });

          const result = await callMiniMax(messages, lang);
          return normalizeResult(result);
        } catch (err) {
          console.error('[MiniMax] Error:', err.message);
          // Fall through to Gemini
        }
      }

      // Try Gemini
      if (ACTIVE_PROVIDER === 'gemini' || (ACTIVE_PROVIDER === 'minimax' && GEMINI_API_KEY)) {
        try {
          const result = await callGemini(userMessage, chatHistory, lang);
          return normalizeResult(result);
        } catch (err) {
          console.error('[Gemini] Error:', err.message);
        }
      }

      // Final fallback: rule-based
      return fallbackResponse(userMessage, existingDetails);
    }
  );
}

function normalizeResult(result) {
  return {
    REPLY: result.REPLY || result.reply || '...',
    PENDING_BOOKING: result.PENDING_BOOKING || result.pending_booking || null,
    HUMAN_NEED: result.HUMAN_NEED ?? result.human_need ?? false
  };
}

// ============================================================================
// CHAT HANDLER (used by webhook, dashboard, and website widget)
// ============================================================================

async function handleIncomingMessage(phone, message, profileName) {
  // Pre-trace: open the session id (sync, no fn) so we always have a
  // sessionId to attach to the inner agent trace.
  let session = null;
  const existingChats = db.getChatsByStatus('active');
  session = existingChats.find(c => c.phone === phone && c.status === 'active');

  const sessionIdForTrace = session ? session.id : 'session_pending';
  const language = detectLanguage(message);

  // Outer timing/result trace — records a single orchestrator line
  // with the final outcome tagged on metadata.
  const finalResult = await trace(
    {
      sessionId: sessionIdForTrace,
      name: 'orchestrator.handleIncomingMessage',
      metadata: {
        chatSessionId: sessionIdForTrace,
        language,
        finalOutcome: 'pending',
        phone
      },
      input: message
    },
    async () => {
      return _handleIncomingMessageInner(phone, message, profileName, session);
    }
  );

  // Emit a follow-up "outcome" trace so the final outcome is recorded
  // as part of the trace stream (it shows up in the JSONL log and the
  // dashboard's recent-traces view).
  const outcome = finalResult && finalResult.bookingCreated
    ? 'booking_created'
    : (finalResult && finalResult.humanNeeded ? 'human_handoff' : 'replied');

  await trace(
    {
      sessionId: sessionIdForTrace,
      name: 'orchestrator.outcome',
      metadata: {
        chatSessionId: sessionIdForTrace,
        language,
        finalOutcome: outcome,
        bookingCreated: Boolean(finalResult && finalResult.bookingCreated),
        bookingId: (finalResult && finalResult.bookingId) || null,
        humanNeeded: Boolean(finalResult && finalResult.humanNeeded)
      },
      input: outcome
    },
    async () => outcome
  );

  return finalResult;
}

async function _handleIncomingMessageInner(phone, message, profileName, sessionArg) {
  // Get or create chat session
  let session = sessionArg;
  if (!session) {
    const existingChats = db.getChatsByStatus('active');
    session = existingChats.find(c => c.phone === phone && c.status === 'active');
  }

  if (!session) {
    session = {
      id: 'session_' + Date.now(),
      customerName: profileName || 'Unknown',
      phone,
      area: '', carType: '', package: '',
      preferredDate: '', preferredTime: '',
      location: '', paymentMethod: '',
      status: 'active',
      language: 'en',
      lastAskedField: 'customerName',
      bookingDetails: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.createChat(session, { text: message, timestamp: new Date().toISOString() });
  } else {
    db.addMessage(session.id, 'customer', message, new Date().toISOString());
    session = db.getChat(session.id);
  }

  const chatHistory = session.messages || [];
  const existingDetails = session.bookingDetails || {};

  // Call unified agent (traced with chatSessionId for grouping)
  const result = await getAgentResponse(message, chatHistory, existingDetails, null, session.id);

  // Add bot reply to chat
  db.addMessage(session.id, 'bot', result.REPLY, new Date().toISOString());

  // If we have a complete booking, create it
  if (result.PENDING_BOOKING) {
    const p = result.PENDING_BOOKING;

    // Check slot availability
    if (p.date && p.time) {
      const available = db.isSlotAvailable(p.date, p.time);
      if (!available) {
        const lang = detectLanguage(message);
        const langMsgs = {
          ar: '\n\n(عذراً، الميعاد ده محجوز. ممكن تختار وقت تاني؟)',
          en: "\n\n(Sorry, that time slot is already booked. Could you pick another time?)",
          de: "\n\n(Entschuldigung, dieser Termin ist vergeben. Können Sie eine andere Uhrzeit wählen?)"
        };
        return {
          reply: result.REPLY + (langMsgs[lang] || langMsgs.en),
          bookingCreated: false,
          bookingId: null,
          humanNeeded: result.HUMAN_NEED
        };
      }
    }

    // Create the booking
    const bookingId = 'b_' + Date.now();
    const booking = {
      id: bookingId,
      customerName: p.name || 'Unknown',
      phone: p.whatsapp || phone,
      area: p.area || '',
      carType: p.carType || '',
      package: p.package || '',
      preferredDate: p.date || '',
      preferredTime: p.time || '',
      location: p.location || '',
      paymentMethod: p.paymentMethod || '',
      status: 'pending',
      notes: p.notes || 'Created via AI Agent (' + ACTIVE_PROVIDER + ')',
      createdAt: new Date().toISOString(),
      chatSessionId: session.id
    };

    db.createBooking(booking, session.id);
    db.updateChat(session.id, {
      status: 'waiting_approval',
      lastAskedField: null,
      bookingDetails: {}
    });

    return {
      reply: result.REPLY,
      bookingCreated: true,
      bookingId,
      humanNeeded: result.HUMAN_NEED
    };
  }

  return {
    reply: result.REPLY,
    bookingCreated: false,
    bookingId: null,
    humanNeeded: result.HUMAN_NEED
  };
}

module.exports = {
  // Main functions
  handleIncomingMessage,
  getAgentResponse,
  fallbackResponse,
  
  // Config
  ACTIVE_PROVIDER,
  MiniMax_API_KEY,
  GEMINI_API_KEY,
  
  // Utilities
  detectLanguage,
  buildSystemPrompt
};
