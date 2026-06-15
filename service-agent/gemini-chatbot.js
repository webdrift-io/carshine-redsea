/**
 * Gemini Chatbot Module
 * Handles WhatsApp message processing using Google Generative AI
 * Returns structured responses: REPLY, PENDING_BOOKING, HUMAN_NEED
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!API_KEY) {
  console.warn('[Gemini] GEMINI_API_KEY not configured - chatbot will return fallback responses');
}

const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

// Website content for system prompt
const WEBSITE_CONTENT = `CarShine Red Sea - Mobile Car Wash. Areas: El Gouna, Hurghada, Sahl Hasheesh.
Packages: Trial Wash (150 EGP), Smart Plan (300 EGP/month - 3 washes), Premium Plan (500 EGP/month - 5 washes).
Add-ons: Engine Wash (75 EGP), Wax (50 EGP), Seat Cleaning (60 EGP), Paint Protection (100 EGP).
Payment methods: Cash, InstaPay, Vodafone Cash, Orange Cash, Fawry, Bank Transfer.
InstaPay inside Egypt: customer can pay to mobile number 01555567205 and send the receipt screenshot before final confirmation.
Operating hours: 9:00 AM - 6:00 PM daily.
Slot capacity: Maximum 2 washes per hour.`;

// Response schema for structured output
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    REPLY: {
      type: 'string',
      description: 'The chat response back to the user in their language (colloquial Egyptian Arabic, English, or German).'
    },
    PENDING_BOOKING: {
      type: 'object',
      description: 'Extracted booking details. MUST be null if booking details are incomplete or slot is unavailable. All required fields must be present.',
      properties: {
        name: { type: 'string', description: 'Customer name' },
        whatsapp: { type: 'string', description: 'WhatsApp number' },
        area: { type: 'string', description: 'Must be El Gouna, Hurghada, or Sahl Hasheesh' },
        carType: { type: 'string', description: 'Type/model of the car' },
        package: { type: 'string', description: 'Trial Wash, Smart Plan, or Premium Plan' },
        date: { type: 'string', description: 'Booking date in YYYY-MM-DD format' },
        time: { type: 'string', description: 'Booking start time in HH:MM format (24-hour)' },
        location: { type: 'string', description: 'Google Maps URL or address details' },
        notes: { type: 'string', description: 'Add-ons selected or notes' }
      },
      required: ['name', 'whatsapp', 'area', 'carType', 'package', 'date', 'time', 'location']
    },
    HUMAN_NEED: {
      type: 'boolean',
      description: 'Set to true if user has a complaint, rescheduling/cancellation request, or unknown question that requires human support.'
    }
  },
  required: ['REPLY', 'HUMAN_NEED']
};

function checkSlotAvailable(date, time) {
  return db.isSlotAvailable(date, time);
}

async function getGeminiResponse(userMessage, chatHistory, existingBookingDetails) {
  if (!genAI) {
    return fallbackResponse(userMessage, existingBookingDetails);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 1024
      }
    });

    // Get current bookings for context
    const bookings = db.getAllBookings();
    const egyptTimeStr = new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const currentIso = new Date().toISOString();

    const systemInstruction = `You are the Chatbot Logic Agent for CarShine Red Sea, a premium mobile car wash service serving El Gouna, Hurghada, and Sahl Hasheesh.
Your task is to handle customer inquiries, provide information about pricing/services, and guide them through booking a mobile wash.

### Operating Rules & FAQ Context:
${WEBSITE_CONTENT}

Additional details:
- Packages & Add-ons:
  - Trial Wash: 150 EGP (1 wash, exterior, light interior refresh, glass, tires)
  - Smart Plan (Monthly Plan): 300 EGP / month (3 washes, scheduled, reminders)
  - Premium Plan (Monthly Plan): 500 EGP / month (5 washes, priority booking, deep attention, discount on add-ons)
  - Add-ons: Engine Wash (75 EGP), Wax (50 EGP), Seat Cleaning (60 EGP), Paint Protection (100 EGP)
- Areas served: El Gouna, Hurghada, and Sahl Hasheesh.
- Hours of operation: 9:00 AM to 6:00 PM (09:00 - 18:00) daily.
- Slot capacity: Maximum 2 washes per hour.

### Current Bookings (Do not book these slots!):
${JSON.stringify(bookings.map(b => ({ date: b.preferredDate, time: b.preferredTime, area: b.area })), null, 2)}

### Date/Time Reference:
Current local date/time in Egypt is: ${egyptTimeStr} (Timezone: Africa/Cairo, ISO: ${currentIso}).
Use this reference to resolve relative terms like "today", "tomorrow", "next Monday", etc.
All bookings must start between 09:00 and 17:00 (since washes take 30-60 mins and must finish by 18:00).

### Language Persona:
You must reply in the user's language:
- Egyptian Arabic (colloquial, warm, friendly): Use warm Egyptian greetings, local friendly tone, and colloquial terms (e.g. "يا فندم", "منورنا", "حبيبي", "تمام يا باشا", "حاضر من عينيا"). Do not use standard Fusha Arabic.
- English (professional and friendly): Warm, polite, and efficient.
- German (reliable, precise, detail-oriented): Professional, clear, polite, and detailed.

### Booking Process:
To complete a booking, you must collect the following details:
1. Full Name
2. WhatsApp Number (must be a valid phone number)
3. Area (must be 'El Gouna', 'Hurghada', or 'Sahl Hasheesh')
4. Car Type (e.g., Sedan, SUV, Coupe, etc.)
5. Package (Trial Wash, Smart Plan, or Premium Plan, and any optional add-ons)
6. Date (YYYY-MM-DD format)
7. Time (HH:MM format, 24-hour, must start between 09:00 and 17:00)
8. Google Maps Location or detailed Address

If any of the mandatory details (1-8) are missing, politely ask the user for them in the REPLY. Do NOT set PENDING_BOOKING.
If the requested slot (Date and Hour) already has 2 bookings in the calendar, or is outside operating hours (09:00 - 17:00 starting time), explain to the user in their language that this slot is unavailable, suggest alternative free hours, and set PENDING_BOOKING to null.

### Existing Booking Details (if partially collected):
${existingBookingDetails ? JSON.stringify(existingBookingDetails, null, 2) : 'None collected yet.'}

### Human Takeover (HUMAN_NEED):
Set HUMAN_NEED to true if the customer:
- Complains or displays anger/dissatisfaction.
- Asks to reschedule or cancel an existing booking.
- Asks questions that you cannot answer from the provided website content.
- Explicitly asks to speak to a human or manager.

### Output Format:
You must output a single JSON object matching the schema.`;

    // Build conversation history
    const history = chatHistory.slice(-10).map(msg => ({
      role: msg.sender === 'bot' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(userMessage);
    const response = result.response;
    const text = response.text();
    
    return JSON.parse(text);
  } catch (error) {
    console.error('[Gemini] API error:', error.message);
    return fallbackResponse(userMessage, existingBookingDetails);
  }
}

function fallbackResponse(message, existingDetails) {
  const lower = message.toLowerCase();
  const hasArabic = /[\u0600-\u06FF]/.test(message);
  const hasGerman = /(hallo|gut|tag|bitte|waschen|auto|deutsch|ich|mochte|möchte|ja|nein)/i.test(message);
  const lang = hasArabic ? 'ar' : hasGerman ? 'de' : 'en';
  
  const responses = {
    ar: {
      greeting: "أهلاً بك في كار شاين Red Sea! 🚗✨ بنقدملك خدمة غسيل السيارات المتنقلة في الجونة، الغردقة، وسهل حشيش. تحب تحجز غسيل تجريبي (150 جنيه) ولا تشترك في باقة شهرية؟",
      booking_start: "يا ريت تقولي اسمك بالكامل عشان نسجل الطلب؟",
      slot_unavailable: "عذراً، الميعاد ده محجوز. فيه مواعيد تانية متاحة؟",
      need_details: "محتاج منك معلومات أكتر عشان أكمل الحجز.",
      human: "هنوصللك بمسؤول يتواصل معاك.",
      error: "أنا آسف، في مشكلة تقنية. حاول تاني بعد شوية أو كلمنا على الواتساب."
    },
    en: {
      greeting: "Welcome to CarShine Red Sea! 🚗✨ We offer premium mobile car wash services in El Gouna, Hurghada, and Sahl Hasheesh. Would you like to book a Trial Wash (150 EGP) or subscribe to a monthly plan?",
      booking_start: "Could you please tell me your full name to start the booking?",
      slot_unavailable: "Sorry, that time slot is booked. Do you have another time in mind?",
      need_details: "I need a few more details to complete your booking.",
      human: "I'll connect you with a human agent.",
      error: "I'm sorry, I'm having a technical issue. Please try again shortly or contact us on WhatsApp."
    },
    de: {
      greeting: "Willkommen bei CarShine Red Sea! 🚗✨ Wir bieten erstklassige mobile Autowäsche in El Gouna, Hurghada und Sahl Hasheesh. Möchten Sie eine Probe-Wäsche (150 EGP) buchen oder ein Monats-Abo abschließen?",
      booking_start: "Könnten Sie mir bitte Ihren vollständigen Namen für die Buchung mitteilen?",
      slot_unavailable: "Entschuldigung, dieser Termin ist bereits vergeben. Haben Sie einen anderen Wunschzeitpunkt?",
      need_details: "Ich brauche noch ein paar Informationen, um Ihre Buchung abzuschließen.",
      human: "Ich verbinde Sie mit einem menschlichen Agenten.",
      error: "Entschuldigung, ich habe ein technisches Problem. Bitte versuchen Sie es später erneut oder kontaktieren Sie uns per WhatsApp."
    }
  };
  
  const r = responses[lang];
  
  // Simple keyword-based fallback
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('أهل') || lower.includes('مرحب') || lower.includes('hallo')) {
    return { REPLY: r.greeting, PENDING_BOOKING: null, HUMAN_NEED: false };
  }
  
  if (lower.includes('book') || lower.includes('حجز') || lower.includes('buchen')) {
    return { REPLY: r.booking_start, PENDING_BOOKING: null, HUMAN_NEED: false };
  }
  
  if (lower.includes('cancel') || lower.includes('إلغاء') || lower.includes('stornieren') || 
      lower.includes('complain') || lower.includes('شكوى') || lower.includes('بschwer')) {
    return { REPLY: r.human, PENDING_BOOKING: null, HUMAN_NEED: true };
  }
  
  return { REPLY: r.error, PENDING_BOOKING: null, HUMAN_NEED: false };
}

/**
 * Main handler for incoming WhatsApp messages
 * @param {string} phone - WhatsApp number
 * @param {string} message - User message text
 * @param {string} profileName - Customer name from WhatsApp (optional)
 * @returns {Promise<Object>} - { reply, bookingCreated, humanNeeded }
 */
