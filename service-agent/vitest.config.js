import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.js', '**/*.test.ts', 'tests/**/*.test.js'],
    exclude: ['node_modules/', 'dist/', 'coverage/', 'public/'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'database.js',
        'gemini-chatbot.js',
        '**/parsers/*.js',
        '**/utils/*.js'
      ],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        'public/',
        '**/*.test.js',
        '**/*.config.js',
        'server.js'  // Integration tests are complex; cover via E2E instead
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    // Some suites rebuild a fresh SQLite DB per test (running the bcrypt
    // cost-12 seed migrations each time), which can exceed 10s under full
    // parallel load. Give hooks/tests generous headroom so the suite is not
    // flaky on slower / loaded machines.
    testTimeout: 30000,
    hookTimeout: 30000
  }
});