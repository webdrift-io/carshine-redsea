#!/usr/bin/env node
/**
 * OpenAI Image Generation Provider
 * --------------------------------
 * Thin adapter for the OpenAI Images API. Exposes a single
 * `generateSlide(prompt, outputPath)` function that other scripts
 * (notably `scripts/generate-slides.js`) can call.
 *
 * Behaviour
 *   - Reads the API key + model from `config.imageGen.{apiKey, model}`.
 *   - Calls POST https://api.openai.com/v1/images/generations with the
 *     TikTok-portrait size `1024x1536` and `quality: 'high'`.
 *   - Decodes the base64 response and writes a PNG to `outputPath`.
 *   - If `dryRun: true` is passed in opts (or the API key is a placeholder),
 *     the function does NOT call OpenAI. It writes a tiny stub PNG and
 *     returns a mock payload so the rest of the pipeline can be tested.
 *
 * Env overrides
 *   - OPENAI_API_KEY  →  preferred over config.json
 *   - OPENAI_BASE_URL →  default https://api.openai.com/v1
 *
 * The default model is `gpt-image-1.5` per the SKILL.md guidance — never
 * `gpt-image-1`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-image-1.5';
const DEFAULT_SIZE = '1024x1536'; // TikTok portrait (9:16)

function isPlaceholderKey(key) {
  if (!key) return true;
  const normalized = String(key).trim();
  if (normalized === '') return true;
  // Catch the common placeholder patterns we ship in config.json
  if (normalized.includes('...')) return true;
  if (normalized.toLowerCase().startsWith('sk-...')) return true;
  if (normalized.toLowerCase().startsWith('sk-proj-...')) return true;
  return false;
}

/**
 * Generate a minimal 1x1 transparent PNG. Used as a placeholder so the
 * downstream pipeline always sees a real file on disk, even in dry-run.
 */
function writeStubPng(outputPath, label) {
  // 1x1 transparent PNG
  const onePixelPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
    '890000000a49444154789c6300010000000500010d0a2db40000000049454e44' +
    'ae426082',
    'hex'
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, onePixelPng);
  return {
    dryRun: true,
    bytes: onePixelPng.length,
    label: label || 'stub',
    path: outputPath
  };
}

/**
 * Build a tiny informative marker on a 1024x1536 transparent canvas so
 * the placeholder is visually distinguishable when previewed. This is
 * *not* a real image; it's just enough to make the dry-run result
 * recognisable in file browsers.
 */
function writeMarkerPng(outputPath, prompt) {
  // Lazy require so this module doesn't crash on systems without canvas.
  let createCanvas;
  try {
    ({ createCanvas } = require('canvas'));
  } catch (e) {
    return writeStubPng(outputPath, 'no-canvas');
  }

  const w = 1024;
  const h = 1536;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Solid brand background
  ctx.fillStyle = '#0b3d2e';
  ctx.fillRect(0, 0, w, h);

  // Subtle diagonal stripe
  ctx.fillStyle = '#115a44';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.4);
  ctx.lineTo(w, h * 0.2);
  ctx.lineTo(w, h * 0.3);
  ctx.lineTo(0, h * 0.5);
  ctx.closePath();
  ctx.fill();

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('DRY-RUN PLACEHOLDER', w / 2, 220);

  // Prompt (truncated, wrapped)
  ctx.font = '36px Arial';
  ctx.fillStyle = '#bce7d2';
  const maxWidth = w * 0.85;
  const lineHeight = 44;
  const words = String(prompt || '').split(/\s+/);
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
    if (lines.length > 22) break;
  }
  if (current) lines.push(current);
  let y = 360;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lineHeight;
  }

  // Footer
  ctx.font = 'bold 32px Arial';
  ctx.fillStyle = '#ffd166';
  ctx.fillText('Set OPENAI_API_KEY in config.json to generate real images',
    w / 2, h - 140);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  return { dryRun: true, bytes: fs.statSync(outputPath).size, path: outputPath };
}

/**
 * @param {string} prompt       Full slide prompt (base + per-slide suffix)
 * @param {string} outputPath   Absolute path where the PNG should be saved
 * @param {object} [opts]
 * @param {string} [opts.apiKey]      Override API key
 * @param {string} [opts.model]       Override model (default gpt-image-1.5)
 * @param {string} [opts.size]        Override size (default 1024x1536)
 * @param {string} [opts.baseUrl]     Override API base URL
 * @param {boolean} [opts.dryRun]     Force dry-run (no API call)
 * @param {object} [opts.config]      The full config.json (alternative to apiKey/model)
 * @returns {Promise<{path: string, dryRun?: boolean, model?: string, bytes?: number}>}
 */
async function generateSlide(prompt, outputPath, opts = {}) {
  const cfg = opts.config || {};
  const imageGen = cfg.imageGen || {};

  const apiKey = opts.apiKey
    || process.env.OPENAI_API_KEY
    || imageGen.apiKey;

  const model = opts.model
    || process.env.OPENAI_IMAGE_MODEL
    || imageGen.model
    || DEFAULT_MODEL;

  const size = opts.size
    || process.env.OPENAI_IMAGE_SIZE
    || DEFAULT_SIZE;

  const baseUrl = opts.baseUrl
    || process.env.OPENAI_BASE_URL
    || DEFAULT_BASE_URL;

  // Force dry-run if the key is a placeholder or absent
  const forceDry = opts.dryRun === true
    || isPlaceholderKey(apiKey)
    || String(apiKey).toLowerCase().includes('placeholder');

  if (forceDry) {
    // Try to write a nice canvas marker; fall back to 1x1 PNG.
    try {
      return writeMarkerPng(outputPath, prompt);
    } catch (e) {
      return writeStubPng(outputPath, e.message);
    }
  }

  // ─── Real call ───
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const url = `${baseUrl.replace(/\/$/, '')}/images/generations`;
  const body = {
    model,
    prompt,
    n: 1,
    size,
    quality: 'high'
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI image generation failed: ${res.status} ${res.statusText} — ${text}`);
  }

  const data = await res.json();
  if (!data?.data?.[0]) {
    throw new Error('OpenAI response missing data[0]');
  }

  const item = data.data[0];
  let buffer;
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) {
      throw new Error(`Failed to download OpenAI image: ${imgRes.status}`);
    }
    buffer = Buffer.from(await imgRes.arrayBuffer());
  } else {
    throw new Error('OpenAI response has neither b64_json nor url');
  }

  fs.writeFileSync(outputPath, buffer);
  return {
    path: outputPath,
    model,
    bytes: buffer.length,
    revisedPrompt: item.revised_prompt || null
  };
}

module.exports = {
  generateSlide,
  // Exposed for testability / orchestration
  isPlaceholderKey,
  writeStubPng,
  writeMarkerPng,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_SIZE
};

// ─── CLI shim ───────────────────────────────────────────────────────
// Usage:  node openai-image.js --prompt "iPhone photo of a Mercedes" --out out.png --config config.json
if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (k) => {
    const i = args.indexOf(`--${k}`);
    return i !== -1 ? args[i + 1] : null;
  };
  const prompt = arg('prompt');
  const out = arg('out');
  const cfgPath = arg('config');
  if (!prompt || !out) {
    console.error('Usage: node openai-image.js --prompt "<text>" --out <path.png> [--config config.json] [--dry-run]');
    process.exit(1);
  }
  const cfg = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
  const dryRun = args.includes('--dry-run');
  generateSlide(prompt, out, { config: cfg, dryRun })
    .then(r => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch(err => {
      console.error('openai-image failed:', err.message);
      process.exit(1);
    });
}
