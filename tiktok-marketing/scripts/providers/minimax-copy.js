'use strict';

/**
 * Marketing copy generator — uses the MiniMax (M3) key for hooks, captions,
 * and hashtags. Falls back to a deterministic template engine if no key is
 * present or the call fails.
 *
 * Exposed function:
 *   generateCopy({ topic, language, platform, count, config })
 *     → { hooks: [...], captions: [...], hashtags: [...], usedLLM: bool }
 *
 * The MiniMax API is OpenAI-compatible at
 *   https://api.MiniMax.io/v1/text/chatcompletion_v2
 * (See service-agent/minimax-agent.js for the proven protocol.)
 *
 * Environment:
 *   MiniMax_API_KEY   required for LLM path; falls back if missing
 *   MiniMax_MODEL     default "MiniMax-M3"
 *   MiniMax_URL       default "https://api.MiniMax.io/v1/text/chatcompletion_v2"
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = process.env.MiniMax_MODEL || 'MiniMax-M3';
const DEFAULT_URL = process.env.MiniMax_URL || 'https://api.MiniMax.io/v1/text/chatcompletion_v2';
const KEY_PATHS = [
  process.env.MiniMax_API_KEY,
  loadKeyFromServiceAgentDotenv(),
  loadKeyFromTiktokDotenv()
].filter(Boolean);

function loadKeyFromServiceAgentDotenv() {
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '..', 'service-agent', '.env'), 'utf8');
    const m = env.match(/^MiniMax_API_KEY\s*=\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch (_e) { return null; }
}

function loadKeyFromTiktokDotenv() {
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
    const m = env.match(/^MiniMax_API_KEY\s*=\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch (_e) { return null; }
}

function getApiKey() {
  for (const k of KEY_PATHS) {
    if (k && !k.includes('your_') && !k.includes('...') && k.length > 20) return k;
  }
  return null;
}

const LANG_NAMES = { en: 'English', ar: 'Egyptian Arabic (colloquial, use يا باشا / منورنا / تمام)', de: 'German' };

const TEMPLATE_HOOKS = {
  en: [
    'WE COME TO YOU. 🚗',
    'Your car. Our care. At your door.',
    'Desert dust? Salt air? Sun damage? Not on our watch.',
    'Premium waterless. Premium results. Zero waste.',
    'Booked in 60 seconds. Gleaming in 60 minutes.',
    'From dusty to gleaming — same day.',
    'Hotels trust us. Compounds trust us. Now you can too.',
    'No water waste. No drive. No hassle.',
    'El Gouna → Hurghada → Sahl Hasheesh. We come to you.',
    'Your villa. Your time. A gleaming car.'
  ],
  ar: [
    'إحنا بنجلك. 🚗',
    'عربيتك. عنايتنا. لحد عندك.',
    'تراب الصحرا؟ ملح البحر؟ شمس حارقة؟ مش عندنا.',
    'ب waterless. نتيجة بريميوم. صفر هدر.',
    'احجز في ٦٠ ثانية. عربية لماعة في ٦٠ دقيقة.',
    'من تراب لـ لمعة — في نفس اليوم.',
    'الفنادق بتثق فينا. الكمبوندات بتثق فينا. دلوقتي إنت بعد.',
    'بلا هدر مية. بلا سواقة. بلا وجع دماغ.',
    'الجونة → الغردقة → سهل حشيش. إحنا بنجلك.',
    'فيلتك. وقتك. عربية لماعة.'
  ],
  de: [
    'WIR KOMMEN ZU IHNEN. 🚗',
    'Ihr Auto. Unsere Pflege. Vor Ihrer Tür.',
    'Wüstenstaub? Salzluft? Sonnenschäden? Nicht bei uns.',
    'Premium wasserlos. Premium-Ergebnis. Null Verschwendung.',
    'In 60 Sekunden gebucht. In 60 Minuten glänzend.',
    'Von staubig zu glänzend – noch am selben Tag.',
    'Hotels vertrauen uns. Wohnanlagen vertrauen uns. Jetzt Sie auch.',
    'Kein Wasserverbrauch. Keine Anfahrt. Kein Stress.',
    'El Gouna → Hurghada → Sahl Hasheesh. Wir kommen zu Ihnen.',
    'Ihre Villa. Ihre Zeit. Ein glänzendes Auto.'
  ]
};

const TEMPLATE_CAPTIONS = {
  en: (topic) => `🚗 ${topic} — CarShine Red Sea comes to your home, hotel, villa or compound across El Gouna, Hurghada & Sahl Hasheesh. Premium waterless detailing. No water waste. From 150 EGP. Book on WhatsApp → +20 155 556 7205`,
  ar: (topic) => `🚗 ${topic} — كارشاين ريد سي بنجيلك في البيت، الفندق، الفيلا أو الكمبوند في الجونة، الغردقة، سهل حشيش. بريميوم waterless. صفر هدر مية. من ١٥٠ جنيه. احجز واتساب ← ٠١٠٠٥٥٥٦٧٢٠٥`,
  de: (topic) => `🚗 ${topic} — CarShine Red Sea kommt zu Ihnen nach Hause, ins Hotel, in die Villa oder Wohnanlage in El Gouna, Hurghada & Sahl Hasheesh. Premium wasserlose Aufbereitung. Kein Wasserverbrauch. Ab 150 EGP. Buchen Sie auf WhatsApp → +20 155 556 7205`
};

const TEMPLATE_HASHTAGS = {
  en: ['#CarShineRedSea', '#MobileCarWash', '#ElGouna', '#Hurghada', '#SahlHasheesh', '#WaterlessWash', '#CarDetailing', '#Egypt', '#RedSea', '#PremiumCarCare'],
  ar: ['#كارشاين_ريد_سي', '#غسيل_عربيه', '#الجونة', '#الغردقة', '#سهل_حشيش', '#تفصيل_عربيه', '#مصر', '#البحر_الأحمر', '#بريميوم', '#صفر_هدر'],
  de: ['#CarShineRedSea', '#MobileAutowäsche', '#ElGouna', '#Hurghada', '#SahlHasheesh', '#Wasserlos', '#Autoaufbereitung', '#Ägypten', '#RotesMeer', '#Premium']
};

function templateFallback({ topic, language, count }) {
  const lang = LANG_NAMES[language] ? language : 'en';
  const hooks = TEMPLATE_HOOKS[lang].slice(0, count || 3);
  const captions = hooks.map((h, i) => TEMPLATE_CAPTIONS[lang](`${h} (${i + 1}/${hooks.length})`));
  const hashtags = TEMPLATE_HASHTAGS[lang];
  return { hooks, captions, hashtags, usedLLM: false };
}

async function callMiniMax(messages, apiKey) {
  const res = await fetch(DEFAULT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.8,
      max_tokens: 800
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MiniMax ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // MiniMax (OpenAI-compatible) returns { choices: [{ message: { content } }] }
  const content = data?.choices?.[0]?.message?.content
    || data?.base_resp && data.choices?.[0]?.message?.content
    || null;
  if (!content) throw new Error('MiniMax returned no content');
  return String(content);
}

function extractJson(text) {
  // Strip code fences, then find the first { ... } block
  const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_e) { return null; }
}

async function generateCopy({ topic, language = 'en', platform = 'instagram', count = 3, config = {} } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ...templateFallback({ topic, language, count }), usedLLM: false, reason: 'no-api-key' };
  }

  const langName = LANG_NAMES[language] || 'English';
  const systemMsg = `You are Layla, a senior social media copywriter for CarShine Red Sea — a premium mobile waterless car detailing service in El Gouna, Hurghada and Sahl Hasheesh, Egypt. Voice: premium, warm, action-oriented, never salesy. Output ONLY valid JSON.`;
  const userMsg = `Generate ${count} social media posts for ${platform} in ${langName}.
Topic: ${topic || 'premium mobile car wash'}

Return JSON with this exact shape:
{
  "hooks": ["<short punchy hook 1>", "<short punchy hook 2>", "<short punchy hook 3>"],
  "captions": ["<full caption 1 with CTA + WhatsApp +20 155 556 7205>", "<full caption 2>", "<full caption 3>"],
  "hashtags": ["#tag1", "#tag2", "...up to 10"]
}`;

  try {
    const content = await callMiniMax([
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg }
    ], apiKey);
    const parsed = extractJson(content);
    if (!parsed || !Array.isArray(parsed.hooks) || !Array.isArray(parsed.captions) || !Array.isArray(parsed.hashtags)) {
      throw new Error('LLM did not return the expected JSON shape');
    }
    return {
      hooks: parsed.hooks.slice(0, count),
      captions: parsed.captions.slice(0, count),
      hashtags: parsed.hashtags.slice(0, 10),
      usedLLM: true
    };
  } catch (err) {
    return { ...templateFallback({ topic, language, count }), usedLLM: false, reason: `llm-error: ${err.message}` };
  }
}

module.exports = {
  generateCopy,
  getApiKey,
  templateFallback,
  // for tests
  _internal: { callMiniMax, extractJson, DEFAULT_MODEL, DEFAULT_URL }
};