async function handleIncomingMessage(phone, message, profileName) {
  // Get or create chat session
  let session = null;
  const existingChats = db.getChatsByStatus('active');
  session = existingChats.find(c => c.phone === phone && c.status === 'active');
  
  if (!session) {
    session = {
      id: 'session_' + Date.now(),
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
    db.createChat(session, { text: message, timestamp: new Date().toISOString() });
  } else {
    // Add user message to history
    db.addMessage(session.id, 'customer', message, new Date().toISOString());
    session = db.getChat(session.id);
  }
  
  // Get chat history for context
  const chatHistory = session.messages || [{ sender: 'customer', text: message, timestamp: new Date().toISOString() }];
  
  // Get existing booking details
  const existingBookingDetails = session.bookingDetails || {};
  
  // Call Gemini
  const result = await getGeminiResponse(message, chatHistory, existingBookingDetails);
  
  // Add bot reply to chat
  db.addMessage(session.id, 'bot', result.REPLY, new Date().toISOString());
  
  // Update session with any new booking details
  let updatedSession = session;
  if (result.PENDING_BOOKING) {
    // Slot availability check (Gemini should have checked but double-check)
    if (!checkSlotAvailable(result.PENDING_BOOKING.date, result.PENDING_BOOKING.time)) {
      result.REPLY = result.REPLY + '\n\n(Note: That slot appears to be unavailable now. Please choose another time.)';
      result.PENDING_BOOKING = null;
    } else {
      // Create the booking
      const bookingId = 'b_' + Date.now();
      const booking = {
        id: bookingId,
        customerName: result.PENDING_BOOKING.name,
        phone: result.PENDING_BOOKING.whatsapp,
        area: result.PENDING_BOOKING.area,
        carType: result.PENDING_BOOKING.carType,
        package: result.PENDING_BOOKING.package,
        preferredDate: result.PENDING_BOOKING.date,
        preferredTime: result.PENDING_BOOKING.time,
        location: result.PENDING_BOOKING.location,
        paymentMethod: result.PENDING_BOOKING.paymentMethod,
        status: 'pending',
        notes: result.PENDING_BOOKING.notes || 'Created via AI Chatbot.',
        createdAt: new Date().toISOString(),
        chatSessionId: session.id
      };
      
      db.createBooking(booking, session.id);
      
      // Update session to waiting_approval
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
  }
  
  // Update session with any extracted booking details
  if (result.REPLY && !result.PENDING_BOOKING) {
    // We could parse the reply for extracted details, but for now just update lastAskedField
    // The Gemini response includes the next question which implies what was asked
    db.updateChat(session.id, { 
      lastAskedField: session.lastAskedField,
      bookingDetails: existingBookingDetails
    });
  }
  
  return {
    reply: result.REPLY,
    bookingCreated: false,
    bookingId: null,
    humanNeeded: result.HUMAN_NEED
  };
}

module.exports = {
  handleIncomingMessage,
  checkSlotAvailable,
  getGeminiResponse,
  fallbackResponse
};
