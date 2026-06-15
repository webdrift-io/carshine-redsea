#!/usr/bin/env node
/**
 * Build 3 production-ready ad sets for CarShine Red Sea.
 *
 * This script:
 *   1. Uses the 6 pre-generated sample images in posts/sample-2026-06-13/
 *      (we don't have a real OPENAI_API_KEY yet; once set, swap to live gen).
 *   2. Applies the per-hook overlay text using add-text-overlay.js.
 *   3. Writes a manifest.json per ad set with caption, target audience,
 *      scheduled post time, and platform list.
 *
 * Usage:
 *   node build-production-adsets.js
 *   node build-production-adsets.js --output posts/live-2026-06-13
 *   node build-production-adsets.js --openai     (use real OpenAI when key is set)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createCanvas, loadImage } = require('canvas');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const ROOT = __dirname;
const TIKTOK_DIR = path.join(ROOT, '..', '..', 'tiktok-marketing');
const SAMPLE_DIR = path.join(TIKTOK_DIR, 'posts', 'sample-2026-06-13');
const CONFIG_PATH = path.join(TIKTOK_DIR, 'config.json');
const DEFAULT_OUT = path.join(TIKTOK_DIR, 'posts', 'live-2026-06-13');

const outRoot = getArg('output') || DEFAULT_OUT;
const useOpenAI = hasFlag('openai');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const apiKey = config.imageGen?.apiKey;
const apiKeyLooksReal = apiKey && !apiKey.includes('...') && !apiKey.startsWith('sk-proj-...');

// 6 source images, named by content (one slide per image)
const SAMPLE_IMAGES = [
  '01-elgouna-mercedes-yacht.png',
  '02-hurghada-tesla-marina.png',
  '03-sahlhasheesh-range-villa.png',
  '04-macro-polish.png',
  '05-lifestyle-bmw-elgouna.png',
  '06-before-after-desert.png'
];

const HOOKS = [
  {
    id: 'hook-1-problem',
    style: 'Problem → Solution',
    target: 'El Gouna expats / luxury car owners',
    overlay: { line1: 'Salt is killing your paint', line2: 'We come to you', cta: 'DM to book → 150 EGP' },
    caption: `POV: Your car just spent 6 hours at the El Gouna marina and the salt is destroying your paint.

We come to YOU. Premium waterless detail at your villa, hotel, or yacht. No water wasted. No waiting.

El Gouna • Hurghada • Sahl Hasheesh
DM to book — first wash 150 EGP

#ElGouna #Hurghada #CarDetailing #MobileCarWash #RedSea #Egypt #LuxuryCars #WaterlessWash`,
    // Schedule: 07:30 (early scroll — first post of the day)
    schedule: '07:30',
    hashtags: ['#ElGouna', '#Hurghada', '#CarDetailing', '#MobileCarWash', '#RedSea', '#Egypt', '#LuxuryCars', '#WaterlessWash']
  },
  {
    id: 'hook-2-convenience',
    style: 'Lifestyle convenience',
    target: 'Hurghada resort guests / second-home owners',
    overlay: { line1: 'Drop the keys', line2: 'We handle the rest', cta: 'WhatsApp → link in bio' },
    caption: `Why waste your vacation at a car wash?

Drop the keys at the front desk. We handle the rest. Your car gleams while you swim.

Premium waterless detail
Pickup & return at your hotel or villa
60-90 min, no water wasted

Serving Hurghada's top resorts
WhatsApp booking below

#HurghadaLife #ResortLife #CarCare #MobileDetailing #RedSeaEgypt`,
    // Schedule: 16:30 (afternoon break)
    schedule: '16:30',
    hashtags: ['#HurghadaLife', '#ResortLife', '#CarCare', '#MobileDetailing', '#RedSeaEgypt', '#ElGouna', '#Hurghada']
  },
  {
    id: 'hook-3-eco',
    style: 'Eco / values',
    target: 'Sustainability-conscious El Gouna residents',
    overlay: { line1: 'Zero water', line2: '100% shine', cta: 'Try us → DM' },
    caption: `1 car wash = 150 liters of water.

We use ZERO. Premium waterless technology, German-engineered products, results that match traditional wash — better, actually.

The Red Sea needs this. Your car needs this.

El Gouna • Sahl Hasheesh • Hurghada
DM or WhatsApp

#WaterlessWash #EcoFriendly #SaveWater #RedSea #Sustainable #CarCare #Egypt`,
    // Schedule: 21:00 (evening wind-down)
    schedule: '21:00',
    hashtags: ['#WaterlessWash', '#EcoFriendly', '#SaveWater', '#RedSea', '#Sustainable', '#CarCare', '#Egypt']
  }
];

const PLATFORMS = ['tiktok', 'instagram', 'facebook'];

/**
 * Convert an overlay to the 6-line texts array that add-text-overlay.js expects.
 * Slide 6 always carries the CTA (last slide = call to action).
 */
