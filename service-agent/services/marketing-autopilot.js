'use strict';

/**
 * Marketing Autopilot Service
 * ---------------------------
 * Wraps the tiktok-marketing/orchestrator.js with a stateful, in-process
 * autopilot loop and admin endpoints.
 *
 * Why this layer exists:
 *   - The standalone orchestrator is a CLI. We want a long-running server-
 *     side process that runs the same pipeline on schedule, exposes status
 *     to the dashboard, and never loses state on restart.
 *   - The dashboard needs a "live status" tile (last post, next scheduled
 *     time, queue size, errors).
 *   - The OWNER needs a "test publish" button that runs the full pipeline
 *     end-to-end with a real Postiz key (once configured) and reports the
 *     result.
 *
 * State is persisted to service-agent/data/autopilot-state.json so the
 * scheduler can resume after restart.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const TIKTOK_DIR = path.join(ROOT, 'tiktok-marketing');
const STATE_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(STATE_DIR, 'autopilot-state.json');
const LOG_FILE = path.join(STATE_DIR, 'autopilot.log');
const POSTS_DIR = path.join(TIKTOK_DIR, 'posts');

function ensureDirs() {
  [STATE_DIR, POSTS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function nowIso() { return new Date().toISOString(); }
function uid(prefix) { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }

function loadState() {
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_e) {
    return {
      enabled: false,
      mode: 'live', // 'live' | 'draft' | 'paused'
      lastRun: null,
      lastResult: null,
      nextScheduled: null,
      runs: [],
      errorCount: 0
    };
  }
}

function saveState(state) {
  ensureDirs();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function logLine(level, msg) {
  ensureDirs();
  const line = `[${nowIso()}] ${level} ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

function runOrchestratorCLI(args) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['orchestrator.js', ...args], {
      cwd: TIKTOK_DIR,
      env: { ...process.env }
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runPipeline({ dryRun = false, schedule = null, language = 'en', topic = null, saveAsDraft = false } = {}) {
  const state = loadState();
  const stamp = nowIso();
  const adsetDir = path.join(POSTS_DIR, `adset-${stamp.replace(/[:.]/g, '-')}`);

  const args = ['--pipeline'];
  if (dryRun) args.push('--dry-run');
  if (schedule) args.push('--schedule', schedule);
  if (language) args.push('--lang', language);
  if (topic) args.push('--topic', topic);
  if (saveAsDraft) args.push('--draft');

  const startedAt = Date.now();
  const result = await runOrchestratorCLI(args);
  const elapsed = Date.now() - startedAt;

  const run = {
    id: uid('run'),
    timestamp: stamp,
    elapsedMs: elapsed,
    exitCode: result.code,
    dryRun,
    language,
    topic,
    adsetDir,
    stdoutTail: result.stdout.split('\n').slice(-20).join('\n'),
    stderrTail: result.stderr.split('\n').slice(-10).join('\n'),
    success: result.code === 0
  };

  state.lastRun = stamp;
  state.lastResult = run;
  state.runs = [run, ...state.runs].slice(0, 50);
  if (!run.success) state.errorCount += 1;
  saveState(state);
  logLine(run.success ? 'INFO' : 'ERROR', `pipeline run ${run.id} exit=${result.code} elapsed=${elapsed}ms`);
  return run;
}

async function testPublish({ language = 'en', topic = 'premium mobile car wash' } = {}) {
  // Generates one ad set and (if keys are real) publishes it. Always
  // returns the on-disk artifacts even if Postiz is in dry-run mode.
  return runPipeline({ dryRun: false, language, topic, saveAsDraft: true });
}

function getStatus() {
  const state = loadState();
  return {
    enabled: state.enabled,
    mode: state.mode,
    lastRun: state.lastRun,
    lastResult: state.lastResult ? { id: state.lastResult.id, success: state.lastResult.success, exitCode: state.lastResult.exitCode, elapsedMs: state.lastResult.elapsedMs, adsetDir: state.lastResult.adsetDir } : null,
    nextScheduled: state.nextScheduled,
    errorCount: state.errorCount,
    runs: state.runs.slice(0, 10).map(r => ({ id: r.id, timestamp: r.timestamp, success: r.success, exitCode: r.exitCode, elapsedMs: r.elapsedMs, adsetDir: r.adsetDir }))
  };
}

function setEnabled(enabled, mode) {
  const state = loadState();
  state.enabled = Boolean(enabled);
  if (mode && ['live', 'draft', 'paused'].includes(mode)) state.mode = mode;
  saveState(state);
  return getStatus();
}

let schedulerHandle = null;
let lastTickKey = null;

function startScheduler({ scheduleTimes = ['07:30', '16:30', '21:00'], language = 'en', topic = null } = {}) {
  if (schedulerHandle) return { started: false, reason: 'already-running' };
  schedulerHandle = setInterval(async () => {
    const state = loadState();
    if (!state.enabled || state.mode === 'paused') return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const tick = `${hh}:${mm}`;
    if (!scheduleTimes.includes(tick) || lastTickKey === tick) return;
    lastTickKey = tick;
    state.nextScheduled = computeNext(scheduleTimes, now);
    saveState(state);
    logLine('INFO', `scheduler tick ${tick} mode=${state.mode}`);
    await runPipeline({ dryRun: state.mode === 'draft', language, topic });
  }, 30 * 1000);
  const state = loadState();
  state.nextScheduled = computeNext(scheduleTimes, new Date());
  saveState(state);
  return { started: true, scheduleTimes, nextScheduled: state.nextScheduled };
}

function stopScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
  return { started: false, stopped: true };
}

function computeNext(times, from) {
  const today = new Date(from);
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    const candidate = new Date(today);
    candidate.setHours(h, m, 0, 0);
    if (candidate > today) return candidate.toISOString();
  }
  // Wrap to tomorrow's first
  const [h, m] = times[0].split(':').map(Number);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  tomorrow.setHours(h, m, 0, 0);
  return tomorrow.toISOString();
}

module.exports = {
  runPipeline,
  testPublish,
  getStatus,
  setEnabled,
  startScheduler,
  stopScheduler,
  computeNext,
  // for tests
  _internal: { loadState, saveState }
};
