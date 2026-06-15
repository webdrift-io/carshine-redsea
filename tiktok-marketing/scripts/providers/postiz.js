#!/usr/bin/env node
/**
 * Postiz Provider
 * ---------------
 * Thin adapter for the Postiz REST API. Used by the orchestrator to
 * upload images and create draft posts on TikTok / Instagram / Facebook.
 *
 * Base URL:  https://api.postiz.com/public/v1   (verified against
 *            https://docs.postiz.com/public-api/introduction on 2026-06-13)
 *
 * Exposes two functions:
 *   - uploadImage(filePath)         → { id, path, url }
 *   - postToSocials({ imageUrl, caption, platform, privacyLevel, ... })
 *
 * Behaviour
 *   - If `dryRun: true` is passed, or the API key is a placeholder, the
 *     adapter returns realistic-looking mock data WITHOUT calling Postiz.
 *   - This lets the rest of the pipeline be tested end-to-end without
 *     real credentials (see `node orchestrator.js --dry-run`).
 *
 * Env overrides
 *   - POSTIZ_API_KEY     →  preferred over config.json
 *   - POSTIZ_BASE_URL    →  override the base URL
 *
 * Provider-specific settings (__type) follow Postiz docs:
 *   https://docs.postiz.com/public-api/providers/x
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Verified from https://docs.postiz.com/public-api/introduction (2026-06-13)
const DEFAULT_BASE_URL = 'https://api.postiz.com/public/v1';

const PLATFORM_DEFAULTS = {
  tiktok: {
    __type: 'tiktok',
    duet: false,
    stitch: false,
    comment: true,
    autoAddMusic: 'no',
    brand_content_toggle: false,
    brand_organic_toggle: false,
    content_posting_method: 'UPLOAD'
  },
  instagram: {
    __type: 'instagram',
    post_type: 'post'
  },
  facebook: {
    __type: 'facebook'
  },
  youtube: {
    __type: 'youtube',
    type: 'short'
  },
  threads: {
    __type: 'threads'
  },
  x: {
    __type: 'x',
    who_can_reply_post: 'everyone'
  },
  linkedin: {
    __type: 'linkedin',
    post_as_images_carousel: true
  }
};

function isPlaceholderKey(key) {
  if (!key) return true;
  const normalized = String(key).trim();
  if (normalized === '') return true;
  if (normalized.includes('...')) return true;
  if (normalized.toLowerCase().includes('placeholder')) return true;
  if (normalized.toLowerCase().includes('here')) return true;
  return false;
}

function integrationIsPlaceholder(id) {
  if (!id) return true;
  const normalized = String(id).trim();
  if (normalized === '') return true;
  if (normalized.includes('...')) return true;
  if (normalized.toLowerCase().includes('here')) return true;
  if (normalized.toLowerCase().includes('placeholder')) return true;
  return false;
}

/**
 * Upload a single image to Postiz.
 * POST /public/v1/upload  (multipart form-data, field name = "file")
 * Returns { id, path, url }.
 *
 * @param {string} filePath
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {boolean} [opts.dryRun]
 * @param {object} [opts.config]  Full config.json
 * @returns {Promise<{id: string, path: string, url: string, dryRun?: boolean}>}
 */
