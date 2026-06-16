'use strict';

const { defineConfig } = require('@playwright/test');
const os = require('os');
const path = require('path');

const E2E_PORT = 15099;
const E2E_DB = path.join(os.tmpdir(), 'carshine_e2e_test.sqlite');
const E2E_JWT_SECRET = 'e2e-only-test-secret-do-not-use-in-production';

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'line',

  projects: [
    {
      // API-only project: no browser binary required.
      name: 'api',
    },
  ],

  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },

  webServer: {
    command: 'node server.js',
    port: E2E_PORT,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 30_000,
    env: {
      NODE_ENV: 'development',
      PORT: String(E2E_PORT),
      DATABASE_PATH: E2E_DB,
      JWT_SECRET: E2E_JWT_SECRET,
      // Prevent Mastra/LLM calls from failing silently during E2E
      USE_MASTRA_AGENT: 'false',
    },
  },

  globalTeardown: './e2e/teardown.js',
});
