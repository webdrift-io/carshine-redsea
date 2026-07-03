#!/usr/bin/env node
'use strict';

/**
 * Brand-Template Slide Provider
 * -----------------------------
 * Always-available slide generator that renders CarShine-branded 9:16 PNGs
 * using the brand-slides module. Used by default in the orchestrator when
 * no real image API key is configured — so the pipeline NEVER blocks on a
 * missing third-party credential.
 *
 * CLI-compatible with openai-image.js (--prompt, --out, --config, --dry-run)
 * but ignores --prompt (the brand templates drive the design).
 */

const fs = require('fs');
const path = require('path');
const brandSlides = require('./brand-slides');
const minimaxCopy = require('./minimax-copy');

/**
 * Backward-compat: this file is also reachable as `brand-template.js`
 * (original name). It exports generateSlide + generateStoryboard either way.
 */

/**
 * Generate a single slide. Reads language + topic from --config (passed
 * via CLI), or from process.env, or falls back to defaults.
 */
async function generateSlide(promptIgnored, outputPath, opts = {}) {
  const cfg = opts.config || {};
  const lang = process.env.SLIDE_LANG || cfg.lang || 'en';
  const topic = process.env.SLIDE_TOPIC || cfg.topic || 'premium mobile car wash';
  const useLLM = process.env.SLIDE_USE_LLM !== 'false';

  // Try LLM copy first, fall back to templates
  let copy = null;
  if (useLLM) {
    try {
      copy = await minimaxCopy.generateCopy({ topic, language: lang, platform: 'instagram', count: 6, config: cfg });
    } catch (_e) { copy = null; }
  }
  if (!copy || !copy.usedLLM) {
    copy = minimaxCopy.templateFallback({ topic, language: lang, count: 6 });
  }

  // Pick the first hook + caption + hashtags for a single slide
  const hook = copy.hooks[0] || 'PREMIUM DETAILING';
  const caption = copy.captions[0] || topic;
  const hashtags = copy.hashtags || [];

  // Render 1 slide. If we want a storyboard, caller invokes renderStoryboard
  // directly via --config and the orchestrator handles multi-slide.
  const r = brandSlides.renderSlide({
    hook,
    caption,
    hashtags,
    priceFrom: cfg.priceFrom || null,
    ctaText: cfg.ctaText || 'Book on WhatsApp →',
    slideNumber: 1,
    totalSlides: 1,
    outputPath
  });
  return r;
}

/**
 * Multi-slide storyboard render. Called by the orchestrator when it sees
 * `--storyboard` in args or `imageGen.provider === 'brand-template'` with
 * `slides: 6` in config.
 */
async function generateStoryboard({ lang = 'en', topic = 'premium mobile car wash', outputDir, config = {} } = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const useLLM = process.env.SLIDE_USE_LLM !== 'false';

  let copy = null;
  if (useLLM) {
    try { copy = await minimaxCopy.generateCopy({ topic, language: lang, platform: 'instagram', count: 6, config }); } catch (_e) { copy = null; }
  }
  if (!copy) copy = minimaxCopy.templateFallback({ topic, language: lang, count: 6 });

  // Build 6 slide configs: 1 hook slide, 1 caption-rich slide, 4 brand-tpl slides
  const slides = [
    { hook: (copy.hooks[0] || 'PREMIUM').toUpperCase(), caption: copy.captions[0] || topic, hashtags: copy.hashtags, priceFrom: null, ctaText: 'Swipe →' },
    { hook: (copy.hooks[1] || 'WE COME TO YOU').toUpperCase(), caption: copy.captions[1] || topic, hashtags: copy.hashtags, priceFrom: null, ctaText: 'Swipe →' },
    { hook: (copy.hooks[2] || 'FROM 150 EGP').toUpperCase(), caption: copy.captions[2] || topic, hashtags: copy.hashtags, priceFrom: 150, ctaText: 'Swipe →' },
    { hook: 'FULL DETAIL', caption: 'Exterior + interior + wheels + glass + protection. At your door.', hashtags: copy.hashtags, priceFrom: 500, ctaText: 'Swipe →' },
    { hook: 'TRUSTED BY', caption: 'Hotels, compounds and rental fleets across the Red Sea.', hashtags: copy.hashtags, priceFrom: null, ctaText: 'Swipe →' },
    { hook: 'BOOK NOW', caption: 'WhatsApp us in 60 seconds. We handle the rest.', hashtags: copy.hashtags, priceFrom: 150, ctaText: 'Book on WhatsApp →' }
  ];
  return brandSlides.renderStoryboard({ slides, outputDir, baseName: 'slide' });
}

module.exports = { generateSlide, generateStoryboard };

// CLI shim
if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (k) => { const i = args.indexOf(`--${k}`); return i !== -1 ? args[i + 1] : null; };
  const prompt = arg('prompt');
  const out = arg('out');
  const cfgPath = arg('config');
  const storyboard = args.includes('--storyboard');
  const cfg = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
  if (storyboard) {
    const dir = arg('out') || './out';
    generateStoryboard({ lang: cfg.lang || 'en', topic: cfg.topic || 'premium mobile car wash', outputDir: dir, config: cfg })
      .then(rs => console.log(JSON.stringify(rs, null, 2)))
      .catch(err => { console.error('brand-template failed:', err.message); process.exit(1); });
  } else if (prompt && out) {
    generateSlide(prompt, out, { config: cfg })
      .then(r => console.log(JSON.stringify(r, null, 2)))
      .catch(err => { console.error('brand-template failed:', err.message); process.exit(1); });
  } else {
    console.error('Usage:');
    console.error('  node brand-template.js --prompt "<ignored>" --out <path.png> [--config config.json]');
    console.error('  node brand-template.js --storyboard --out <dir/> [--config config.json]');
    process.exit(1);
  }
}