async function uploadImage(filePath, opts = {}) {
  if (!filePath) throw new Error('uploadImage: filePath is required');
  if (!fs.existsSync(filePath)) throw new Error(`uploadImage: file not found at ${filePath}`);

  const cfg = opts.config || {};
  const postizCfg = cfg.postiz || {};
  const apiKey = opts.apiKey
    || process.env.POSTIZ_API_KEY
    || postizCfg.apiKey;
  const baseUrl = (opts.baseUrl
    || process.env.POSTIZ_BASE_URL
    || postizCfg.baseUrl
    || DEFAULT_BASE_URL).replace(/\/$/, '');

  const forceDry = opts.dryRun === true
    || isPlaceholderKey(apiKey);

  // Deterministic mock ID so the rest of the pipeline can correlate.
  const mockId = 'mock_' + crypto
    .createHash('sha1')
    .update(filePath + (apiKey || ''))
    .digest('hex')
    .slice(0, 24);

  if (forceDry) {
    return {
      id: mockId,
      path: `file://${path.resolve(filePath)}`,
      url: `https://uploads.postiz.com/dryrun/${mockId}`,
      dryRun: true
    };
  }

  // Real upload
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], { type: 'image/png' });
  form.append('file', blob, path.basename(filePath));

  const res = await fetch(`${baseUrl}/upload`, {
    method: 'POST',
    headers: { 'Authorization': apiKey },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Postiz upload failed: ${res.status} ${res.statusText} — ${errText}`);
  }

  const data = await res.json();
  return {
    id: data.id || mockId,
    path: data.path,
    url: data.path || data.url,
    dryRun: false
  };
}

/**
 * Build the per-platform post payload that Postiz expects inside
 * the `posts` array of the /public/v1/posts body.
 *
 * @param {object} args
 * @param {string} args.platform             tiktok | instagram | facebook | ...
 * @param {string} args.integrationId        Postiz integration/channel ID
 * @param {string} args.caption
 * @param {Array<{id,path,url}>} args.images Upload results from uploadImage()
 * @param {string} [args.title]              Required for tiktok/youtube
 * @param {string} [args.privacyLevel]       PUBLIC | FRIENDS | SELF_ONLY
 * @param {object} [args.extraSettings]      Platform-specific overrides
 * @param {string|string[]} [args.tags]      Tags (Postiz accepts array of strings)
 * @returns {object}
 */
function buildPostPayload({
  platform,
  integrationId,
  caption,
  images = [],
  title,
  privacyLevel,
  extraSettings = {},
  tags
}) {
  if (!integrationId) {
    throw new Error(`buildPostPayload: integrationId is required for ${platform}`);
  }
  if (!images || images.length === 0) {
    throw new Error(`buildPostPayload: at least one image is required for ${platform}`);
  }

  const settings = { ...(PLATFORM_DEFAULTS[platform] || { __type: platform }), ...extraSettings };

  // TikTok-specific: privacyLevel + title
  if (platform === 'tiktok') {
    settings.privacy_level = privacyLevel || 'SELF_ONLY';
    if (title) settings.title = title;
  }
  if (platform === 'youtube' && title) {
    settings.title = title;
  }

  const value = [{
    content: caption,
    image: images.map(img => ({ id: img.id, path: img.path || img.url }))
  }];

  return {
    integration: { id: integrationId },
    value,
    settings
  };
}

/**
 * Create a draft (or scheduled, or immediate) post on Postiz.
 * https://docs.postiz.com/public-api/introduction#quick-examples
 *
 * @param {object} args
 * @param {string} args.imageUrl           Convenience: single-image URL
 * @param {string} args.caption            Caption text
 * @param {string} [args.platform='tiktok'] Platform key — picks the integration
 * @param {string} [args.privacyLevel]     TikTok: SELF_ONLY recommended for drafts
 * @param {string} [args.title]            TikTok / YouTube title
 * @param {Array}  [args.images]           All uploaded images (overrides imageUrl)
 * @param {string} [args.integrationId]    Override config's integration ID
 * @param {string} [args.schedule]         ISO date — omit to publish immediately
 * @param {string|string[]} [args.tags]
 * @param {string} [args.apiKey]           Override config API key
 * @param {string} [args.baseUrl]          Override config base URL
 * @param {boolean} [args.dryRun]
 * @param {object} [args.config]           Full config.json
 * @returns {Promise<{id?: string, postId?: string, platform: string, status: string, dryRun?: boolean, mockId?: string}>}
 */
async function postToSocials({
  imageUrl,
  caption,
  platform = 'tiktok',
  privacyLevel,
  title,
  images,
  integrationId,
  schedule,
  tags,
  apiKey,
  baseUrl,
  dryRun = false,
  config
} = {}) {
  if (!caption) throw new Error('postToSocials: caption is required');
  if (!config && !platform) {
    throw new Error('postToSocials: platform is required when no config is passed');
  }

  const cfg = config || {};
  const postizCfg = cfg.postiz || {};
  const resolvedKey = apiKey
    || process.env.POSTIZ_API_KEY
    || postizCfg.apiKey;
  const resolvedBase = (baseUrl
    || process.env.POSTIZ_BASE_URL
    || postizCfg.baseUrl
    || DEFAULT_BASE_URL).replace(/\/$/, '');

  // Resolve integration ID
  const integrations = postizCfg.integrationIds || {};
  let resolvedIntegration = integrationId
    || integrations[platform];

  // Dry-run if explicitly requested, key is a placeholder, or integration
  // is a placeholder. Calculate this first so we can use it for the
  // missing-integration fallback below.
  let forceDry = dryRun === true
    || isPlaceholderKey(resolvedKey)
    || integrationIsPlaceholder(resolvedIntegration);

  if (!resolvedIntegration) {
    if (forceDry) {
      // In dry-run, accept a missing integration ID — we'll use a mock.
      resolvedIntegration = `dryrun_${platform}_mock`;
    } else {
      throw new Error(`postToSocials: no Postiz integrationId configured for platform "${platform}" (config.postiz.integrationIds.${platform})`);
    }
  }

  // Resolve image list
  let imageList = images;
  if (!imageList || imageList.length === 0) {
    if (imageUrl) {
      // Convenience: wrap a single URL into the array shape
      imageList = [{ id: 'inline_' + crypto.createHash('sha1').update(imageUrl).digest('hex').slice(0, 16), path: imageUrl, url: imageUrl }];
    } else {
      throw new Error('postToSocials: at least one image is required (pass `images` or `imageUrl`)');
    }
  }

  // Privacy default
  const effectivePrivacy = privacyLevel
    || cfg.posting?.privacyLevel
    || 'SELF_ONLY';

  const postEntry = buildPostPayload({
    platform,
    integrationId: resolvedIntegration,
    caption,
    images: imageList,
    title,
    privacyLevel: effectivePrivacy
  });

  const body = {
    type: schedule ? 'schedule' : 'now',
    date: schedule ? new Date(schedule).toISOString() : new Date().toISOString(),
    shortLink: false,
    tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
    posts: [postEntry]
  };

  if (forceDry) {
    const mockId = 'mock_post_' + crypto
      .createHash('sha1')
      .update(JSON.stringify(body) + platform + resolvedIntegration)
      .digest('hex')
      .slice(0, 24);
    return {
      id: mockId,
      postId: mockId,
      platform,
      status: schedule ? 'scheduled-draft' : 'draft',
      dryRun: true,
      privacyLevel: effectivePrivacy,
      mockId,
      request: body
    };
  }

  // Real call
  const res = await fetch(`${resolvedBase}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': resolvedKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Postiz post failed: ${res.status} ${res.statusText} — ${errText}`);
  }

  const result = await res.json();

  // Normalise the result. Postiz returns an array of post items.
  let postId = null;
  if (Array.isArray(result)) {
    const matching = result.find(r => r.integration?.id === resolvedIntegration);
    postId = matching ? (matching.postId || matching.id) : (result[0]?.postId || result[0]?.id);
  } else if (result?.postId) {
    postId = result.postId;
  } else if (result?.id) {
    postId = result.id;
  }

  return {
    id: postId,
    postId,
    platform,
    status: schedule ? 'scheduled' : 'posted',
    dryRun: false,
    raw: result
  };
}

