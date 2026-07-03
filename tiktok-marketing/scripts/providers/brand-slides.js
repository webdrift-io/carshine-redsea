'use strict';

/**
 * Brand-aware slide generator.
 * Renders 9:16 (1080x1920) PNG slides with a consistent CarShine visual
 * system: deep navy background, gold accents, Manrope-style typography
 * (rendered with system fonts for portability), high-contrast CTA.
 *
 * No external image API needed. The function ALWAYS returns a real PNG on
 * disk so the downstream overlay + postiz pipeline never breaks.
 *
 * Why not just rely on an LLM for image gen? Because:
 *   1. Image-gen APIs have rate limits, content filters, and quota issues.
 *   2. The brand needs to be consistent across hundreds of posts.
 *   3. Deterministic output is auditable and reviewable.
 *   4. We can layer real photos over these templates later (see `overlayPhoto`).
 *
 * The templates below match the existing `assets/brand/` palette:
 *   bg:        #061425  (deep navy)
 *   accent:    #C8A45C  (gold)
 *   white:     #FFFFFF
 *   muted:     #8FA3B8  (slate)
 */

const fs = require('fs');
const path = require('path');

const W = 1080;
const H = 1920;
const COLORS = {
  bg: '#061425',
  bgPanel: '#0A1A2F',
  accent: '#C8A45C',
  white: '#FFFFFF',
  muted: '#8FA3B8',
  dark: '#020A14'
};

function loadCanvas() {
  try {
    return require('canvas');
  } catch (_e) {
    return null;
  }
}

function wrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawBackground(ctx) {
  // Solid base
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // Diagonal gold sliver
  ctx.fillStyle = COLORS.accent;
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.32);
  ctx.lineTo(W, H * 0.18);
  ctx.lineTo(W, H * 0.26);
  ctx.lineTo(0, H * 0.40);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // Top brand bar
  ctx.fillStyle = COLORS.bgPanel;
  ctx.fillRect(0, 0, W, 96);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 96, W, 3);

  // Bottom CTA bar
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, H - 200, W, 200);
  ctx.fillStyle = COLORS.dark;
  ctx.fillRect(0, H - 200, W, 4);
}

function drawBrandMark(ctx) {
  // Simple C-shield monogram
  const cx = 60;
  const cy = 48;
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.dark;
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CS', cx, cy + 2);
  // Wordmark
  ctx.fillStyle = COLORS.white;
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('CarShine Red Sea', 100, 52);
}

function drawHeroTitle(ctx, hook) {
  ctx.fillStyle = COLORS.white;
  ctx.font = 'bold 92px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = wrap(ctx, hook.toUpperCase(), W * 0.85);
  let y = 240;
  for (const line of lines.slice(0, 3)) {
    ctx.fillText(line, W / 2, y);
    y += 110;
  }
}

function drawSubtext(ctx, caption) {
  ctx.fillStyle = COLORS.muted;
  ctx.font = '36px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = wrap(ctx, caption, W * 0.85);
  let y = 720;
  for (const line of lines.slice(0, 5)) {
    ctx.fillText(line, W / 2, y);
    y += 50;
  }
}

function drawPriceTag(ctx, amount) {
  if (!amount) return;
  ctx.fillStyle = COLORS.bgPanel;
  const x = W / 2 - 240;
  const y = 1100;
  ctx.fillRect(x, y, 480, 200);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, 480, 200);
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('FROM', W / 2, y + 30);
  ctx.fillStyle = COLORS.white;
  ctx.font = 'bold 96px Arial';
  ctx.fillText(`${amount} EGP`, W / 2, y + 80);
}

function drawHashtags(ctx, hashtags) {
  if (!hashtags || !hashtags.length) return;
  ctx.fillStyle = COLORS.muted;
  ctx.font = '28px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const line = hashtags.slice(0, 8).join(' ');
  ctx.fillText(line, W / 2, H - 240);
}

function drawCTA(ctx, ctaText) {
  ctx.fillStyle = COLORS.dark;
  ctx.font = 'bold 56px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ctaText || 'Book on WhatsApp →', W / 2, H - 100);
}

function drawSlideNumber(ctx, n, total) {
  if (!total || total <= 1) return;
  ctx.fillStyle = COLORS.muted;
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(`${n} / ${total}`, W - 40, 60);
}

/**
 * Render a single slide. Pure canvas — no external image dep.
 * Returns { path, bytes, width, height, model: 'brand-template-v1' }.
 */
