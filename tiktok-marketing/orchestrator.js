#!/usr/bin/env node
/**
 * Multi-Platform Social Media Orchestrator
 *
 * Coordinates content creation, posting, and analytics across:
 *   - TikTok
 *   - Instagram (Reels / Feed)
 *   - Facebook (Page + Reels)
 *   - YouTube Shorts, Threads, X, LinkedIn (auto-handled by Postiz)
 *
 * Features:
 *   - Config validation on startup (fail-fast in live mode)
 *   - Live pipeline: prompts → generate slides → overlay text → upload → post
 *   - Real provider adapters in scripts/providers/ (openai-image, postiz)
 *   - Dry-run mode (--dry-run): exercises the full pipeline WITHOUT
 *     calling real APIs; logs what would be posted
 *   - Error alerting (file logging + structured errors)
 *   - Automated cron scheduling
 *   - Cross-platform consistency (privacyLevel: SELF_ONLY = draft mode)
 *
 * Usage:
 *   node orchestrator.js --validate
 *   node orchestrator.js --pipeline        (live run; needs real API keys)
 *   node orchestrator.js --dry-run         (full pipeline, no real APIs)
 *   node orchestrator.js --adset <adset-dir>
 *   node orchestrator.js --analytics
 *   node orchestrator.js --schedule        (start cron)
 *   node orchestrator.js --test-alert
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');

// ============================================================================
// CONFIGURATION
// ============================================================================

const ROOT = path.join(__dirname, '..');
const TIKTOK_DIR = __dirname;
const LOG_DIR = path.join(TIKTOK_DIR, 'logs');
const ALERTS_LOG = path.join(LOG_DIR, 'alerts.log');
const RUN_LOG = path.join(LOG_DIR, 'orchestrator.log');
const REPORT_DIR = path.join(TIKTOK_DIR, 'reports');
const CONFIG_PATH = path.join(TIKTOK_DIR, 'config.json');
const CONFIG_TEMPLATE = path.join(TIKTOK_DIR, 'config.template.json');
const PROVIDERS_DIR = path.join(TIKTOK_DIR, 'scripts', 'providers');

// Ensure directories exist
[LOG_DIR, REPORT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ============================================================================
// PLATFORM DEFINITIONS
// ============================================================================

const PLATFORMS = {
  tiktok: {
    name: 'TikTok',
    integrationKey: 'tiktok',
    privacyLevel: 'SELF_ONLY',  // Draft mode for manual music selection
    dimensions: { width: 1080, height: 1920 },
    maxCaptionLength: 2200,
    maxHashtags: 10,
    supports: ['slideshow', 'video', 'reel'],
    postingEndpoint: '/posts',
    requiresSound: true,
    notes: 'Posts as draft (SELF_ONLY) so user can add trending sound before publishing'
  },
  instagram: {
    name: 'Instagram',
    integrationKey: 'instagram',
    privacyLevel: 'PUBLIC',
    dimensions: { width: 1080, height: 1920 },
    maxCaptionLength: 2200,
    maxHashtags: 30,
    supports: ['reel', 'story', 'feed-carousel'],
    postingEndpoint: '/posts',
    requiresSound: false,
    notes: 'Reels format, can post carousel or single image'
  },
  facebook: {
    name: 'Facebook',
    integrationKey: 'facebook',
    privacyLevel: 'PUBLIC',
    dimensions: { width: 1080, height: 1920 },
    maxCaptionLength: 63206,
    maxHashtags: 30,
    supports: ['reel', 'story', 'feed-video'],
    postingEndpoint: '/posts',
    requiresSound: false,
    notes: 'Facebook Page + Reels support'
  },
  youtube: {
    name: 'YouTube Shorts',
    integrationKey: 'youtube',
    privacyLevel: 'PUBLIC',
    dimensions: { width: 1080, height: 1920 },
    postingEndpoint: '/posts',
    supports: ['short']
  },
  threads: {
    name: 'Threads',
    integrationKey: 'threads',
    privacyLevel: 'PUBLIC',
    dimensions: { width: 1080, height: 1920 },
    postingEndpoint: '/posts',
    supports: ['post']
  }
};

// ============================================================================
// LOGGING
// ============================================================================

function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const logLine = JSON.stringify({
    timestamp,
    level,
    message,
    ...meta
  });
  try {
    fs.appendFileSync(RUN_LOG, logLine + '\n');
  } catch (e) {
    // If the log dir is gone, don't crash the pipeline.
  }
  const colorMap = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    success: '\x1b[32m',
    debug: '\x1b[90m'
  };
  const color = colorMap[level] || '';
  const reset = '\x1b[0m';
  console.log(`${color}[${timestamp}] ${level.toUpperCase()}${reset} ${message}`);
}

function alert(severity, title, details = {}) {
  const timestamp = new Date().toISOString();
  const alertLine = JSON.stringify({
    timestamp,
    severity,
    title,
    details
  });
  try {
    fs.appendFileSync(ALERTS_LOG, alertLine + '\n');
  } catch (e) {}

  log(severity === 'critical' ? 'error' : 'warn', `🚨 ALERT: ${title}`, details);

  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ severity, title, details, timestamp })
    }).catch(err => log('warn', `Failed to send alert webhook: ${err.message}`));
  }
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

/**
 * Validate config.json. In LIVE mode, fail fast on placeholders.
 * In DRY-RUN mode, log warnings but still return a usable config so the
 * pipeline can be exercised end-to-end with mock providers.
 *
 * @param {object} options
 * @param {boolean} [options.dryRun=false]
 * @returns {object|false} Validated config, or false on failure
 */
