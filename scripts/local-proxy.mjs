// Production-like local server: serves the static site from apps/web/out and proxies /api to the API.
// Same layout as production (one origin), so cookies behave the same. Usage: npm run serve
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../apps/web/out", import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const API = new URL(process.env.API_URL ?? "http://127.0.0.1:4000");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".ico": "image/x-icon" };

function file(p) {
  try {
    return statSync(p).isDirectory() ? file(path.join(p, "index.html")) : p;
  } catch {
    return null;
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) {
      const headers = { ...req.headers, "x-forwarded-for": req.socket.remoteAddress };
      const p = http.request({ hostname: API.hostname, port: API.port, path: req.url, method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      p.on("error", () => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end('{"error":"api_unavailable"}');
      });
      return req.pipe(p);
    }
    const f = file(path.join(root, path.normalize(decodeURIComponent(url.pathname))));
    if (!f || !f.startsWith(root)) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      return createReadStream(path.join(root, "404.html")).pipe(res);
    }
    res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    createReadStream(f).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}  (static site + /api -> ${API.origin})`));
