#!/usr/bin/env node
/**
 * Post-build script: adds SRI (Subresource Integrity) hashes to CDN scripts.
 * Runs after `vite build` to inject sha384 integrity + crossorigin attributes
 * for any external script tags.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

/**
 * Fetch a URL and return its bytes.
 * For offline builds, this may fail - in that case, SRI is skipped for that asset.
 */
async function fetchAndHash(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return 'sha384-' + createHash('sha384').update(buffer).digest('base64');
  } catch (e) {
    console.warn(`  ⚠ Could not fetch ${url}: ${e.message}`);
    return null;
  }
}

/**
 * Find external script URLs in an HTML file and add SRI hashes.
 */
async function addSRItoHTML(htmlPath) {
  let html = readFileSync(htmlPath, 'utf8');
  const scriptRegex = /<script\s+([^>]*?)src=["'](https?:\/\/[^"']+)["']([^>]*?)>/g;
  const matches = [...html.matchAll(scriptRegex)];

  if (matches.length === 0) {
    return 0;
  }

  console.log(`\n${htmlPath.replace(distDir, 'dist')}: ${matches.length} external scripts found`);

  for (const match of matches) {
    const [full, before, url, after] = match;
    // Skip if already has integrity
    if (full.includes('integrity=')) continue;

    const hash = await fetchAndHash(url);
    if (!hash) continue;

    // Add integrity + crossorigin attributes
    let newTag;
    if (full.includes('async')) {
      newTag = `<script async src="${url}" integrity="${hash}" crossorigin="anonymous"${after}>`;
    } else if (full.includes('defer')) {
      newTag = `<script defer src="${url}" integrity="${hash}" crossorigin="anonymous"${after}>`;
    } else {
      newTag = `<script src="${url}" integrity="${hash}" crossorigin="anonymous"${after}>`;
    }
    html = html.replace(full, newTag);
    console.log(`  ✓ Added SRI for ${url.substring(0, 60)}...`);
  }

  writeFileSync(htmlPath, html, 'utf8');
  return matches.length;
}

/**
 * Recursively find all HTML files in dist/.
 */
function findHTMLFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findHTMLFiles(fullPath));
    } else if (entry.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  console.log('\n=== Adding SRI hashes to CDN scripts ===\n');

  let htmlFiles;
  try {
    htmlFiles = findHTMLFiles(distDir);
  } catch (e) {
    console.error(`dist/ not found at ${distDir}. Run "npm run build" first.`);
    process.exit(1);
  }

  if (htmlFiles.length === 0) {
    console.error('No HTML files found in dist/.');
    process.exit(1);
  }

  let totalAdded = 0;
  for (const file of htmlFiles) {
    totalAdded += await addSRItoHTML(file);
  }

  console.log(`\n✓ SRI hashes added to ${totalAdded} scripts across ${htmlFiles.length} HTML files\n`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
