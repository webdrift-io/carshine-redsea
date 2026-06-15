/**
 * Build orchestrator for landing-page
 * Handles build for all languages, gzip/brotli pre-compression, SRI generation
 * Outputs a manifest with file sizes and hashes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'landing-page', 'dist');
const LANGUAGES = ['en', 'ar', 'de'];

// Gzip compression
function gzipFile(inputPath) {
  const content = fs.readFileSync(inputPath);
  const zlib = require('zlib');
  const compressed = zlib.gzipSync(content, { level: 9 });
  fs.writeFileSync(inputPath + '.gz', compressed);
  return {
    original: content.length,
    compressed: compressed.length,
    ratio: ((1 - compressed.length / content.length) * 100).toFixed(1)
  };
}

// Brotli compression
function brotliFile(inputPath) {
  const content = fs.readFileSync(inputPath);
  const zlib = require('zlib');
  const compressed = zlib.brotliCompressSync(content, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.length
    }
  });
  fs.writeFileSync(inputPath + '.br', compressed);
  return {
    original: content.length,
    compressed: compressed.length,
    ratio: ((1 - compressed.length / content.length) * 100).toFixed(1)
  };
}

// Generate SRI hash
function generateSriHash(filePath) {
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha384').update(content).digest('base64');
  return `sha384-${hash}`;
}

// Walk directory recursively
function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isFile = fs.statSync(dirPath).isFile();
    isFile ? callback(dirPath) : walkDir(dirPath, callback);
  });
}

// Format bytes
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// Build all language bundles
console.log('🚀 Building landing pages for all languages...\n');
const startTime = Date.now();

for (const lang of LANGUAGES) {
  console.log(`  📦 Building ${lang.toUpperCase()}...`);
  try {
    execSync(`cd "${path.join(ROOT, 'landing-page')}" && npm run build:${lang}`, {
      stdio: 'pipe',
      cwd: path.join(ROOT, 'landing-page')
    });
    console.log(`     ✅ ${lang} build complete`);
  } catch (error) {
    console.error(`     ❌ ${lang} build failed:`, error.message);
    process.exit(1);
  }
}

const buildTime = Date.now() - startTime;
console.log(`\n⏱️  Build time: ${(buildTime / 1000).toFixed(2)}s\n`);

// Process output: compress files, generate SRI, create manifest
console.log('🗜️  Compressing assets...\n');

const manifest = {
  buildTime: new Date().toISOString(),
  buildDurationMs: buildTime,
  languages: {}
};

for (const lang of LANGUAGES) {
  const langDir = path.join(DIST, lang);
  if (!fs.existsSync(langDir)) continue;
  
  const langManifest = {
    files: [],
    totalOriginal: 0,
    totalGzipped: 0,
    totalBrotli: 0
  };
  
  walkDir(langDir, (filePath) => {
    const ext = path.extname(filePath);
    if (['.gz', '.br'].includes(ext)) return;
    
    const relPath = path.relative(langDir, filePath);
    const originalSize = fs.statSync(filePath).size;
    
    // Only compress HTML, CSS, JS, SVG, JSON
    if (['.html', '.css', '.js', '.svg', '.json'].includes(ext)) {
      const gzipResult = gzipFile(filePath);
      const brotliResult = brotliFile(filePath);
      
      const sriHash = generateSriHash(filePath);
      
      langManifest.files.push({
        path: relPath,
        original: formatBytes(originalSize),
        originalBytes: originalSize,
        gzipped: formatBytes(gzipResult.compressed),
        gzippedBytes: gzipResult.compressed,
        brotli: formatBytes(brotliResult.compressed),
        brotliBytes: brotliResult.compressed,
        gzipRatio: gzipResult.ratio + '%',
        brotliRatio: brotliResult.ratio + '%',
        sri: sriHash
      });
      
      langManifest.totalOriginal += originalSize;
      langManifest.totalGzipped += gzipResult.compressed;
      langManifest.totalBrotli += brotliResult.compressed;
    } else {
      langManifest.files.push({
        path: relPath,
        original: formatBytes(originalSize),
        originalBytes: originalSize
      });
      langManifest.totalOriginal += originalSize;
    }
  });
  
  langManifest.totalOriginal = formatBytes(langManifest.totalOriginal);
  langManifest.totalGzipped = formatBytes(langManifest.totalGzipped);
  langManifest.totalBrotli = formatBytes(langManifest.totalBrotli);
  
  manifest.languages[lang] = langManifest;
  
  console.log(`  ${lang.toUpperCase()}:`);
  console.log(`     Files: ${langManifest.files.length}`);
  console.log(`     Original: ${langManifest.totalOriginal}`);
  console.log(`     Gzip:     ${langManifest.totalGzipped}`);
  console.log(`     Brotli:   ${langManifest.totalBrotli}`);
  console.log();
}

// Write manifest
const manifestPath = path.join(DIST, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`📋 Manifest written: ${path.relative(ROOT, manifestPath)}\n`);

// Write SRI map
const sriMap = {};
for (const lang of LANGUAGES) {
  if (manifest.languages[lang]) {
    sriMap[lang] = {};
    for (const f of manifest.languages[lang].files) {
      if (f.sri) {
        sriMap[lang][f.path] = f.sri;
      }
    }
  }
}
const sriPath = path.join(DIST, 'sri.json');
fs.writeFileSync(sriPath, JSON.stringify(sriMap, null, 2));
console.log(`🔐 SRI map written: ${path.relative(ROOT, sriPath)}\n`);

console.log('✨ Build complete!\n');
console.log('📁 Output structure:');
for (const lang of LANGUAGES) {
  const dir = path.join(DIST, lang);
  if (fs.existsSync(dir)) {
    const htmlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
    console.log(`   dist/${lang}/`);
    console.log(`     HTML: ${htmlFiles.join(', ')}`);
    console.log(`     Assets: ${fs.readdirSync(path.join(dir, 'assets')).length} files (with .gz + .br variants)`);
  }
}