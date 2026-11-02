#!/usr/bin/env node
/**
 * 本地静态服务器（只为开发/自测：ES module 需要 http 协议，file:// 会被 CORS 挡）
 * 运行：node tools/serve.mjs   → http://<本机IP>:8787/ （主页是 CLI 说明，网页版在 /src/app/）
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html'; // 根目录放的是跳转页（GitHub Pages 也能直接用）

  const filePath = path.resolve(ROOT, '.' + pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + pathname);
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(302, { location: pathname.replace(/\/?$/, '/') + 'index.html' }).end();
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'content-length': stat.size,
  });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`serving ${ROOT} on http://0.0.0.0:${PORT}/  (主页 index.html，网页版 /src/app/index.html)`);
});