function overlayToTexts(overlay) {
  return [
    overlay.line1,         // hook
    overlay.line2,         // hook continuation
    'at your villa',       // mid-frame reassurance
    'or hotel',
    'first wash 150 EGP',  // social proof / pricing
    overlay.cta           // CTA on final slide
  ];
}

/**
 * Compose the ISO schedule date: today (Europe/Berlin) at the configured
 * posting time. We use the system clock — production would compute this
 * in the user's timezone via a tz library.
 */
function composeScheduleDate(today, hhmm) {
  const [hh, mm] = hhmm.split(':').map(n => parseInt(n, 10));
  const d = new Date(today);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

/**
 * Re-frame a landscape source image into a TikTok-portrait (1080x1920)
 * canvas. The image is centered on a vertical gradient backdrop (deep
 * teal → gold) so the final result fills the screen end-to-end on mobile.
 *
 * This is a deliberate design choice — see SKILL.md "Image rules":
 *   "ALWAYS portrait aspect ratio (1024x1536 or 9:16 equivalent) —
 *    fills TikTok screen"
 *
 * @param {string} srcPath  Path to source image (any aspect)
 * @param {string} outPath  Path to write 1080x1920 PNG
 * @returns {Promise<{width:number, height:number, bytes:number}>}
 */
async function reframeToPortrait(srcPath, outPath) {
  const W = 1080;
  const H = 1920;
  const img = await loadImage(srcPath);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Vertical brand gradient (deep teal → warm sand)
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, '#053b2c');
  grad.addColorStop(0.45, '#0a5e44');
  grad.addColorStop(0.85, '#1a8a64');
  grad.addColorStop(1.00, '#c79a4a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Add subtle horizontal noise band
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, H * 0.55, W, 4);

  // Fit image into the safe zone (90% width × 60% height) — centered
  const maxW = W * 0.90;
  const maxH = H * 0.58;
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const drawX = (W - drawW) / 2;
  const drawY = H * 0.18;  // upper-center

  // Drop shadow for the inset
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 8;

  // Rounded inset
  const radius = 28;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(drawX + radius, drawY);
  ctx.lineTo(drawX + drawW - radius, drawY);
  ctx.quadraticCurveTo(drawX + drawW, drawY, drawX + drawW, drawY + radius);
  ctx.lineTo(drawX + drawW, drawY + drawH - radius);
  ctx.quadraticCurveTo(drawX + drawW, drawY + drawH, drawX + drawW - radius, drawY + drawH);
  ctx.lineTo(drawX + radius, drawY + drawH);
  ctx.quadraticCurveTo(drawX, drawY + drawH, drawX, drawY + drawH - radius);
  ctx.lineTo(drawX, drawY + radius);
  ctx.quadraticCurveTo(drawX, drawY, drawX + radius, drawY);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();

  // Reset shadow
  ctx.shadowColor = 'transparent';

  // Subtle watermark brand mark (bottom)
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('CarShine Red Sea', W / 2, H * 0.92);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '20px Arial';
  ctx.fillText('Premium waterless mobile detailing', W / 2, H * 0.94);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  return { width: W, height: H, bytes: buf.length };
}

