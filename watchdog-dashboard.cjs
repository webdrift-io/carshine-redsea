#!/usr/bin/env node
// Restart-on-crash watchdog for the dashboard backend.
// The Hermes terminal wrapper sometimes reports a Node server as
// "exited" when it's actually still running (Windows + PTY quirk).
// This script does a real HTTP health check every 5s and only
// relaunches the server if it really can't be reached.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const SERVICE_DIR = path.join(__dirname, 'service-agent');
const HEALTH_URL = 'http://localhost:5000/health';
const INTERVAL_MS = 5000;
const MAX_FAILS = 3;        // 3 consecutive failures = 15s of downtime before restart
const STARTUP_GRACE_MS = 4000;

let fails = 0;
let child = null;
let starting = false;

function startServer() {
  if (child || starting) return;
  starting = true;
  console.log('[watchdog] starting dashboard...');
  child = spawn('node', ['server.js'], {
    cwd: SERVICE_DIR,
    env: { ...process.env, PORT: '5000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => process.stdout.write(`[dash] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[dash] ${d}`));
  child.on('exit', (code, signal) => {
    console.log(`[watchdog] dashboard exited code=${code} signal=${signal}`);
    child = null;
    starting = false;
    if (code !== 0 && code !== null) {
      // Real crash — restart after 1s
      setTimeout(startServer, 1000);
    }
  });
  // After startup grace, mark starting=false
  setTimeout(() => { starting = false; }, STARTUP_GRACE_MS);
}

function healthCheck() {
  const req = http.get(HEALTH_URL, { timeout: 2000 }, res => {
    if (res.statusCode === 200) {
      if (fails > 0) console.log(`[watchdog] dashboard healthy (was ${fails} fails)`);
      fails = 0;
    } else {
      fails++;
      console.log(`[watchdog] health check HTTP ${res.statusCode} (fails=${fails}/${MAX_FAILS})`);
      if (fails >= MAX_FAILS && !child && !starting) {
        console.log('[watchdog] dashboard unreachable, restarting...');
        startServer();
      }
    }
    res.resume();
  });
  req.on('error', err => {
    fails++;
    console.log(`[watchdog] health check error: ${err.message} (fails=${fails}/${MAX_FAILS})`);
    if (fails >= MAX_FAILS && !child && !starting) {
      console.log('[watchdog] dashboard unreachable, restarting...');
      startServer();
    }
  });
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
}

startServer();
setInterval(healthCheck, INTERVAL_MS);
console.log('[watchdog] running, checking health every 5s');
process.on('SIGINT', () => { if (child) child.kill(); process.exit(0); });
process.on('SIGTERM', () => { if (child) child.kill(); process.exit(0); });
