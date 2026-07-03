/**
 * Static file server for the authored landing page
 * Serves the root index.html files on port 4173
 * Multilingual: / (English), /ar/, /de/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.LANDING_PORT || 4173;
const HOST = process.env.LANDING_HOST || '127.0.0.1';
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:5000';
const TOKEN = process.env.PREVIEW_TOKEN || 'preview-ok';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.br': 'font/woff2',  // Browser will use .br
  '.gz': 'text/html; charset=utf-8'  // Compressed HTML
};

function shouldCompress(req, contentType) {
  if (!contentType) return false;
  return /text|javascript|json|svg/.test(contentType);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function compressedIsFresh(sourceFile, compressedFile) {
  try {
    return fs.statSync(compressedFile).mtimeMs >= fs.statSync(sourceFile).mtimeMs;
  } catch {
    return false;
  }
}

function proxyToBackend(req, res) {
  const target = new URL(req.url, API_TARGET);
  const proxyReq = http.request(target, {
    method: req.method,
    headers: { ...req.headers, host: target.host }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    send(res, 502, 'Backend unavailable', { 'content-type': 'text/plain' });
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
    return proxyToBackend(req, res);
  }
  
  // Multilingual routing: /ar/ -> ar/index.html, /de/ -> de/index.html, / -> index.html
  let requestedFile;
  if (pathname === '/chatbot-widget.js') {
    requestedFile = path.join(ROOT, 'service-agent', 'public', 'chatbot-widget.js');
  } else if (pathname === '/ar' || pathname === '/ar/' || pathname.startsWith('/ar/')) {
    const sub = pathname.replace(/^\/ar\/?/, '');
    requestedFile = sub ? path.join(ROOT, 'ar', sub) : path.join(ROOT, 'ar', 'index.html');
  } else if (pathname === '/de' || pathname === '/de/' || pathname.startsWith('/de/')) {
    const sub = pathname.replace(/^\/de\/?/, '');
    requestedFile = sub ? path.join(ROOT, 'de', sub) : path.join(ROOT, 'de', 'index.html');
  } else if (pathname === '/' || pathname === '') {
    requestedFile = path.join(ROOT, 'index.html');
  } else {
    requestedFile = path.join(ROOT, pathname.replace(/^\/+/, ''));
  }
  
  // Security: prevent path traversal
  if (!requestedFile.startsWith(ROOT)) {
    return send(res, 403, 'Forbidden', { 'content-type': 'text/plain' });
  }
  
  // Check if browser supports compression
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const ext = path.extname(requestedFile).toLowerCase();
  
  // Try .br first, then .gz, then raw
  let actualFile = requestedFile;
  let contentEncoding = null;
  
  if (acceptEncoding.includes('br') && compressedIsFresh(requestedFile, requestedFile + '.br')) {
    actualFile = requestedFile + '.br';
    contentEncoding = 'br';
  } else if (acceptEncoding.includes('gzip') && compressedIsFresh(requestedFile, requestedFile + '.gz')) {
    actualFile = requestedFile + '.gz';
    contentEncoding = 'gzip';
  }
  
  fs.readFile(actualFile, (err, data) => {
    if (err) {
      // Try index.html fallback for directories
      const dirIndex = requestedFile.endsWith('/') 
        ? path.join(requestedFile, 'index.html')
        : requestedFile + '.html';
      fs.readFile(dirIndex, (err2, data2) => {
        if (err2) {
          return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
        }
        send(res, 200, data2, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=3600'
        });
      });
      return;
    }
    
    const contentType = mime[ext] || 'application/octet-stream';
    const headers = {
      'content-type': contentType,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff'
    };
    
    if (contentEncoding) {
      headers['content-encoding'] = contentEncoding;
      headers['vary'] = 'Accept-Encoding';
    }
    
    send(res, 200, data, headers);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🌐 Landing page server: http://localhost:${PORT}/`);
  console.log(`   English:  http://localhost:${PORT}/`);
  console.log(`   Arabic:   http://localhost:${PORT}/ar/`);
  console.log(`   German:   http://localhost:${PORT}/de/`);
  console.log(`   Chatbot widget demo: http://localhost:5000/chatbot-demo.html`);
  console.log(`   API docs: http://localhost:5000/api-docs/`);
  console.log(`   Admin dashboard: http://localhost:5000/`);
});