async function buildAdset(hook, adsetIndex) {
  const adsetDir = path.join(outRoot, `adset-${adsetIndex}`);
  fs.mkdirSync(adsetDir, { recursive: true });

  console.log(`\n📦 Ad set ${adsetIndex}/3: ${hook.id} (${hook.style})`);
  console.log(`   Target: ${hook.target}`);
  console.log(`   Scheduled: ${hook.schedule} Berlin time`);

  // 1) Stage the 6 source images as slide{N}_raw.png in adsetDir
  if (useOpenAI && apiKeyLooksReal) {
    console.log('   🎨 Generating fresh slides via OpenAI (gpt-image-1.5)...');
    const promptsPath = path.join(adsetDir, 'prompts.json');
    // Per-hook slide prompts — slight variation per ad set
    const slides = [
      `Slide 1 (${hook.style}): Mercedes G-Wagon parked next to a yacht at El Gouna marina, golden hour, sea visible behind, salt-flecked paint before detail`,
      `Slide 2 (${hook.style}): Tesla Model S at a Hurghada resort valet stand, palm trees, polished paint, fresh morning light`,
      `Slide 3 (${hook.style}): Range Rover Sport on a private villa driveway in Sahl Hasheesh, red mountains in background, deep blue sky`,
      `Slide 4 (${hook.style}): Macro close-up of a buffed hood reflecting the desert sun, water droplets beading, mirror-like finish`,
      `Slide 5 (${hook.style}): BMW 7 series parked on a wooden jetty, turquoise Red Sea water below, lifestyle luxury vibe`,
      `Slide 6 (${hook.style}): Before-and-after split of a dusty car turning into a freshly detailed show-shine, same angle, same car`
    ];
    fs.writeFileSync(promptsPath, JSON.stringify({
      base: 'iPhone photo of a luxury car in the Red Sea, warm Egyptian sun, real photo, natural lighting, no text, no watermarks, no logos',
      slides
    }, null, 2));
    execSync(
      `node "${path.join(TIKTOK_DIR, 'scripts', 'generate-slides.js')}" --config "${CONFIG_PATH}" --output "${adsetDir}" --prompts "${promptsPath}"`,
      { stdio: 'inherit', timeout: 600000 }
    );
  } else {
    console.log('   🖼️  Re-framing 6 sample images to 1080x1920 portrait (TikTok)...');
    for (let i = 0; i < SAMPLE_IMAGES.length; i++) {
      const src = path.join(SAMPLE_DIR, SAMPLE_IMAGES[i]);
      const dst = path.join(adsetDir, `slide${i + 1}_raw.png`);
      const meta = await reframeToPortrait(src, dst);
      console.log(`      ✅ ${SAMPLE_IMAGES[i]} → slide${i + 1}_raw.png  (${meta.width}x${meta.height}, ${(meta.bytes / 1024).toFixed(1)} KB)`);
    }
  }

  // 2) Add text overlays
  const textsPath = path.join(adsetDir, 'texts.json');
  fs.writeFileSync(textsPath, JSON.stringify(overlayToTexts(hook.overlay), null, 2));
  console.log('   ✏️  Adding text overlays...');
  execSync(
    `node "${path.join(TIKTOK_DIR, 'scripts', 'add-text-overlay.js')}" --input "${adsetDir}" --texts "${textsPath}"`,
    { stdio: 'inherit', timeout: 120000 }
  );

  // 3) Build the manifest.json
  const slides = [];
  for (let i = 1; i <= 6; i++) {
    const p = path.join(adsetDir, `slide${i}.png`);
    if (fs.existsSync(p)) {
      slides.push({ slide: i, file: `slide${i}.png`, path: p });
    }
  }

  const today = new Date();
  const scheduledFor = composeScheduleDate(today, hook.schedule);

  const manifest = {
    adset: adsetIndex,
    generatedAt: new Date().toISOString(),
    app: config.app.name,
    hook: {
      id: hook.id,
      style: hook.style,
      target: hook.target
    },
    caption: hook.caption,
    overlay: hook.overlay,
    hashtags: hook.hashtags,
    cta: hook.overlay.cta,
    target_audience: hook.target,
    platforms: PLATFORMS,
    privacy: 'SELF_ONLY',  // drafts — manual music pick before publish
    dimensions: { width: 1080, height: 1920 },
    slides,
    imageSource: (useOpenAI && apiKeyLooksReal) ? 'openai' : 'sample-2026-06-13',
    schedule: {
      time: hook.schedule,
      timezone: 'Europe/Berlin',
      scheduledFor
    },
    publishSteps: [
      '1. Open TikTok app',
      '2. Go to Inbox → Drafts',
      '3. Open the post',
      '4. Add a trending sound (search the niche — Red Sea, roadtrip, lifestyle)',
      '5. Review caption + hashtags, hit Publish',
      '6. Repeat for Instagram Reels and Facebook Reels from the cross-posted drafts'
    ]
  };

  const manifestPath = path.join(adsetDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`   📋 manifest.json written (${slides.length} slides)`);

  return { adsetDir, manifest };
}

(async () => {
  console.log('━'.repeat(60));
  console.log('🤖 CarShine Red Sea — Production Ad Set Builder');
  console.log('━'.repeat(60));
  console.log(`Output: ${outRoot}`);
  console.log(`Image source: ${(useOpenAI && apiKeyLooksReal) ? 'OpenAI gpt-image-1.5' : 'sample-2026-06-13/'}`);
  console.log(`Platforms: ${PLATFORMS.join(', ')}`);

  if (!useOpenAI) {
    console.log('\n💡 To regenerate slides from real prompts once OPENAI_API_KEY is set:');
    console.log('   1. Replace imageGen.apiKey in config.json with the real sk-... value');
    console.log('   2. Run: node scripts/build-production-adsets.js --openai\n');
  }

  const built = [];
  for (let i = 0; i < HOOKS.length; i++) {
    built.push(await buildAdset(HOOKS[i], i + 1));
  }

  // Top-level index
  const index = {
    generatedAt: new Date().toISOString(),
    app: config.app.name,
    imageSource: (useOpenAI && apiKeyLooksReal) ? 'openai' : 'sample-2026-06-13',
    platforms: PLATFORMS,
    privacy: 'SELF_ONLY',
    adsets: built.map(b => ({
      adset: path.basename(b.adsetDir),
      manifest: path.join(b.adsetDir, 'manifest.json')
    }))
  };
  fs.writeFileSync(path.join(outRoot, 'index.json'), JSON.stringify(index, null, 2));

  console.log('\n━'.repeat(60));
  console.log(`✅ Built 3 ad sets in ${outRoot}`);
  console.log(`📑 Index: ${path.join(outRoot, 'index.json')}`);
  console.log('━'.repeat(60));
})();
