#!/usr/bin/env node
/**
 * Post a 6-slide slideshow to multiple social networks (TikTok, Facebook Page, Instagram Reels/Feed)
 * via the Postiz API in a single request.
 * 
 * Usage: node post-to-socials.js --config <config.json> --dir <slides-dir> --caption "caption text" [--title "post title"] [--schedule "2026-06-10T12:00:00Z"]
 * 
 * Uploads slide1.png through slide6.png, then creates a post with all connected channels.
 * TikTok is posted as SELF_ONLY (draft) by default so you can add music manually.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const configPath = getArg('config');
const dir = getArg('dir');
const caption = getArg('caption');
const title = getArg('title') || '';
const schedule = getArg('schedule');

if (!configPath || !dir || !caption) {
  console.error('Usage: node post-to-socials.js --config <config.json> --dir <dir> --caption "text" [--title "text"] [--schedule "2026-06-10T12:00:00Z"]');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const BASE_URL = 'https://api.postiz.com/public/v1';

async function uploadImage(filePath) {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], { type: 'image/png' });
  form.append('file', blob, path.basename(filePath));

  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { 'Authorization': config.postiz.apiKey },
    body: form
  });
  return res.json();
}

(async () => {
  console.log('📤 Uploading slides...');
  const images = [];
  for (let i = 1; i <= 6; i++) {
    const filePath = path.join(dir, `slide${i}.png`);
    if (!fs.existsSync(filePath)) {
      console.error(`  ❌ Missing: ${filePath}`);
      process.exit(1);
    }
    console.log(`  Uploading slide ${i}...`);
    const resp = await uploadImage(filePath);
    if (resp.error) {
      console.error(`  ❌ Upload error: ${JSON.stringify(resp.error)}`);
      process.exit(1);
    }
    images.push({ id: resp.id, path: resp.path });
    console.log(`  ✅ Uploaded successfully with ID: ${resp.id}`);
    
    // Rate limit buffer
    if (i < 6) await new Promise(r => setTimeout(r, 1500));
  }

  // Load integration IDs
  let integrationIds = {};
  if (config.postiz.integrationIds) {
    integrationIds = config.postiz.integrationIds;
  } else if (config.postiz.integrationId) {
    integrationIds = { tiktok: config.postiz.integrationId };
  }

  const posts = [];
  const privacy = config.posting?.privacyLevel || 'SELF_ONLY';

  // 1. TikTok Integration
  if (integrationIds.tiktok) {
    console.log(`📱 Configuring TikTok post (ID: ${integrationIds.tiktok})`);
    posts.push({
      integration: { id: integrationIds.tiktok },
      value: [{ content: caption, image: images }],
      settings: {
        __type: 'tiktok',
        title: title,
        privacy_level: privacy,
        duet: false,
        stitch: false,
        comment: true,
        autoAddMusic: 'no',
        brand_content_toggle: false,
        brand_organic_toggle: false,
        video_made_with_ai: true,
        content_posting_method: 'UPLOAD'
      }
    });
  }

  // 2. Facebook Integration
  if (integrationIds.facebook) {
    console.log(`📱 Configuring Facebook post (ID: ${integrationIds.facebook})`);
    posts.push({
      integration: { id: integrationIds.facebook },
      value: [{ content: caption, image: images }],
      settings: {
        __type: 'facebook'
      }
    });
  }

  // 3. Instagram Integration
  if (integrationIds.instagram) {
    console.log(`📱 Configuring Instagram post (ID: ${integrationIds.instagram})`);
    posts.push({
      integration: { id: integrationIds.instagram },
      value: [{ content: caption, image: images }],
      settings: {
        __type: 'instagram'
      }
    });
  }

  if (posts.length === 0) {
    console.error('❌ Error: No integration IDs found in config.json under postiz.integrationIds.');
    process.exit(1);
  }

  // Scheduling calculation
  const type = schedule ? 'schedule' : 'now';
  const date = schedule ? new Date(schedule).toISOString() : new Date().toISOString();

  console.log(`\n📤 Publishing post to Postiz (type: ${type}, date: ${date})...`);
  
  const postRes = await fetch(`${BASE_URL}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': config.postiz.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type,
      date,
      shortLink: false,
      tags: [],
      posts
    })
  });

  const result = await postRes.json();
  console.log('✅ Post request sent!', JSON.stringify(result, null, 2));

  // Save metadata
  const metaPath = path.join(dir, 'meta.json');
  
  // Postiz returns an array of post items matching each integration.
  // Find the TikTok postId specifically if it exists, so other tools that look for a single postId still work.
  let tiktokPostId = null;
  if (Array.isArray(result)) {
    const ttRes = result.find(r => r.integration?.id === integrationIds.tiktok);
    tiktokPostId = ttRes ? ttRes.postId : result[0]?.postId;
  } else if (result && result.postId) {
    tiktokPostId = result.postId;
  }

  const meta = {
    postId: tiktokPostId,
    allPosts: Array.isArray(result) ? result.map(r => ({
      id: r.id,
      postId: r.postId,
      integrationId: r.integration?.id,
      platform: r.integration?.providerIdentifier
    })) : [result],
    caption,
    title,
    privacy,
    postedAt: new Date().toISOString(),
    images: images.length,
    scheduledFor: schedule ? date : null
  };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`📋 Metadata saved to ${metaPath}`);
})();
