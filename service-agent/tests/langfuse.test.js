/**
 * Tests for observability/langfuse.js
 * DRY-RUN mode only. We confirm:
 *   - trace() returns the fn's return value
 *   - on success, it writes a JSONL line with the right shape and tags
 *   - on failure, it rethrows AND still writes a failure record
 *   - durationMs is a non-negative number
 *   - isLiveMode() is false in DRY-RUN
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Ensure DRY-RUN mode (no Langfuse keys)
delete process.env.LANGFUSE_PUBLIC_KEY;
delete process.env.LANGFUSE_SECRET_KEY;

import { trace, isLiveMode, LOG_FILE } from '../observability/langfuse.js';

let tempDir;
let originalLogFile;

beforeEach(() => {
  // The langfuse module writes to a hardcoded JSONL file
  // (service-agent/logs/langfuse-traces.jsonl). We can't change
  // that path without modifying the module, so instead we truncate
  // the file before each test so the per-test count is exact.
  if (fs.existsSync(LOG_FILE)) {
    try { fs.truncateSync(LOG_FILE, 0); } catch (e) { void e; }
  }
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'langfuse-test-'));
  originalLogFile = LOG_FILE;
});

afterEach(() => {
  // Clean up any temp files we wrote near the real log file.
  if (fs.existsSync(LOG_FILE)) {
    try {
      // Truncate back to where we found it (the wrapper appends).
      fs.truncateSync(LOG_FILE, 0);
    } catch (e) {
      void e;
    }
  }
  if (tempDir && fs.existsSync(tempDir)) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { void e; }
  }
});

function readTraces() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const raw = fs.readFileSync(LOG_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => JSON.parse(line));
}

describe('langfuse wrapper — DRY-RUN mode', () => {
  it('returns the fn result and records a success trace with the right tags', async () => {
    isLiveMode(); // sanity: dry-run
    expect(isLiveMode()).toBe(false);

    const result = await trace(
      {
        sessionId: 'sess_abc',
        name: 'IntakeAgent.respond',
        metadata: { chatSessionId: 'sess_abc', language: 'en', finalOutcome: 'replied' },
        input: 'hello'
      },
      async () => 'world'
    );

    expect(result).toBe('world');

    const traces = readTraces();
    expect(traces.length).toBe(1);
    const t = traces[0];
    expect(t.sessionId).toBe('sess_abc');
    expect(t.name).toBe('IntakeAgent.respond');
    expect(t.status).toBe('success');
    expect(t.mode).toBe('dry-run');
    expect(t.inputSize).toBe(5); // length of 'hello'
    expect(t.outputSize).toBe(5); // length of 'world'
    expect(typeof t.durationMs).toBe('number');
    expect(t.durationMs).toBeGreaterThanOrEqual(0);
    expect(t.metadata.chatSessionId).toBe('sess_abc');
    expect(t.metadata.language).toBe('en');
    expect(t.metadata.finalOutcome).toBe('replied');
    expect(t.error).toBeNull();
    expect(t.id).toMatch(/^tr_/);
    expect(t.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records an error trace and rethrows when the fn throws', async () => {
    let thrown = null;
    try {
      await trace(
        {
          sessionId: 'sess_err',
          name: 'BookingAgent.create',
          metadata: { chatSessionId: 'sess_err', language: 'ar', finalOutcome: 'pending' },
          input: { customerName: 'X' }
        },
        async () => {
          throw new Error('slot full');
        }
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeTruthy();
    expect(thrown.message).toBe('slot full');

    const traces = readTraces();
    expect(traces.length).toBe(1);
    const t = traces[0];
    expect(t.status).toBe('error');
    expect(t.error).toBe('slot full');
    expect(t.name).toBe('BookingAgent.create');
    expect(t.sessionId).toBe('sess_err');
    expect(t.metadata.chatSessionId).toBe('sess_err');
    expect(t.metadata.language).toBe('ar');
    // No output captured on error
    expect(t.outputSize).toBe(0);
  });
});
