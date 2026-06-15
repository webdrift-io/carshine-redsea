'use strict';

const BUSINESS_KNOWLEDGE = require('./data/website-knowledge.json');

function answerFromWebsiteKnowledge(text = '', language = 'en') {
  const lower = String(text || '').toLowerCase();
  const isArabic = language === 'ar';
  const isGerman = language === 'de';

  const packageText = BUSINESS_KNOWLEDGE.packages
    .map((p) => `${p.name}: ${p.price}`)
    .join(', ');
  const areasText = BUSINESS_KNOWLEDGE.areas.join(', ');
  const paymentsText = BUSINESS_KNOWLEDGE.payments.join(', ');

  if (/price|prices|cost|package|packages|plan|plans|how much|بكام|سعر|أسعار|باقة|باقات|preis|kosten|paket/i.test(lower)) {
    if (isArabic) return `الأسعار الحالية: تجربة 150 جنيه، Smart Plan 300 جنيه/شهر، Premium Plan 500 جنيه/شهر. نقدر نحجز لك حسب المنطقة والوقت المناسب.`;
    if (isGerman) return `Aktuelle Pakete: ${packageText}. Ich kann danach direkt eine Buchung aufnehmen.`;
    return `Current packages: ${packageText}. I can also help you book a slot now.`;
  }

  if (/area|areas|where|location|locations|gouna|hurghada|sahl|منطقة|فين|الغردقة|الجونة|حشيش|gebiet|wo/i.test(lower)) {
    if (isArabic) return `نخدم حالياً: الجونة، الغردقة، وسهل حشيش. ابعت المنطقة والعنوان أو Google Maps عند الحجز.`;
    if (isGerman) return `Wir bedienen aktuell: ${areasText}. Für die Buchung brauche ich danach Adresse oder Google Maps.`;
    return `We currently serve: ${areasText}. For booking, send your address or Google Maps location.`;
  }

  if (/hour|hours|open|time|when|working|موعد|مواعيد|الساعة|دوام|وقت|wann|uhr|geöffnet/i.test(lower)) {
    if (isArabic) return `المواعيد بالحجز المؤكد. النظام يقبل مواعيد من 9 صباحاً إلى 5 مساءً، والفريق يؤكد التفاصيل على واتساب.`;
    if (isGerman) return `${BUSINESS_KNOWLEDGE.hours} Das Team bestätigt den Termin per WhatsApp.`;
    return `${BUSINESS_KNOWLEDGE.hours} The team confirms the final appointment on WhatsApp.`;
  }

  if (/payment|pay|instapay|cash|vodafone|fawry|دفع|انستاباي|كاش|فوري|bezahlen/i.test(lower)) {
    if (isArabic) return `طرق الدفع: ${paymentsText}. InstaPay على رقم ${BUSINESS_KNOWLEDGE.instapayNumber}، وبعد الدفع ابعت إيصال الدفع على واتساب.`;
    if (isGerman) return `Zahlung: ${paymentsText}. InstaPay Nummer: ${BUSINESS_KNOWLEDGE.instapayNumber}. Bitte danach den Beleg per WhatsApp senden.`;
    return `Payment options: ${paymentsText}. InstaPay number: ${BUSINESS_KNOWLEDGE.instapayNumber}. After payment, send the receipt on WhatsApp.`;
  }

  if (/service|include|wash|clean|inside|outside|interior|exterior|خدمة|غسيل|تنضيف|داخلي|خارجي|wäsche|reinigen/i.test(lower)) {
    if (isArabic) return `الخدمة موبايل عند مكان العربية. نغطي الغسيل الخارجي، الزجاج، الجنوط، وملاحظات التنظيف الداخلي أو الإضافات حسب الطلب.`;
    if (isGerman) return `Mobiler Service am Standort des Autos: Außenwäsche, Glas, Räder und Zusatzwünsche nach Absprache.`;
    return `We come to the car location. Services include mobile exterior wash, glass, wheels, and interior/add-on notes by request.`;
  }

  if (/phone|whatsapp|contact|call|رقم|واتساب|تواصل|telefon|kontakt/i.test(lower)) {
    if (isArabic) return `رقم واتساب كار شاين: ${BUSINESS_KNOWLEDGE.phoneDisplay}.`;
    if (isGerman) return `WhatsApp Kontakt: ${BUSINESS_KNOWLEDGE.phoneDisplay}.`;
    return `WhatsApp contact: ${BUSINESS_KNOWLEDGE.phoneDisplay}.`;
  }

  return null;
}

module.exports = {
  BUSINESS_KNOWLEDGE,
  answerFromWebsiteKnowledge
};
