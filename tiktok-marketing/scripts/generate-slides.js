#!/usr/bin/env node
/**
 * Generate 6 TikTok slideshow images using the user's chosen image generation provider.
 *
 * This script is a thin CLI wrapper around `scripts/providers/openai-image.js`
 * (and the other providers stubbed in `scripts/providers/`). It keeps the
 * same CLI signature as before:
 *
 *   node generate-slides.js --config <config.json> --output <dir> --prompts <prompts.json>
 *
 * prompts.json format:
 *   {
 *     "base":  "Shared base prompt for all slides",
 *     "slides": [ "Slide 1 additions", "Slide 2 additions", ...6 total ]
 *   }
 *
 * Behaviour
 *   - If `config.imageGen.apiKey` is a placeholder (or --dry-run is passed),
 *     no real API call is made; the provider writes a labelled marker PNG
 *     so downstream steps (overlay, post) can still execute.
 *   - Generated slides are saved as `slideN_raw.png` (kept for back-compat
 *     with `add-text-overlay.js`).
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const configPath = getArg('config');
const outputDir = getArg('output');
const promptsPath = getArg('prompts');

if (!configPath || !outputDir || !promptsPath) {
  console.error('Usage: node generate-slides.js --config <config.json> --output <dir> --prompts <prompts.json>');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));

if (!prompts.slides || prompts.slides.length !== 6) {
  console.error('ERROR: prompts.json must have exactly 6 slides');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const provider = config.imageGen?.provider || 'openai';
const model = config.imageGen?.model || 'gpt-image-1.5';
const useLLM = config.imageGen?.useLLMCopy !== false; // default true

// Lazy-require the provider module so this script still works even if a
// particular provider is missing.
let providerModule;
try {
  providerModule = require(path.join(__dirname, 'providers', `${provider}-image.js`));
} catch (e) {
  // Try brand-template as a fallback (no apiKey required)
  try {
    providerModule = require(path.join(__dirname, 'providers', 'brand-template.js'));
    console.warn(`⚠️  Provider "${provider}" not found, using brand-template fallback.`);
  } catch (e2) {
    console.error(`ERROR: could not load provider "${provider}": ${e.message}`);
    console.error(`       Make sure scripts/providers/${provider}-image.js exists.`);
    process.exit(1);
  }
}

if (typeof providerModule.generateSlide !== 'function') {
  console.error(`ERROR: provider module "${provider}" does not export generateSlide()`);
  process.exit(1);
}

const dryRun = hasFlag('dry-run') || process.env.DRY_RUN === 'true';
const useStoryboard = provider === 'brand-template' || hasFlag('storyboard');

// Pass lang + topic to provider via env so brand-template can use it
const lang = (config.languages && config.languages[0]) || 'en';
process.env.SLIDE_LANG = process.env.SLIDE_LANG || lang;
process.env.SLIDE_TOPIC = process.env.SLIDE_TOPIC || config.app?.name || 'premium mobile car wash';
process.env.SLIDE_USE_LLM = useLLM ? 'true' : 'false';

if (provider === 'openai' && model && !model.includes('1.5')) {
  console.warn(`\n⚠️  WARNING: You're using "${model}" — this produces noticeably AI-looking images.`);
  console.warn(`   STRONGLY RECOMMENDED: Switch to "gpt-image-1.5" in your config for photorealistic results.`);
  console.warn(`   The quality difference is massive and directly impacts views.\n`);
}

async function generate(prompt, outPath, slideIndex = 0) {
  // brand-template has a storyboard path that produces all 6 slides at once
  if (useStoryboard && typeof providerModule.generateStoryboard === 'function') {
    if (slideIndex !== 0) return; // only call once for all 6
    const results = await providerModule.generateStoryboard({
      lang: process.env.SLIDE_LANG,
      topic: process.env.SLIDE_TOPIC,
      outputDir,
      config
    });
    // Copy storyboard files to the slide1_raw.png..slide6_raw.png names so
    // the downstream overlay step finds them where it expects.
    for (let k = 0; k < results.length; k++) {
      const dst = path.join(outputDir, `slide${k + 1}_raw.png`);
      fs.copyFileSync(results[k].path, dst);
      console.log(`  ✅ ${path.basename(dst)} (${(fs.statSync(dst).size / 1024).toFixed(1)} KB) [storyboard]`);
    }
    return { path: results[0].path, bytes: fs.statSync(results[0].path).size, model: 'brand-template-storyboard' };
  }
  console.log(`  Generating ${path.basename(outPath)} [${provider}/${model}]...`);
  const result = await providerModule.generateSlide(prompt, outPath, { config, dryRun });
  const bytes = result.bytes || (fs.existsSync(outPath) ? fs.statSync(outPath).size : 0);
  const tag = result.dryRun ? ' (dry-run placeholder)' : '';
  console.log(`  ✅ ${path.basename(outPath)} (${(bytes / 1024).toFixed(1)} KB)${tag}`);
  return result;
}

(async () => {
  console.log(`🎬 Generating 6 slides for ${config.app?.name || 'app'} using ${provider}/${model}${dryRun ? ' [DRY-RUN]' : ''}${useStoryboard ? ' [STORYBOARD]' : ''}\n`);
  let success = 0;
  let skipped = 0;
  let failed = 0;
  let ranStoryboard = false;
  for (let i = 0; i < 6; i++) {
    const outPath = path.join(outputDir, `slide${i + 1}_raw.png`);
    // Resume from partial run
    if (!dryRun && fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      console.log(`  ⏭ slide${i + 1}_raw.png already exists, skipping`);
      success++;
      skipped++;
      continue;
    }
    if (ranStoryboard) { success++; continue; }
    const fullPrompt = `${prompts.base}\n\n${prompts.slides[i]}`;
    try {
      await generate(fullPrompt, outPath, i);
      success++;
      // For storyboard, generate() already produced all 6 files; count them and break
      if (useStoryboard) {
        ranStoryboard = true;
        for (let k = 1; k < 6; k++) {
          const p = path.join(outputDir, `slide${k + 1}_raw.png`);
          if (fs.existsSync(p) && fs.statSync(p).size > 10000) success++;
        }
        break;
      }
    } catch (e) {
      failed++;
      console.error(`  ❌ Slide ${i + 1} failed: ${e.message}`);
      console.error(`     Re-run this script to retry — completed slides are preserved.`);
    }
  }
  const summary = `\n✨ Generated ${success}/6 slides in ${outputDir}` +
    (skipped > 0 ? ` (${skipped} skipped — already existed)` : '') +
    (failed > 0 ? ` (${failed} failed)` : '');
  console.log(summary);
  if (failed > 0) {
    process.exit(1);
  }
})();