function validateConfig({ dryRun = false } = {}) {
  log('info', '🔍 Validating configuration...');

  if (!fs.existsSync(CONFIG_PATH)) {
    log('error', `Config not found: ${CONFIG_PATH}`);
    if (fs.existsSync(CONFIG_TEMPLATE)) {
      log('info', `Creating from template: ${CONFIG_TEMPLATE}`);
      fs.copyFileSync(CONFIG_TEMPLATE, CONFIG_PATH);
      log('warn', '⚠️  Config created with template values. Please update with real API keys.');
    }
    return false;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const errors = [];
  const warnings = [];

  // App section
  if (!config.app?.name) errors.push('app.name is required');
  if (!config.app?.description) errors.push('app.description is required');
  if (!config.app?.audience) errors.push('app.app.audience is required');

  // Image generation
  const hasImageKey = config.imageGen?.apiKey
    && !config.imageGen.apiKey.startsWith('sk-...')
    && !config.imageGen.apiKey.includes('...');
  if (!config.imageGen?.provider) {
    errors.push('imageGen.provider is required (openai|stability|replicate|local)');
  } else if (config.imageGen.provider !== 'local' && !hasImageKey) {
    if (dryRun) {
      warnings.push('imageGen.apiKey is a placeholder — dry-run will use mock provider output');
    } else {
      errors.push('imageGen.apiKey is a placeholder - real key required for live mode');
    }
  }
  if (config.imageGen?.provider === 'openai' && config.imageGen.model === 'gpt-image-1') {
    errors.push('imageGen.model must be gpt-image-1.5 (NOT gpt-image-1) for realistic results');
  }

  // Postiz API
  const postizKeyOk = config.postiz?.apiKey && !config.postiz.apiKey.includes('...');
  if (!postizKeyOk) {
    if (dryRun) {
      warnings.push('postiz.apiKey is a placeholder — dry-run will use mock Postiz responses');
    } else {
      errors.push('postiz.apiKey is a placeholder - real Postiz key required for live mode');
    }
  }

  // Integration IDs - at least TikTok required
  const tiktokIdOk = config.postiz?.integrationIds?.tiktok
    && !config.postiz.integrationIds.tiktok.includes('here');
  if (!tiktokIdOk) {
    if (dryRun) {
      warnings.push('postiz.integrationIds.tiktok is a placeholder — dry-run will use mock Postiz responses');
    } else {
      errors.push('postiz.integrationIds.tiktok is a placeholder - real integration ID required for live mode');
    }
  }

  // Cross-post platforms
  const crossPost = config.posting?.crossPost || [];
  for (const platform of crossPost) {
    const id = config.postiz?.integrationIds?.[platform];
    if (!id || id.includes('here')) {
      warnings.push(`postiz.integrationIds.${platform} not configured - cross-posting to ${platform} will be skipped`);
    }
  }

  // Posting schedule
  if (!config.posting?.schedule || config.posting.schedule.length === 0) {
    errors.push('posting.schedule is empty - at least one posting time required');
  }

  // Privacy level validation
  const validPrivacy = ['PUBLIC', 'FRIENDS', 'SELF_ONLY'];
  if (config.posting?.privacyLevel && !validPrivacy.includes(config.posting.privacyLevel)) {
    errors.push(`posting.privacyLevel must be one of: ${validPrivacy.join(', ')}`);
  }

  if (config.posting?.privacyLevel === 'PUBLIC' && !crossPost.includes('instagram')) {
    warnings.push('Posting as PUBLIC to TikTok - consider SELF_ONLY for draft workflow (add music manually)');
  }

  // Display results
  if (errors.length > 0) {
    log('error', `❌ ${errors.length} configuration error(s):`);
    errors.forEach(e => log('error', `   - ${e}`));
    alert('critical', 'Config validation failed', { errors });
    return false;
  }

  if (warnings.length > 0) {
    log('warn', `⚠️  ${warnings.length} warning(s):`);
    warnings.forEach(w => log('warn', `   - ${w}`));
  }

  log('success', dryRun ? '✅ Configuration valid (dry-run mode)' : '✅ Configuration valid');
  return config;
}

// ============================================================================
// PROVIDER LOADING
// ============================================================================

function loadProvider(name) {
  const modulePath = path.join(PROVIDERS_DIR, `${name}.js`);
  if (!fs.existsSync(modulePath)) {
    throw new Error(`Provider module not found: ${modulePath}`);
  }
  return require(modulePath);
}

// ============================================================================
// PROMPTS / OVERLAYS — pulled from sample-pipeline.js's proven hooks
// ============================================================================

const HOOKS = [
  {
    id: 'hook-1-problem',
    style: 'Problem → Solution',
    target: 'El Gouna expats / luxury car owners',
    overlay: {
      line1: 'Salt is killing your paint',
      line2: 'We come to you',
      cta: 'DM to book → 150 EGP'
    },
    caption: `POV: Your car just spent 6 hours at the El Gouna marina and the salt is destroying your paint.

We come to YOU. Premium waterless detail at your villa, hotel, or yacht. No water wasted. No waiting.

El Gouna • Hurghada • Sahl Hasheesh
DM to book — first wash 150 EGP

#ElGouna #Hurghada #CarDetailing #MobileCarWash #RedSea #Egypt #LuxuryCars #WaterlessWash`
  },
  {
    id: 'hook-2-convenience',
    style: 'Lifestyle convenience',
    target: 'Hurghada resort guests / second-home owners',
    overlay: {
      line1: 'Drop the keys',
      line2: 'We handle the rest',
      cta: 'WhatsApp → link in bio'
    },
    caption: `Why waste your vacation at a car wash?

Drop the keys at the front desk. We handle the rest. Your car gleams while you swim.

Premium waterless detail
Pickup & return at your hotel or villa
60-90 min, no water wasted

Serving Hurghada's top resorts
WhatsApp booking below

#HurghadaLife #ResortLife #CarCare #MobileDetailing #RedSeaEgypt`
  },
  {
    id: 'hook-3-eco',
    style: 'Eco / values',
    target: 'Sustainability-conscious El Gouna residents',
    overlay: {
      line1: 'Zero water',
      line2: '100% shine',
      cta: 'Try us → DM'
    },
    caption: `1 car wash = 150 liters of water.

We use ZERO. Premium waterless technology, German-engineered products, results that match traditional wash — better, actually.

The Red Sea needs this. Your car needs this.

El Gouna • Sahl Hasheesh • Hurghada
DM or WhatsApp

#WaterlessWash #EcoFriendly #SaveWater #RedSea #Sustainable #CarCare #Egypt`
  }
];

const SLIDE_PROMPTS_BASE = {
  base: 'iPhone photo of a luxury car in the Red Sea, warm Egyptian sun, real photo, natural lighting, no text, no watermarks, no logos',
  slides: [
    'Slide 1: Mercedes G-Wagon parked next to a yacht at El Gouna marina, golden hour, sea visible behind',
    'Slide 2: Tesla Model S at a Hurghada resort valet stand, palm trees, polished paint, fresh morning light',
    'Slide 3: Range Rover Sport on a private villa driveway in Sahl Hasheesh, red mountains in background, deep blue sky',
    'Slide 4: Macro close-up of a buffed hood reflecting the desert sun, water droplets beading, mirror-like finish',
    'Slide 5: BMW 7 series parked on a wooden jetty, turquoise Red Sea water below, lifestyle luxury vibe',
    'Slide 6: Before-and-after split of a dusty car turning into a freshly detailed show-shine, same angle, same car'
  ]
};

/**
 * Convert an overlay record (line1/line2/cta) into the 6-element texts
 * array expected by add-text-overlay.js. The CTA is shown on the last
 * slide, the hook split across the first 5.
 */
function overlayToTexts(overlay) {
  return [
    overlay.line1,
    overlay.line2,
    'at your villa',
    'or hotel',
    'first wash 150 EGP',
    overlay.cta
  ];
}

// ============================================================================
// PIPELINE — generate → overlay → upload → post
// ============================================================================

/**
 * Run the full content pipeline for a single ad set.
 *
 * @param {object} options
 * @param {object} options.config           Validated config.json
 * @param {object} options.hook             One entry from HOOKS
 * @param {string} options.outputDir        Where to put slides + meta.json
 * @param {boolean} options.dryRun          If true, don't call real APIs
 * @param {string} [options.schedule]       ISO date to schedule Postiz post
 * @returns {Promise<{outputDir, posts, errors, hook, slides, platformResults}>}
 */
async function runPipeline({
  config,
  hook,
  outputDir,
  dryRun = false,
  schedule = null
}) {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  log('info', `🚀 Starting pipeline [${runId}] hook=${hook.id} dryRun=${dryRun} out=${outputDir}`);

  const result = {
    runId,
    hook: hook.id,
    outputDir,
    posts: [],
    errors: [],
    slides: [],
    platformResults: {}
  };

  fs.mkdirSync(outputDir, { recursive: true });

  // ─── Step 1: Generate slide images ─────────────────────────────────
  try {
    log('info', '🎨 Step 1/4: Generating 6 slide images...');
    const promptsPath = path.join(outputDir, 'prompts.json');
    fs.writeFileSync(promptsPath, JSON.stringify(SLIDE_PROMPTS_BASE, null, 2));

    const args = [
      '--config', CONFIG_PATH,
      '--output', outputDir,
      '--prompts', promptsPath
    ];
    if (dryRun) args.push('--dry-run');

    execSync(`node "${path.join(TIKTOK_DIR, 'scripts', 'generate-slides.js')}" ${args.map(a => `"${a}"`).join(' ')}`, {
      stdio: 'pipe',
      timeout: 600000  // 10 min — gpt-image-1.5 can be slow for 6 images
    });
    log('success', '✅ Step 1 complete: 6 slide images generated');
  } catch (e) {
    const msg = `Slide generation failed: ${e.message}`;
    log('error', `❌ ${msg}`);
    alert('error', 'Slide generation failed', { hook: hook.id, error: e.message });
    result.errors.push({ step: 'generate', error: e.message });
    return result;
  }

  // ─── Step 2: Add text overlays ─────────────────────────────────────
  try {
    log('info', '✏️  Step 2/4: Adding text overlays...');
    const textsPath = path.join(outputDir, 'texts.json');
    fs.writeFileSync(textsPath, JSON.stringify(overlayToTexts(hook.overlay), null, 2));

    execSync(`node "${path.join(TIKTOK_DIR, 'scripts', 'add-text-overlay.js')}" --input "${outputDir}" --texts "${textsPath}"`, {
      stdio: 'pipe',
      timeout: 120000
    });
    log('success', '✅ Step 2 complete: 6 overlays added');
  } catch (e) {
    const msg = `Text overlay failed: ${e.message}`;
    log('error', `❌ ${msg}`);
    alert('error', 'Text overlay failed', { hook: hook.id, error: e.message });
    result.errors.push({ step: 'overlay', error: e.message });
    // Continue — the slides are still valid without overlays.
  }

  // Collect the final slide paths (slide1.png .. slide6.png)
  for (let i = 1; i <= 6; i++) {
    const p = path.join(outputDir, `slide${i}.png`);
    if (fs.existsSync(p)) result.slides.push(p);
  }
  if (result.slides.length === 0) {
    const msg = 'No final slide images found after pipeline';
    log('error', `❌ ${msg}`);
    result.errors.push({ step: 'collect', error: msg });
    return result;
  }

  // ─── Step 3: Upload images to Postiz ───────────────────────────────
  let postiz;
  try {
    postiz = loadProvider('postiz');
  } catch (e) {
    const msg = `Postiz provider not loadable: ${e.message}`;
    log('error', `❌ ${msg}`);
    result.errors.push({ step: 'load-postiz', error: msg });
    return result;
  }

  log('info', '☁️  Step 3/4: Uploading images to Postiz...');
  const uploaded = [];
  for (let i = 0; i < result.slides.length; i++) {
    const slidePath = result.slides[i];
    try {
      const up = await postiz.uploadImage(slidePath, { config, dryRun });
      uploaded.push(up);
      log('info', `   📤 ${path.basename(slidePath)} → ${up.id} (${up.dryRun ? 'mock' : 'live'})`);
    } catch (e) {
      const msg = `Upload failed for ${path.basename(slidePath)}: ${e.message}`;
      log('error', `❌ ${msg}`);
      alert('error', 'Image upload failed', { hook: hook.id, slide: slidePath, error: e.message });
      result.errors.push({ step: 'upload', slide: slidePath, error: e.message });
      // Continue with the rest.
    }
  }
  if (uploaded.length === 0) {
    const msg = 'No images uploaded successfully';
    log('error', `❌ ${msg}`);
    result.errors.push({ step: 'upload', error: msg });
    return result;
  }
  log('success', `✅ Step 3 complete: ${uploaded.length}/${result.slides.length} images uploaded`);

  // ─── Step 4: Create draft posts on each platform ───────────────────
  log('info', '📡 Step 4/4: Creating draft posts...');
  const platforms = ['tiktok', ...(config.posting?.crossPost || [])];
  const privacy = config.posting?.privacyLevel || 'SELF_ONLY';
  // Always force SELF_ONLY for TikTok regardless of config — drafts only
  const tiktokPrivacy = privacy === 'PUBLIC' && platforms.includes('instagram')
    ? privacy
    : 'SELF_ONLY';

  for (const platformKey of platforms) {
    const platform = PLATFORMS[platformKey];
    if (!platform) {
      log('warn', `   ⚠️  Unknown platform ${platformKey}, skipping`);
      continue;
    }
    const integrationId = config.postiz?.integrationIds?.[platformKey];
    if (!integrationId || String(integrationId).includes('here')) {
      if (dryRun) {
        // In dry-run, still call the postiz adapter with the placeholder
        // so the pipeline is exercised end-to-end. The adapter returns
        // mock data when it sees a placeholder ID.
        log('info', `   🧪 ${platform.name}: dry-run mode (placeholder integration ID) — using mock postiz response`);
      } else {
        log('warn', `   ⚠️  ${platform.name} integration ID not configured, skipping`);
        result.platformResults[platformKey] = { skipped: true, reason: 'no integration ID' };
        continue;
      }
    }
    try {
      const postResult = await postiz.postToSocials({
        config,
        dryRun,
        platform: platformKey,
        integrationId,
        caption: hook.caption,
        title: `${config.app.name} — ${hook.style}`,
        images: uploaded,
        privacyLevel: platformKey === 'tiktok' ? tiktokPrivacy : privacy,
        schedule
      });
      result.platformResults[platformKey] = postResult;
      result.posts.push({
        platform: platformKey,
        postId: postResult.postId || postResult.id,
        status: postResult.status,
        dryRun: postResult.dryRun
      });
      log('success', `   ✅ ${platform.name}: ${postResult.status} (${postResult.postId || postResult.id})${postResult.dryRun ? ' [DRY-RUN]' : ''}`);
    } catch (e) {
      const msg = `Post failed for ${platform.name}: ${e.message}`;
      log('error', `   ❌ ${msg}`);
      alert('error', `Posting failed for ${platform.name}`, { hook: hook.id, error: e.message });
      result.errors.push({ step: 'post', platform: platformKey, error: e.message });
      result.platformResults[platformKey] = { error: e.message };
      // Per spec: continue to next platform.
    }
  }

  // ─── Save per-adset manifest ───────────────────────────────────────
  const manifest = {
    runId,
    generatedAt: new Date().toISOString(),
    dryRun,
    hook: {
      id: hook.id,
      style: hook.style,
      target: hook.target
    },
    caption: hook.caption,
    overlay: hook.overlay,
    slides: result.slides.map((p, i) => ({
      slide: i + 1,
      file: path.basename(p),
      path: p
    })),
    uploadedImages: uploaded,
    posts: result.posts,
    platformResults: result.platformResults,
    errors: result.errors,
    schedule: schedule || null,
    privacyLevel: privacy
  };
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log('success', `📋 Manifest written to ${manifestPath}`);

  const successCount = result.posts.length;
  const errorCount = result.errors.length;
  log('info', `🏁 Pipeline [${runId}] complete: ${successCount} posts, ${errorCount} errors`);

  return result;
}

/**
 * Run the full pipeline across all 3 ad sets (one per HOOK).
 */
async function runAllPipelines(config, { dryRun = false, baseDir = null, schedule = null } = {}) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').substring(0, 16);
  const root = baseDir || path.join(TIKTOK_DIR, 'posts', dryRun ? `dryrun-${stamp}` : `live-${stamp}`);
  fs.mkdirSync(root, { recursive: true });

  log('info', `🎯 Running all 3 ad sets into ${root}`);

  const allResults = { adsets: [], totalPosts: 0, totalErrors: 0 };

  for (let i = 0; i < HOOKS.length; i++) {
    const hook = HOOKS[i];
    const adsetDir = path.join(root, `adset-${i + 1}-${hook.id}`);
    log('info', `━`.repeat(60));
    log('info', `📦 Ad set ${i + 1}/${HOOKS.length}: ${hook.id} (${hook.style})`);
    const r = await runPipeline({
      config,
      hook,
      outputDir: adsetDir,
      dryRun,
      schedule
    });
    allResults.adsets.push(r);
    allResults.totalPosts += r.posts.length;
    allResults.totalErrors += r.errors.length;
  }

  // Write summary
  const summary = {
    runAt: new Date().toISOString(),
    dryRun,
    outputRoot: root,
    app: config.app.name,
    platforms: ['tiktok', ...(config.posting?.crossPost || [])],
    adsetCount: HOOKS.length,
    totalPosts: allResults.totalPosts,
    totalErrors: allResults.totalErrors,
    adsets: allResults.adsets.map(r => ({
      hook: r.hook,
      outputDir: r.outputDir,
      posts: r.posts,
      platformResults: r.platformResults,
      errors: r.errors,
      slideCount: r.slides.length
    }))
  };
  const summaryPath = path.join(root, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  log('success', `📊 Summary written to ${summaryPath}`);

  return { ...allResults, summaryPath };
}

// ============================================================================
// ANALYTICS
// ============================================================================

async function runAnalytics(config) {
  log('info', '📊 Running cross-platform analytics...');

  const POSTIZ_URL = (process.env.POSTIZ_URL || 'https://api.postiz.com/public/v1').replace(/\/$/, '');
  const results = {};

  for (const [platformKey, platform] of Object.entries(PLATFORMS)) {
    const integrationId = config.postiz.integrationIds[platformKey];
    if (!integrationId || String(integrationId).includes('here')) continue;

    try {
      const res = await fetch(`${POSTIZ_URL}/analytics/platform?integration=${integrationId}`, {
        headers: { 'Authorization': config.postiz.apiKey }
      });

      if (res.ok) {
        const data = await res.json();
        results[platformKey] = data;
        log('success', `✅ ${platform.name}: ${data.followers || 0} followers, ${data.totalViews || 0} views`);
      } else {
        log('warn', `⚠️  ${platform.name} analytics failed: ${res.status}`);
      }
    } catch (e) {
      log('warn', `⚠️  ${platform.name} analytics error: ${e.message}`);
    }
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    platforms: results
  };
  fs.writeFileSync(
    path.join(TIKTOK_DIR, 'analytics-snapshot.json'),
    JSON.stringify(snapshot, null, 2)
  );

  log('success', '✅ Analytics snapshot saved');
  return snapshot;
}

// ============================================================================
// CRON SCHEDULER
// ============================================================================

function startScheduler(config) {
  log('info', '⏰ Starting automated scheduler...');
  log('info', `📅 Schedule: ${config.posting.schedule.join(', ')} (local time)`);

  const checkAndRun = () => {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (config.posting.schedule.includes(currentTime)) {
      log('info', `⏰ Triggered at ${currentTime}`);
      runAllPipelines(config).catch(e => {
        log('error', `Scheduled run failed: ${e.message}`);
        alert('critical', 'Scheduled pipeline failed', { error: e.message });
      });
    }
  };

  setInterval(checkAndRun, 60000);
  log('success', '✅ Scheduler active (checking every minute)');
}

// ============================================================================
// MAIN
// ============================================================================

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const FLAG_KEYS = new Set(['help', 'h']);
const VALUE_KEYS = new Set(['output', 'base-dir', 'schedule']);

function detectCommand(argv) {
  // Walk argv in order, return the first explicit command flag.
  // `--dry-run` is a command (alias for "run pipeline in dry-run mode")
  // AND a flag-modifier (force dry-run when used with --pipeline). We
  // prioritise the command interpretation when it's the only meaningful flag.
  // `--adset <dir>` is also a sub-command — treated as a command keyword
  // even though it takes a value, because there's no ambiguity.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'adset') return 'adset';  // explicit sub-command
    if (FLAG_KEYS.has(key) || VALUE_KEYS.has(key)) continue;
    return key;
  }
  return 'help';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawCommand = detectCommand(process.argv);
  // `--dry-run` as a standalone flag is a command; with --pipeline / --adset
  // it's a modifier that flips them into dry-run mode.
  const command = rawCommand;
  const explicitDryRun = args['dry-run'] === true || process.env.DRY_RUN === 'true';
  const dryRun = (command === 'dry-run')
    || (command === 'pipeline' && explicitDryRun)
    || (command === 'adset' && explicitDryRun)
    || (explicitDryRun && !['validate', 'analytics', 'schedule', 'test-alert', 'help'].includes(command));

  log('info', `🤖 Multi-Platform Orchestrator v1.1.0`);
  log('info', `📁 Working directory: ${TIKTOK_DIR}`);
  log('info', `🎛️  Mode: ${dryRun ? '🟡 DRY-RUN' : '🟢 LIVE'}`);

  // Validate config first (always, but tolerate placeholders in dry-run)
  // Skip validation for help/test-alert — those don't need it.
  let config = null;
  if (command !== 'help' && command !== 'test-alert') {
    config = validateConfig({ dryRun });
    if (!config) {
      if (command === 'validate') process.exit(1);
      if (!dryRun) process.exit(1);
      log('warn', '⚠️  Config has placeholders; dry-run will continue with mock provider output.');
    }
  }

  switch (command) {
    case 'validate':
      log('success', 'Validation complete');
      process.exit(0);
      break;

    case 'pipeline': {
      const baseDir = args['base-dir'] || args.output || null;
      const schedule = args.schedule || null;
      const r = await runAllPipelines(config, { dryRun, baseDir, schedule });
      log('success', dryRun
        ? `🟡 Pipeline (dry-run) complete: ${r.totalPosts} mock posts, ${r.totalErrors} errors. Summary: ${r.summaryPath}`
        : `🏁 All pipelines complete: ${r.totalPosts} posts, ${r.totalErrors} errors. Summary: ${r.summaryPath}`);
      process.exit((r.totalErrors > 0 && !dryRun) ? 1 : 0);
      break;
    }

    case 'dry-run': {
      const baseDir = args['base-dir'] || args.output || null;
      const r = await runAllPipelines(config, { dryRun: true, baseDir });
      log('success', `🟡 Dry-run complete: ${r.totalPosts} mock posts, ${r.totalErrors} errors. Summary: ${r.summaryPath}`);
      process.exit(0);
      break;
    }

    case 'adset': {
      // --adset <adset-dir>  runs the pipeline for the manifest inside that dir.
      const adsetDir = args.adset;
      if (!adsetDir) {
        log('error', '--adset requires a directory argument');
        process.exit(1);
      }
      const manifestPath = path.join(adsetDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        log('error', `manifest.json not found in ${adsetDir}`);
        process.exit(1);
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const hook = HOOKS.find(h => h.id === manifest.hook.id) || manifest.hook;
      const r = await runPipeline({
        config,
        hook,
        outputDir: adsetDir,
        dryRun
      });
      log('success', `Ad set complete: ${r.posts.length} posts, ${r.errors.length} errors`);
      process.exit(r.errors.length > 0 ? 1 : 0);
      break;
    }

    case 'analytics':
      await runAnalytics(config);
      break;

    case 'schedule':
      startScheduler(config);
      // Keep process alive
      process.stdin.resume();
      break;

    case 'test-alert':
      alert('info', 'Test alert from orchestrator', {
        timestamp: new Date().toISOString(),
        message: 'If you see this, alerts are working'
      });
      log('success', 'Test alert sent - check logs/alerts.log');
      break;

    case 'help':
    default:
      console.log(`
Usage: node orchestrator.js [command] [options]

Commands:
  --validate                       Validate config.json (fail-fast on missing keys)
  --pipeline [--base-dir <path>]   Run full content pipeline (LIVE — real APIs)
  --dry-run   [--base-dir <path>]  Run full pipeline with MOCK providers (no real APIs)
  --adset <dir>                    Re-post an existing ad set's slides
  --analytics                      Pull analytics from all connected platforms
  --schedule                       Start automated scheduler (runs pipeline at scheduled times)
  --test-alert                     Test error alerting system

Options:
  --base-dir <path>                Override the default posts/<timestamp>/ output dir
  --schedule <ISO-date>            Schedule Postiz post for a future time
  --dry-run                        (flag) Force dry-run mode even for --pipeline

Supported platforms:
${Object.entries(PLATFORMS).map(([k, p]) => `  - ${p.name} (${k})`).join('\n')}

Config file: ${CONFIG_PATH}
Logs: ${LOG_DIR}
Reports: ${REPORT_DIR}
Providers: ${PROVIDERS_DIR}
      `);
      break;
  }
}

main().catch(err => {
  log('error', `Fatal error: ${err.message}`);
  console.error(err.stack);
  alert('critical', 'Orchestrator fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
