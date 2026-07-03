/**
 * Parser utilities for chat messages
 * Extracted from server.js for testability
 */

/**
 * Detect language of a message
 * @param {string} text - Message text
 * @returns {'ar'|'de'|'en'} - Detected language
 */
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'en';
  
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/\b(hallo|gut|tag|bitte|waschen|auto|deutsch|ich|mein|mochte|möchte|ja|nein|danke|uhr)\b/i.test(text)) return 'de';
  return 'en';
}

/**
 * Parse area from message
 * @param {string} text - Message text
 * @returns {string|null} - El Gouna, Hurghada, Sahl Hasheesh, or null
 */
function parseArea(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('gouna') || lower.includes('جونة')) return 'El Gouna';
  if (lower.includes('hurghada') || lower.includes('غردقة')) return 'Hurghada';
  if (lower.includes('sahl') || lower.includes('hasheesh') || lower.includes('حشيش')) return 'Sahl Hasheesh';
  return null;
}

/**
 * Parse package from message
 * @param {string} text - Message text
 * @returns {string|null} - Essential/Smart/Premium package or null
 */
function parsePackage(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('essential') || lower.includes('trial') || lower.includes('تجريب') || lower.includes('probe') || /\b(150|250)\b/.test(text)) {
    return 'Essential Wash - 250 EGP';
  }
  if (lower.includes('smart') || lower.includes('ذكية') || /\b300\b/.test(text)) {
    return 'Smart Wash - 300 EGP';
  }
  if (lower.includes('premium') || lower.includes('مميزة') || /\b(350|500)\b/.test(text)) {
    return 'Premium Detail - 350 EGP';
  }
  return null;
}

/**
 * Parse payment method from message
 * @param {string} text - Message text
 * @returns {string|null} - Payment method or null
 */
function parsePaymentMethod(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  // Check specific providers FIRST (before generic "cash")
  if (lower.includes('instapay') || lower.includes('انستا') || lower.includes('إنستا')) {
    return 'InstaPay';
  }
  if (lower.includes('vodafone') || lower.includes('فودافون')) {
    return 'Vodafone Cash';
  }
  if (lower.includes('orange')) {
    return 'Orange Cash';
  }
  if (lower.includes('fawry') || lower.includes('فوري')) {
    return 'Fawry';
  }
  // Generic cash (must be last to avoid matching "Vodafone Cash")
  if (lower.includes('cash') || lower.includes('كاش') || lower.includes('نقدي') || lower.includes('bar')) {
    return 'Cash';
  }
  return null;
}

/**
 * Parse car type/brand from message
 * @param {string} text - Message text
 * @returns {string|null} - Car brand/type or null
 */
function parseCarType(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  const carBrands = [
    'sedan', 'suv', 'bmw', 'mercedes', 'audi', 'toyota', 'hyundai',
    'honda', 'kia', 'jeep', 'mitsubishi', 'fiat', 'volvo',
    'nissan', 'chevrolet', 'chery', 'mg', 'lexus', 'porsche', 'tesla'
  ];
  
  for (const brand of carBrands) {
    if (lower.includes(brand)) {
      return brand.toUpperCase();
    }
  }
  
  // Arabic pattern: عربية + description
  const arCarMatch = text.match(/(?:عربية|سيارة)\s+([A-Za-z\u0600-\u06FF0-9\s]+)/);
  if (arCarMatch && arCarMatch[1]) {
    return arCarMatch[1].trim();
  }
  
  return null;
}

/**
 * Parse date from message
 * @param {string} text - Message text
 * @returns {string|null} - YYYY-MM-DD format or null
 */
