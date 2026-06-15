/**
 * Stop both CarShine services
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;

function killByPidFile(pidFile, name) {
  const fp = path.join(ROOT, pidFile);
  if (!fs.existsSync(fp)) {
    console.log(`No PID file: ${pidFile}`);
    return;
  }
  const pid = parseInt(fs.readFileSync(fp, 'utf8').trim());
  if (!pid) {
    console.log(`Invalid PID in ${pidFile}`);
    return;
  }
  try {
    execSync(`wmic process where "ProcessId=${pid}" delete`, { stdio: 'ignore' });
    console.log(`Stopped ${name} (PID ${pid})`);
  } catch (e) {
    console.log(`Process ${pid} not running`);
  }
  try { fs.unlinkSync(fp); } catch (e) {}
}

function killByPort(port, name) {
  try {
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, { encoding: 'utf8' });
    const pids = [...new Set(out.split('\n').map(line => {
      const m = line.trim().match(/LISTENING\s+(\d+)/);
      return m ? m[1] : null;
    }).filter(Boolean))];
    for (const pid of pids) {
      try {
        execSync(`wmic process where "ProcessId=${pid}" delete`, { stdio: 'ignore' });
        console.log(`Stopped ${name} on port ${port} (PID ${pid})`);
      } catch (e) {}
    }
  } catch (e) {
    console.log(`Nothing running on port ${port}`);
  }
}

console.log('Stopping CarShine services...');
killByPidFile('service-agent.pid', 'Service Agent');
killByPidFile('landing.pid', 'Landing Page');
killByPort(5000, 'Service Agent');
killByPort(4173, 'Landing Page');
console.log('Done.');