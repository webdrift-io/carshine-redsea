#!/usr/bin/env node
/**
 * Pre-flight check before deployment
 * Verifies all required environment variables and dependencies
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

console.log('🚀 CarShine Pre-Deployment Check\n');
const errors = [];
const warnings = [];

// 1. Check .env exists
console.log('1. Checking environment configuration...');
const envPaths = [path.join(ROOT, '.env'), path.join(ROOT, 'service-agent', '.env')];
const envExists = envPaths.some(p => fs.existsSync(p));
if (envExists) {
  console.log('   ✅ .env file exists');
} else {
  errors.push('.env file not found (expected in project root or service-agent/)');
  console.log('   ❌ .env file missing');
}

// 2. Check Node.js version
console.log('\n2. Checking Node.js version...');
const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1).split('.')[0]);
if (major >= 18) {
  console.log(`   ✅ Node.js ${nodeVersion}`);
} else {
  errors.push(`Node.js ${nodeVersion} is too old (need >=18)`);
  console.log(`   ❌ Node.js ${nodeVersion} (need >=18)`);
}

// 3. Check service-agent deps
console.log('\n3. Checking service-agent dependencies...');
const saNodeModules = path.join(ROOT, 'service-agent', 'node_modules');
if (fs.existsSync(saNodeModules)) {
  console.log('   ✅ Dependencies installed');
} else {
  warnings.push('service-agent/node_modules missing - run npm install');
  console.log('   ⚠️  Dependencies not installed');
}

// 4. Check landing-page deps
console.log('\n4. Checking landing-page dependencies...');
const lpNodeModules = path.join(ROOT, 'landing-page', 'node_modules');
if (fs.existsSync(lpNodeModules)) {
  console.log('   ✅ Dependencies installed');
} else {
  warnings.push('landing-page/node_modules missing - run npm install');
  console.log('   ⚠️  Dependencies not installed');
}

// 5. Check build output
console.log('\n5. Checking build output...');
const distEn = path.join(ROOT, 'landing-page', 'dist', 'en', 'index.en.html');
if (fs.existsSync(distEn)) {
  console.log('   ✅ Landing page built');
} else {
  warnings.push('Landing page not built - run node build-landing.cjs');
  console.log('   ⚠️  Landing page not built');
}

// 6. Check tests
console.log('\n6. Running tests...');
try {
  execSync('cd service-agent && npm test', { stdio: 'pipe', cwd: ROOT });
  console.log('   ✅ All tests pass');
} catch (e) {
  errors.push('Tests failed');
  console.log('   ❌ Tests failed - run npm test in service-agent');
}

// 7. Check security
console.log('\n7. Security checks...');
try {
  execSync('cd service-agent && npm audit --audit-level=high', { stdio: 'pipe', cwd: ROOT });
  console.log('   ✅ No high-severity vulnerabilities');
} catch (e) {
  warnings.push('Vulnerabilities found - run npm audit');
  console.log('   ⚠️  Audit issues found');
}

// 8. Check for hardcoded secrets
console.log('\n8. Checking for hardcoded secrets...');
const secretPatterns = [
  /sk-proj-[a-zA-Z0-9]{20,}/,
  /sk_[a-zA-Z0-9]{40,}/,
  /AKIA[0-9A-Z]{16}/,
  /postiz_public_key_[a-zA-Z0-9]+/
];

let secretsFound = false;
function walkDir(dir) {
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      if (!['node_modules', 'dist', 'coverage', '.git'].includes(f)) walkDir(p);
    } else if (/\.(js|ts|json|md)$/.test(f)) {
      const content = fs.readFileSync(p, 'utf8');
      for (const pattern of secretPatterns) {
        if (pattern.test(content) && !content.includes('your_') && !content.includes('YOUR_')) {
          console.log(`   ⚠️  Possible secret in: ${p}`);
          secretsFound = true;
        }
      }
    }
  });
}

walkDir(ROOT);
if (!secretsFound) {
  console.log('   ✅ No hardcoded secrets detected');
} else {
  warnings.push('Possible hardcoded secrets found');
}

// Summary
console.log('\n' + '='.repeat(60));
if (errors.length === 0) {
  console.log('✅ Pre-deployment check PASSED');
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    warnings.forEach(w => console.log(`   - ${w}`));
  }
  console.log('\n🚀 Ready to deploy!');
  process.exit(0);
} else {
  console.log('❌ Pre-deployment check FAILED');
  console.log(`\n${errors.length} error(s):`);
  errors.forEach(e => console.log(`   ❌ ${e}`));
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s):`);
    warnings.forEach(w => console.log(`   ⚠️  ${w}`));
  }
  process.exit(1);
}