function parseDate(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  // Relative terms
  if (lower.includes('today') || lower.includes('النهاردة') || lower.includes('heute')) {
    return new Date().toISOString().split('T')[0];
  }
  if (lower.includes('tomorrow') || lower.includes('بكرة') || lower.includes('morgen')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  
  // Numeric date (day/month)
  const dateMatch = text.match(/(\d{1,2})[./-](\d{1,2})/);
  if (dateMatch) {
    const year = new Date().getFullYear();
    let day = parseInt(dateMatch[1], 10);
    let month = parseInt(dateMatch[2], 10);
    if (month > 12) {
      const temp = day;
      day = month;
      month = temp;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  
  return null;
}

/**
 * Parse time from message
 * @param {string} text - Message text
 * @returns {string|null} - HH:MM format or null
 */
function parseTime(text) {
  if (!text) return null;
  
  const timeMatch = text.match(/(?:^|[\s,;])(\d{1,2})(?::(\d{2}))?\s*(am|pm|صباحا|مساء|uhr)?(?=$|[\s,;.])/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    
    if (ampm) {
      const lower = ampm.toLowerCase();
      if ((lower.includes('pm') || lower.includes('مساء')) && hour < 12) hour += 12;
      if ((lower.includes('am') || lower.includes('صباحا')) && hour === 12) hour = 0;
    }
    
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  
  return null;
}

/**
 * Parse customer name from message
 * @param {string} text - Message text
 * @returns {string|null} - Customer name or null
 */
function parseName(text) {
  if (!text) return null;
  
  const patterns = [
    /(?:my name is|i'm|im|name is)\s+([A-Za-z\u0600-\u06FF\s]+)/i,
    /(?:esmi|اسمي)\s+([A-Za-z\u0600-\u06FF\s]+)/i,
    /(?:ich heisse|ich heiße|mein name ist)\s+([A-Za-z\u0600-\u06FF\s]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return null;
}

/**
 * Parse a phone number from a message
 * @param {string} text - Message text
 * @returns {string|null} - Phone number or null
 */
function parsePhone(text) {
  if (!text) return null;
  const explicit = text.match(/(?:phone|mobile|whatsapp|number|رقم|موبايل|تليفون|telefon|handy)\s*(?:is|:)?\s*(\+?\d[\d\s-]{6,18}\d)/i);
  const loose = text.match(/(?:^|\s)(\+?20\s?1\d{9}|01\d{9})(?:\s|$)/);
  const value = explicit?.[1] || loose?.[1];
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, '');
  return isValidPhone(normalized) ? normalized : null;
}

/**
 * Parse all booking details from a message
 * @param {string} text - Message text
 * @returns {Object} - Extracted details (only filled fields)
 */
function parseBookingDetails(text) {
  if (!text) return {};
  
  const details = {};
  const name = parseName(text);
  if (name) details.customerName = name;
  const phone = parsePhone(text);
  if (phone) details.phone = phone;
  
  const area = parseArea(text);
  if (area) details.area = area;
  
  const carType = parseCarType(text);
  if (carType) details.carType = carType;
  
  const pkg = parsePackage(text);
  if (pkg) details.package = pkg;
  
  const payment = parsePaymentMethod(text);
  if (payment) details.paymentMethod = payment;
  
  const date = parseDate(text);
  if (date) details.preferredDate = date;
  
  const time = parseTime(text);
  if (time) details.preferredTime = time;
  
  return details;
}

/**
 * Validate a complete booking object
 * @param {Object} booking - Booking to validate
 * @returns {Object} - { valid: boolean, missing: string[] }
 */
function validateBooking(booking) {
  if (!booking || typeof booking !== 'object') {
    return { valid: false, missing: ['entire booking object'] };
  }
  
  const required = [
    'customerName', 'phone', 'area', 'carType', 'package',
    'preferredDate', 'preferredTime', 'location', 'paymentMethod'
  ];
  
  const missing = required.filter(field => !booking[field] || String(booking[field]).trim() === '');
  return { valid: missing.length === 0, missing };
}

/**
 * Check if a phone number looks valid
 * @param {string} phone - Phone number
 * @returns {boolean} - True if valid format
 */
function isValidPhone(phone) {
  if (!phone) return false;
  // Accept international, local formats, with or without +
  // Must have at least 7 digits
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

module.exports = {
  detectLanguage,
  parseArea,
  parsePackage,
  parsePaymentMethod,
  parseCarType,
  parseDate,
  parseTime,
  parseName,
  parsePhone,
  parseBookingDetails,
  validateBooking,
  isValidPhone
};
