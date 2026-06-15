#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

// Helper to load website content
function readWebsiteContent() {
  const possiblePaths = [
    path.join(__dirname, 'website-content-english.txt'),
    path.join(__dirname, '../website-content-english.txt'),
    path.join(process.cwd(), 'website-content-english.txt')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  // Return a fallback representation if file is not found
  return `CarShine Red Sea - Mobile Car Wash. Areas: El Gouna, Hurghada, Sahl Hasheesh.
Packages: Trial Wash (150 EGP), Smart Plan (300 EGP/month), Premium Plan (500 EGP/month).
Add-ons: Engine Wash (75 EGP), Wax (50 EGP), Seat Cleaning (60 EGP), Paint Protection (100 EGP).
Payment methods: Cash, InstaPay, Vodafone Cash, Orange Cash, Fawry, Bank Transfer.
InstaPay inside Egypt: customer can pay to mobile number 01555567205 and send the receipt screenshot before final confirmation.
Operating hours: 9:00 AM - 6:00 PM.`;
}

// Helper to load calendar bookings
function readCalendar(calendarPath) {
  const p = calendarPath || path.join(__dirname, 'calendar.json');
  if (fs.existsSync(p)) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return data.bookings || [];
    } catch (e) {
      console.error("Error reading calendar:", e);
      return [];
    }
  }
  return [];
}

// Helper to check slot availability (max 2 washes per hour, 9 AM - 6 PM)
// Returns true if slot is available, false otherwise
function checkSlotAvailable(bookings, date, time) {
  if (!date || !time) return false;

  // Parse booking hour
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})/);
  if (!timeMatch) return false;

  const hour = parseInt(timeMatch[1], 10);
  
  // Operating hours are 9:00 AM to 6:00 PM (09:00 - 18:00).
  // The last possible starting hour is 17:00 (5:00 PM) to complete by 6:00 PM.
  if (hour < 9 || hour > 17) {
    return false;
  }

  // Count how many bookings are in the same hour block on the same date
  const count = bookings.filter(b => {
    if (b.date !== date) return false;
    const bTimeMatch = b.time.match(/^(\d{1,2}):(\d{2})/);
    if (!bTimeMatch) return false;
    const bHour = parseInt(bTimeMatch[1], 10);
    return bHour === hour;
  }).length;

  return count < 2;
}

// Helper to clean JSON response from markdown wrappers
function cleanJsonResponse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return JSON.parse(cleaned.trim());
}

