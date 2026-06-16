'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const E2E_DB = path.join(os.tmpdir(), 'carshine_e2e_test.sqlite');

module.exports = async function globalTeardown() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(E2E_DB + suffix); } catch (_e) { /* best-effort cleanup */ }
  }
};
