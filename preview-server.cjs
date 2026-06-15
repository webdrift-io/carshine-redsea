const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const token = process.env.PREVIEW_TOKEN || crypto.randomBytes(16).toString("hex");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
  );
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cookies = parseCookies(req.headers.cookie);
  const authorized = url.searchParams.get("key") === token || cookies.preview_key === token;

  if (!authorized) {
    send(res, 401, "Private preview. Add the access key to the URL.", {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    return;
  }

  if (url.searchParams.get("key") === token) {
    res.setHeader("set-cookie", `preview_key=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  }

  let requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  if (requested.endsWith("/")) {
    requested += "index.html";
  }
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    send(res, 200, data, {
      "content-type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Preview server: http://127.0.0.1:${port}/?key=${token}`);
});
