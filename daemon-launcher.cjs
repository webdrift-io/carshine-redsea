/**
 * Daemon launcher - starts both servers fully detached
 * The child processes survive parent exit
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const serviceAgentDir = path.join(ROOT, 'service-agent');
const logDir = ROOT;

// Clean up old processes
function killPort(port) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, { encoding: 'utf8' });
    const pids = [...new Set(out.split('\n').map(line => {
      const m = line.trim().match(/LISTENING\s+(\d+)/);
      return m ? m[1] : null;
    }).filter(Boolean))];
    for (const pid of pids) {
      try {
        execSync(`wmic process where "ProcessId=${pid}" delete`, { stdio: 'ignore' });
        console.log(`Killed process ${pid} on port ${port}`);
      } catch (e) {}
    }
  } catch (e) {
    // No process to kill
  }
}

console.log('CarShine Red Sea - Daemon Launcher\n');
console.log('Cleaning up old processes...');
killPort(5000);
killPort(4173);

setTimeout(() => {
  console.log('\nStarting Service Agent on port 5000...');
  const agent = spawn('node', ['server.js'], {
    cwd: serviceAgentDir,
    detached: true,
    stdio: ['ignore', fs.openSync(path.join(logDir, 'service-agent.log'), 'a'), fs.openSync(path.join(logDir, 'service-agent.log'), 'a')],
    windowsHide: true
  });
  agent.unref();
  fs.writeFileSync(path.join(logDir, 'service-agent.pid'), String(agent.pid));
  console.log('  Service Agent PID:', agent.pid);

  console.log('\nStarting Landing Page on port 4173...');
  const landing = spawn('node', ['serve-landing.cjs'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', fs.openSync(path.join(logDir, 'landing.log'), 'a'), fs.openSync(path.join(logDir, 'landing.log'), 'a')],
    windowsHide: true
  });
  landing.unref();
  fs.writeFileSync(path.join(logDir, 'landing.pid'), String(landing.pid));
  console.log('  Landing Page PID:', landing.pid);

  setTimeout(() => {
    console.log('\n==========================================');
    console.log('  Both Servers Started');
    console.log('==========================================');
    console.log('\n  Service Agent:  http://localhost:5000');
    console.log('  Admin Login:    http://localhost:5000/login');
    console.log('  API Docs:       http://localhost:5000/api-docs/');
    console.log('  Chatbot Demo:   http://localhost:5000/chatbot-demo.html');
    console.log('  Health Check:   http://localhost:5000/health');
    console.log('\n  Landing Page:   http://localhost:4173/');
    console.log('  Arabic:         http://localhost:4173/ar/');
    console.log('  German:         http://localhost:4173/de/');
    console.log('\n  Login: admin@carshineredsea.com / ChangeMe123!');
    console.log('\n  PIDs saved to service-agent.pid and landing.pid');
    console.log('  Logs: service-agent.log and landing.log');
    console.log('\n  To stop: node stop-all.cjs');
    process.exit(0);
  }, 3000);
}, 1000);
