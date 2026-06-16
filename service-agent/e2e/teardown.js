'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Prefer the unique per-run path set by playwright.config.js; fall back to the
// legacy fixed name for safety.
const E2E_DB = process.env.E2E_DB_PATH || path.join(os.tmpdir(), 'carshine_e2e_test.sqlite');

module.exports = async function globalTeardown() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(E2E_DB + suffix); } catch (_e) { /* best-effort; OS reclaims temp files */ }
  }
};
