#!/usr/bin/env node
/**
 * Deployment script
 * Builds, packages, and deploys the application
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DEPLOY_DIR = path.join(ROOT, 'deploy');
const DEPLOY_TAR = path.join(ROOT, `deploy-${Date.now()}.tar.gz`);

function log(msg) {
  console.log(`[Deploy] ${msg}`);
}

function cleanup() {
  if (fs.existsSync(DEPLOY_DIR)) {
    fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
  }
}

function copyFiles(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(f => {
      if (f === 'node_modules' || f === '.env' || f.startsWith('.')) return;
      copyFiles(path.join(src, f), path.join(dest, f));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function build() {
  // The canonical landing pages are the self-contained, hand-authored files at
  // the repo root (index.html, ar/index.html, de/index.html). They ship raw —
  // inline CSS, CDN JS — so there is no build transformation that can re-break
  // them. `npm run build` (root vite) remains available for optional optimized
  // output but is intentionally NOT on the deploy critical path.
  log('Running tests...');
  execSync('cd service-agent && npm test', { cwd: ROOT, stdio: 'inherit' });
}

function package_() {
  log('Creating deployment package...');
  
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  
  // Copy service-agent (production only)
  log('Copying service-agent...');
  const saDir = path.join(DEPLOY_DIR, 'service-agent');
  fs.mkdirSync(saDir, { recursive: true });
  const saFiles = [
    'package.json', 'package-lock.json', 'server.js', 'database.js', 'minimax-agent.js',
    'gemini-chatbot.js', 'parsers.js', 'logger.js', 'openapi.yaml', 'website-knowledge.js', 'chatbot.js'
  ];
  const saDirs = [
    'routes', 'public', 'agents', 'services', 'migrations', 'middleware',
    'memory', 'observability', 'jobs', 'data'
  ];
  for (const f of saFiles) {
    const src = path.join(ROOT, 'service-agent', f);
    if (fs.existsSync(src)) copyFiles(src, path.join(saDir, f));
  }
  for (const d of saDirs) {
    const src = path.join(ROOT, 'service-agent', d);
    if (fs.existsSync(src)) copyFiles(src, path.join(saDir, d));
  }
  
  // Copy public (chatbot widget)
  log('Copying chatbot widget...');
  copyFiles(path.join(ROOT, 'service-agent', 'public'), path.join(saDir, 'public'));
  
  // Copy canonical landing page (raw, self-contained root files).
  // These are the verified-working pages served at /, /ar/, /de/.
  log('Copying canonical landing page (root index.html + ar/ + de/)...');
  const landingDest = path.join(DEPLOY_DIR, 'public-landing');
  fs.mkdirSync(landingDest, { recursive: true });
  copyFiles(path.join(ROOT, 'index.html'), path.join(landingDest, 'index.html'));
  copyFiles(path.join(ROOT, 'ar'), path.join(landingDest, 'ar'));
  copyFiles(path.join(ROOT, 'de'), path.join(landingDest, 'de'));
  for (const f of ['favicon.png', 'favicon.ico']) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) copyFiles(src, path.join(landingDest, f));
  }
  
  // Copy TikTok marketing
  log('Copying TikTok marketing...');
  copyFiles(path.join(ROOT, 'tiktok-marketing'), path.join(DEPLOY_DIR, 'tiktok-marketing'));
  
  // Generate deployment .env template
  log('Generating .env template...');
  if (fs.existsSync(path.join(ROOT, '.env.example'))) {
    fs.copyFileSync(
      path.join(ROOT, '.env.example'),
      path.join(DEPLOY_DIR, '.env.example')
    );
  }
  
  // Generate deployment README
  log('Generating deployment README...');
  const readme = `# CarShine Red Sea Production Deployment

## Server-side
1. Copy this directory to the server
2. cd service-agent && npm install --production
3. Copy .env.example to .env and fill in production values:
   - JWT_SECRET (generate new: \`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"\`)
   - MiniMax_API_KEY or GEMINI_API_KEY
   - WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN (for WhatsApp)
   - POSTIZ_API_KEY and integration IDs (for TikTok/IG/FB)
4. Start: \`cd service-agent && node server.js\`
5. For production: use pm2 or systemd:
   \`\`\`bash
   pm2 start service-agent/server.js --name carshine-agent
   pm2 save
   pm2 startup
   \`\`\`

## Landing page
- public-landing/ contains the built static files
- Serve via nginx/Cloudflare Pages/Vercel/Netlify
- Configure the API URL in chatbot-widget.js (set apiUrl to your service-agent domain)

## Health checks
- GET /health - Full health status
- GET /health/ready - Readiness probe (for K8s)
- GET /health/live - Liveness probe (for K8s)
- GET /api-docs/ - Interactive API documentation (Swagger UI)
`;
  fs.writeFileSync(path.join(DEPLOY_DIR, 'README.md'), readme);
  
  // Create tarball
  log('Creating tarball...');
  if (process.platform !== 'win32') {
    execSync(`tar -czf "${DEPLOY_TAR}" -C "${DEPLOY_DIR}" .`, { stdio: 'inherit' });
  } else {
    // Windows fallback - use 7zip or PowerShell
    log('Windows detected - use manual upload');
  }
  
  const hash = crypto.createHash('sha256').update(
    fs.readFileSync(DEPLOY_TAR)
  ).digest('hex');
  
  log(`✅ Deployment package created: ${DEPLOY_TAR}`);
  log(`   SHA-256: ${hash}`);
}

function main() {
  const args = process.argv.slice(2);
  const skipTests = args.includes('--skip-tests');
  
  try {
    if (!skipTests) {
      build();
    } else {
      log('Skipping tests (--skip-tests flag)');
    }
    package_();
    log('🚀 Deployment ready!');
  } catch (e) {
    log(`❌ Deployment failed: ${e.message}`);
    process.exit(1);
  }
}

main();
