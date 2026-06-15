#!/usr/bin/env node
/**
 * CarShine Red Sea — Multi-Agent Marketing Pipeline (DRY-RUN MODE)
 *
 * This script runs the full marketing agent pipeline without requiring
 * real OpenAI/Postiz API keys. It:
 *   1. Uses 6 pre-generated sample images (substitute for ImageAgent)
 *   2. Generates 3 post variations (different hooks) via ContentAgent prompts
 *   3. Logs what PostAgent WOULD post (no real Postiz call)
 *   4. Saves the post plan to logs/sample-pipeline-output.json
 *
 * To upgrade to LIVE mode:
 *   - Set OPENAI_API_KEY in config.json
 *   - Set POSTIZ_API_KEY + integration IDs in config.json
 *   - Set LIVE=true in env
 *
 * Usage: node scripts/sample-pipeline.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SAMPLE_DIR = path.join(ROOT, 'posts', 'sample-2026-06-13');
const LOG_DIR = path.join(ROOT, 'logs');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));

const LIVE = process.env.LIVE === 'true';

// Ensure output dirs exist
[LOG_DIR, SAMPLE_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ============================================================================
// ContentAgent — generates 3 post variations with different hooks
// ============================================================================

const HOOKS = [
  {
    id: 'hook-1-problem',
    style: 'Problem → Solution',
    target: 'El Gouna expats / luxury car owners',
    caption: `POV: Your car just spent 6 hours at the El Gouna marina and the salt is destroying your paint. 🧂

We come to YOU. Premium waterless detail at your villa, hotel, or yacht. No water wasted. No waiting.

📍 El Gouna • Hurghada • Sahl Hasheesh
📲 DM to book — first wash 150 EGP

#ElGouna #Hurghada #CarDetailing #MobileCarWash #RedSea #Egypt #LuxuryCars #WaterlessWash`,
    overlay: {
      line1: 'Salt is killing your paint',
      line2: 'We come to you',
      cta: 'DM to book → 150 EGP'
    }
  },
  {
    id: 'hook-2-convenience',
    style: 'Lifestyle convenience',
    target: 'Hurghada resort guests / second-home owners',
    caption: `Why waste your vacation at a car wash? 🏖️

Drop the keys at the front desk. We handle the rest. Your car gleams while you swim.

✅ Premium waterless detail
✅ Pickup & return at your hotel/villa
✅ 60-90 min, no water wasted

📍 Serving Hurghada's top resorts
📲 WhatsApp booking below

#HurghadaLife #ResortLife #CarCare #MobileDetailing #RedSeaEgypt`,
    overlay: {
      line1: 'Drop the keys',
      line2: 'We handle the rest',
      cta: 'WhatsApp → link in bio'
    }
  },
  {
    id: 'hook-3-eco',
    style: 'Eco / values',
    target: 'Sustainability-conscious El Gouna residents',
    caption: `1 car wash = 150 liters of water. 💧

We use ZERO. Premium waterless technology, German-engineered products, results that match traditional wash — better, actually.

The Red Sea needs this. Your car needs this. 🌍

📍 El Gouna • Sahl Hasheesh • Hurghada
📲 DM or WhatsApp

#WaterlessWash #EcoFriendly #SaveWater #RedSea #Sustainable #CarCare #Egypt`,
    overlay: {
      line1: 'Zero water',
      line2: '100% shine',
      cta: 'Try us → DM'
    }
  }
];

// ============================================================================
// ImageAgent — substitute for live image gen (uses pre-generated samples)
// ============================================================================

const SAMPLE_IMAGES = [
  { name: '01-elgouna-mercedes.png', caption: 'Yacht-dock detail at sunset' },
  { name: '02-hurghada-tesla.png',   caption: 'Marina hero shot' },
  { name: '03-sahlhasheesh-range.png', caption: 'Villa driveway drone' },
  { name: '04-macro-polish.png',     caption: 'Macro polish detail' },
  { name: '05-lifestyle-bmw.png',    caption: 'Lifestyle hero' },
  { name: '06-before-after.png',     caption: 'Before/after' }
];

// ============================================================================
// RUN PIPELINE
// ============================================================================

console.log('\n🤖 CarShine Red Sea — Marketing Agent Pipeline');
console.log('━'.repeat(60));
console.log(`Mode: ${LIVE ? '🔴 LIVE' : '🟡 DRY-RUN (no real API calls)'}`);
console.log(`Sample images: ${SAMPLE_IMAGES.length}`);
console.log(`Post variations: ${HOOKS.length}`);
console.log('━'.repeat(60));

const pipelineOutput = {
  runAt: new Date().toISOString(),
  mode: LIVE ? 'live' : 'dry-run',
  config: {
    app: CONFIG.app.name,
    schedule: CONFIG.posting.schedule,
    crossPost: CONFIG.posting.crossPost
  },
  posts: []
};

HOOKS.forEach((hook, i) => {
  const postId = `post-${new Date().toISOString().split('T')[0]}-${i + 1}`;
  console.log(`\n📝 ContentAgent: ${hook.id} (${hook.style})`);
  console.log(`   Caption: "${hook.caption.split('\n')[0].substring(0, 60)}..."`);
  console.log(`   Target: ${hook.target}`);

  // Pick 6 images for this post (one per slide)
  const slides = SAMPLE_IMAGES.map((img, idx) => ({
    slide: idx + 1,
    file: img.name,
    overlay: hook.overlay
  }));

  console.log(`\n🎨 ImageAgent: 6 slides from ${SAMPLE_IMAGES.length} sample images`);
  slides.forEach(s => console.log(`   Slide ${s.slide}: ${s.file}`));

  console.log(`\n✏️  OverlayAgent: "${hook.overlay.line1}" / "${hook.overlay.line2}" / CTA: "${hook.overlay.cta}"`);

  // PostAgent — would call Postiz if LIVE
  const platforms = ['tiktok', 'instagram', 'facebook'];
  if (LIVE) {
    console.log(`\n📤 PostAgent: LIVE — posting to ${platforms.join(', ')} via Postiz`);
  } else {
    console.log(`\n📤 PostAgent: DRY-RUN — would post to ${platforms.join(', ')} at ${CONFIG.posting.schedule[0]}`);
    console.log(`   (privacyLevel: ${CONFIG.posting.privacyLevel})`);
  }

  // AnalyticsAgent — would read Postiz analytics
  console.log(`📊 AnalyticsAgent: would track views, likes, saves, click-throughs → feed back to ContentAgent`);

  pipelineOutput.posts.push({
    id: postId,
    hook: hook.id,
    style: hook.style,
    target: hook.target,
    caption: hook.caption,
    overlay: hook.overlay,
    slides,
    wouldPostTo: platforms,
    schedule: CONFIG.posting.schedule[0],
    privacyLevel: CONFIG.posting.privacyLevel
  });
});

// Save output
const outFile = path.join(LOG_DIR, 'sample-pipeline-output.json');
fs.writeFileSync(outFile, JSON.stringify(pipelineOutput, null, 2));
console.log(`\n━`.repeat(60));
console.log(`\n✅ Pipeline complete. Output saved to: ${path.relative(ROOT, outFile)}`);
console.log(`\nTo upgrade to LIVE mode:`);
console.log(`  1. Sign up: https://platform.openai.com → get OPENAI_API_KEY`);
console.log(`  2. Sign up: https://postiz.com → get POSTIZ_API_KEY + integration IDs`);
console.log(`  3. Add keys to tiktok-marketing/config.json`);
console.log(`  4. Run: LIVE=true node scripts/sample-pipeline.js`);
console.log();