// Low-level HTTP helper to call Gemini API
function callGeminiAPI(apiKey, model, requestBody) {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const data = JSON.stringify(requestBody);
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse response JSON: ${e.message}. Body: ${body}`));
          }
        } else {
          reject(new Error(`API returned status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

/**
 * Main function to handle user message, query Gemini, validate slots, and return action
 * 
 * @param {string} userMessage - The latest message from the user
 * @param {Array} chatHistory - Array of past messages: [{role: 'user'|'model', text: '...'}]
 * @param {string} calendarPath - Optional custom path to calendar.json
 * @returns {Promise<Object>} Action object: { REPLY, PENDING_BOOKING, HUMAN_NEED }
 */
async function handleMessage(userMessage, chatHistory = [], calendarPath = null) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or API_KEY environment variable.");
  }

  const websiteContent = readWebsiteContent();
  const bookings = readCalendar(calendarPath);

  // Timezone reference
  const egyptTimeStr = new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
  const currentIso = new Date().toISOString();

  // Define response schema for Gemini Structured Outputs
  const responseSchema = {
    type: "OBJECT",
    properties: {
      REPLY: {
        type: "STRING",
        description: "The chat response back to the user in their language (colloquial Egyptian Arabic, English, or German)."
      },
      PENDING_BOOKING: {
        type: "OBJECT",
        description: "Extracted booking details. MUST be null if the booking details are incomplete or the slot is unavailable. All required fields must be present.",
        properties: {
          name: { type: "STRING", description: "Customer name" },
          whatsapp: { type: "STRING", description: "WhatsApp number" },
          area: { type: "STRING", description: "Must be 'El Gouna', 'Hurghada', or 'Sahl Hasheesh'" },
          carType: { type: "STRING", description: "Type/model of the car" },
          package: { type: "STRING", description: "Trial Wash, Smart Plan, or Premium Plan" },
          date: { type: "STRING", description: "Booking date in YYYY-MM-DD format" },
          time: { type: "STRING", description: "Booking start time in HH:MM format (24-hour)" },
          location: { type: "STRING", description: "Google Maps URL or address details" },
          notes: { type: "STRING", description: "Add-ons selected (Engine Wash, Wax, Seat Cleaning, Paint Protection) or notes" }
        },
        required: ["name", "whatsapp", "area", "carType", "package", "date", "time", "location"]
      },
      HUMAN_NEED: {
        type: "BOOLEAN",
        description: "Set to true if user has a complaint, rescheduling/cancellation request, or unknown question that requires human support."
      }
    },
    required: ["REPLY", "HUMAN_NEED"]
  };

  const systemInstruction = `
You are the Chatbot Logic Agent for CarShine Red Sea, a premium mobile car wash service serving El Gouna, Hurghada, and Sahl Hasheesh.
Your task is to handle customer inquiries, provide information about pricing/services, and guide them through booking a mobile wash.

### Operating Rules & FAQ Context:
Use the following information to answer customer questions:
${websiteContent}

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
${JSON.stringify(bookings, null, 2)}

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

### Human Takeover (HUMAN_NEED):
Set HUMAN_NEED to true if the customer:
- Complains or displays anger/dissatisfaction.
- Asks to reschedule or cancel an existing booking.
- Asks questions that you cannot answer from the provided website content.
- Explicitly asks to speak to a human or manager.

### Output Format:
You must output a single JSON object matching this schema:
{
  "REPLY": "Your message to the user",
  "PENDING_BOOKING": {
    "name": "Full Name",
    "whatsapp": "WhatsApp number",
    "area": "El Gouna / Hurghada / Sahl Hasheesh",
    "carType": "Car Type",
    "package": "Package name",
    "date": "YYYY-MM-DD",
    "time": "HH:MM",
    "location": "Address or link",
    "notes": "Add-ons or special instructions"
  } or null,
  "HUMAN_NEED": false or true
}
`;

  // Normalize history to Gemini API format
  const contents = [];
  for (const msg of chatHistory) {
    const role = msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user';
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (typeof msg.text === 'string') {
      text = msg.text;
    } else if (Array.isArray(msg.parts) && msg.parts[0] && typeof msg.parts[0].text === 'string') {
      text = msg.parts[0].text;
    } else if (typeof msg === 'string') {
      text = msg;
    }
    
    if (text) {
      contents.push({
        role: role,
        parts: [{ text: text }]
      });
    }
  }

  // Add the current user message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  const model = "gemini-2.5-flash";
  let attempts = 0;
  let parsedResult = null;
  let currentContents = [...contents];

  // Self-correcting loop to check slot availability and validate output format
  while (attempts < 2) {
    try {
      const response = await callGeminiAPI(apiKey, model, {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: currentContents,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      });

      const text = response.candidates[0].content.parts[0].text;
      parsedResult = cleanJsonResponse(text);

      // Perform programmatic double-check of slot availability if booking details are complete
      if (parsedResult.PENDING_BOOKING) {
        const pb = parsedResult.PENDING_BOOKING;
        const isAvailable = checkSlotAvailable(bookings, pb.date, pb.time);

        if (!isAvailable) {
          // If the slot is actually not available, we force the AI to self-correct
          currentContents.push({
            role: 'model',
            parts: [{ text: JSON.stringify(parsedResult) }]
          });
          currentContents.push({
            role: 'user',
            parts: [{ text: `[SYSTEM ERROR: The slot on ${pb.date} at ${pb.time} is NOT available (either fully booked with 2 washes in that hour or outside operating hours 09:00 - 18:00). Apologize in the user's language, ask for another time/day, and set PENDING_BOOKING to null.]` }]
          });
          attempts++;
          continue;
        }
      }
      break;
    } catch (error) {
      console.error(`Gemini API Call failed (attempt ${attempts + 1}):`, error);
      attempts++;
      if (attempts >= 2) {
        // Fallback response if API calls fail
        return {
          REPLY: "I'm sorry, I'm having a technical issue connecting to our systems. Please try again shortly or contact us directly on WhatsApp at +20 155 556 7205.",
          PENDING_BOOKING: null,
          HUMAN_NEED: true
        };
      }
    }
  }

  return parsedResult;
}

// Export the function for other modules
module.exports = {
  handleMessage,
  checkSlotAvailable,
  readCalendar,
  readWebsiteContent
};

// CLI Runner Support
if (require.main === module) {
  const args = process.argv.slice(2);
  const userMsg = args[0];

  if (!userMsg) {
    console.log("Usage: node chatbot.js <message> [--reset]");
    process.exit(1);
  }

  const historyFilePath = path.join(__dirname, 'cli_history.json');

  if (args.includes('--reset')) {
    if (fs.existsSync(historyFilePath)) {
      fs.unlinkSync(historyFilePath);
    }
    console.error("Chat history reset.");
    if (args.length === 1 || (args.length === 2 && userMsg === '--reset')) {
      process.exit(0);
    }
  }

  // Load history from CLI state file
  let history = [];
  if (fs.existsSync(historyFilePath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyFilePath, 'utf-8'));
    } catch (e) {
      console.error("Error reading history file, starting fresh:", e);
    }
  }

  handleMessage(userMsg, history)
    .then(result => {
      // Print action output JSON to stdout
      console.log(JSON.stringify(result, null, 2));

      // Append to history
      history.push({ role: 'user', text: userMsg });
      // We store the full parsed result as the model's text in history
      history.push({ role: 'model', text: result.REPLY });
      
      // Save history back to file
      fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));
    })
    .catch(err => {
      console.error("Chatbot logic failed:", err);
      process.exit(1);
    });
}