module.exports = {
  uploadImage,
  postToSocials,
  buildPostPayload,
  isPlaceholderKey,
  integrationIsPlaceholder,
  PLATFORM_DEFAULTS,
  DEFAULT_BASE_URL
};

// ─── CLI shim ─────────────────────────────────────────────────────────
//   node postiz.js upload --file <path> [--config config.json] [--dry-run]
//   node postiz.js post --caption "..." --image-url https://... --platform tiktok [--config config.json] [--dry-run]
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const arg = (k) => {
    const i = args.indexOf(`--${k}`);
    return i !== -1 ? args[i + 1] : null;
  };
  const cfgPath = arg('config');
  const cfg = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
  const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';

  (async () => {
    try {
      if (cmd === 'upload') {
        const fp = arg('file');
        if (!fp) throw new Error('--file is required for upload');
        const r = await uploadImage(fp, { config: cfg, dryRun });
        console.log(JSON.stringify(r, null, 2));
      } else if (cmd === 'post') {
        const caption = arg('caption');
        const platform = arg('platform') || 'tiktok';
        const imageUrl = arg('image-url');
        const title = arg('title');
        const privacy = arg('privacy') || 'SELF_ONLY';
        if (!caption) throw new Error('--caption is required for post');
        const r = await postToSocials({
          caption, platform, imageUrl, title,
          privacyLevel: privacy,
          config: cfg, dryRun
        });
        console.log(JSON.stringify(r, null, 2));
      } else {
        console.error('Usage:');
        console.error('  node postiz.js upload --file <path> [--config config.json] [--dry-run]');
        console.error('  node postiz.js post --caption "..." [--image-url <url>] --platform tiktok [--config config.json] [--dry-run]');
        process.exit(1);
      }
    } catch (e) {
      console.error('postiz failed:', e.message);
      process.exit(1);
    }
  })();
}