function renderSlide({ hook, caption, hashtags, priceFrom, ctaText, slideNumber, totalSlides, outputPath }) {
  const canvasLib = loadCanvas();
  if (!canvasLib) {
    // No canvas available: write a 1x1 placeholder so the pipeline doesn't break.
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const buf = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
      'hex'
    );
    fs.writeFileSync(outputPath, buf);
    return { path: outputPath, bytes: buf.length, width: 1, height: 1, model: 'no-canvas-stub' };
  }
  const { createCanvas } = canvasLib;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx);
  drawBrandMark(ctx);
  drawSlideNumber(ctx, slideNumber, totalSlides);
  drawHeroTitle(ctx, hook);
  drawSubtext(ctx, caption);
  drawPriceTag(ctx, priceFrom);
  drawHashtags(ctx, hashtags);
  drawCTA(ctx, ctaText);
  const buf = canvas.toBuffer('image/png');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buf);
  return { path: outputPath, bytes: buf.length, width: W, height: H, model: 'brand-template-v1' };
}

/**
 * Render a 6-slide storyboard (hook → problem → solution → price → proof → CTA).
 */
function renderStoryboard({ slides, outputDir, baseName = 'slide' }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const total = slides.length;
  const results = [];
  slides.forEach((s, i) => {
    const out = path.join(outputDir, `${baseName}-${String(i + 1).padStart(2, '0')}.png`);
    const r = renderSlide({ ...s, slideNumber: i + 1, totalSlides: total, outputPath: out });
    results.push(r);
  });
  return results;
}

const STORYBOARD_TEMPLATES = {
  en: (topic) => ([
    { hook: 'WE COME TO YOU', caption: 'Premium mobile detailing across El Gouna, Hurghada & Sahl Hasheesh.', priceFrom: null, ctaText: 'Swipe →' },
    { hook: 'DESERT DUST', caption: 'Harsh sun, salty air, sand — your paint takes a beating every day.', priceFrom: null, ctaText: 'Swipe →' },
    { hook: 'WATERLESS', caption: 'Car-safe products + premium microfiber. Zero water waste.', priceFrom: null, ctaText: 'Swipe →' },
    { hook: 'FULL DETAIL', caption: 'Exterior + interior + wheels + glass + protection. At your door.', priceFrom: 500, ctaText: 'Swipe →' },
    { hook: 'TRUSTED BY', caption: 'Hotels, compounds and rental fleets across the Red Sea.', priceFrom: null, ctaText: 'Swipe →' },
    { hook: 'BOOK NOW', caption: 'WhatsApp us in 60 seconds. We handle the rest.', priceFrom: 150, ctaText: 'Book on WhatsApp →' }
  ]),
  ar: (topic) => ([
    { hook: 'إحنا بنجلك', caption: 'بريميوم موبايل في الجونة، الغردقة، سهل حشيش.', priceFrom: null, ctaText: 'اسحب ←' },
    { hook: 'تراب الصحرا', caption: 'شمس حارقة، ملح، رمل — عربيتك بتتأذى كل يوم.', priceFrom: null, ctaText: 'اسحب ←' },
    { hook: 'بلا مية', caption: 'منتجات آمنة + مايكروفايبر بريميوم. صفر هدر.', priceFrom: null, ctaText: 'اسحب ←' },
    { hook: 'تفصيل كامل', caption: 'خارجي + داخلي + كاوتشات + زجاج + حماية. لحد عندك.', priceFrom: 500, ctaText: 'اسحب ←' },
    { hook: 'بيثقا فينا', caption: 'فنادق، كمبوندات، وفلات تأجير في البحر الأحمر.', priceFrom: null, ctaText: 'اسحب ←' },
    { hook: 'احجز دلوقتي', caption: 'ابعتلنا واتساب في ٦٠ ثانية. واحنا نكمل الباقي.', priceFrom: 150, ctaText: 'واتساب ←' }
  ]),
  de: (topic) => ([
    { hook: 'WIR KOMMEN ZU IHNEN', caption: 'Premium-mobile Aufbereitung in El Gouna, Hurghada & Sahl Hasheesh.', priceFrom: null, ctaText: 'Wischen →' },
    { hook: 'WÜSTENSTAUB', caption: 'Sonne, Salz, Sand — Ihr Lack leidet jeden Tag.', priceFrom: null, ctaText: 'Wischen →' },
    { hook: 'WASSERLOS', caption: 'Autosichere Produkte + Premium-Mikrofaser. Null Verschwendung.', priceFrom: null, ctaText: 'Wischen →' },
    { hook: 'VOLLAUFbereitung', caption: 'Außen + Innen + Räder + Glas + Schutz. Vor Ihrer Tür.', priceFrom: 500, ctaText: 'Wischen →' },
    { hook: 'VERTRAUEN', caption: 'Hotels, Wohnanlagen und Mietflotten am Roten Meer.', priceFrom: null, ctaText: 'Wischen →' },
    { hook: 'JETZT BUCHEN', caption: 'Schreiben Sie uns auf WhatsApp. Den Rest machen wir.', priceFrom: 150, ctaText: 'WhatsApp →' }
  ])
};

module.exports = {
  renderSlide,
  renderStoryboard,
  STORYBOARD_TEMPLATES,
  W, H, COLORS
};
