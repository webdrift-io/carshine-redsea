const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function copyIfExists(from, to) {
  const source = path.join(root, from);
  const target = path.join(dist, to || from);
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

copyIfExists('index.html');
copyIfExists('ar');
copyIfExists('de');
copyIfExists('assets');
copyIfExists('favicon.ico');
copyIfExists('favicon.png');
copyIfExists('robots.txt');
copyIfExists('sitemap.xml');
copyIfExists('llms.txt');

copyIfExists('service-agent/public/chatbot-widget.js', 'chatbot-widget.js');
copyIfExists('service-agent/public/dashboard-v2.html', 'dashboard-v2.html');
copyIfExists('service-agent/public/dashboard-v2.html', 'dashboard-v2/index.html');
copyIfExists('service-agent/public/dashboard-v2.js', 'dashboard-v2.js');
copyIfExists('service-agent/public/shadcn-bridge.css', 'shadcn-bridge.css');

console.log('CarShine Hostinger build: wrote static fallback output to dist/.');
console.log('The production Node app still starts from hostinger-app.cjs for API/dashboard runtime.');
