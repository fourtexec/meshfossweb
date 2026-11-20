#!/usr/bin/env node
// MESHFOSS Web: локальный сервер без зависимостей (Node 18+).
//
//   node proxy/server.mjs            → http://127.0.0.1:8787
//   PORT=9000 HOST=0.0.0.0 node proxy/server.mjs
//
// Отдаёт веб-приложение и проксирует /mesh/* на school.mos.ru с того же адреса —
// CORS не нужен, токен не покидает ваш компьютер (кроме запроса в МЭШ).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './worker.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PREFIX = '/mesh';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

async function serveStatic(pathname, res) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (rel.split(sep).some((part) => part.startsWith('.') && part !== '.')) return notFound(res);
  if (/^(proxy|tests|tools|node_modules)([/\\]|$)/.test(rel)) return notFound(res);
  let file = join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT)) return notFound(res);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ...SECURITY });
    res.end(data);
  } catch {
    notFound(res);
  }
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
  res.end('not found');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/proxy.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY });
    res.end(JSON.stringify({ base: PREFIX }));
    return;
  }
  if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      // Свой Origin убираем (тот же адрес), чужой оставляем — worker.js его отклонит.
      if (typeof v !== 'string') continue;
      if (k === 'origin' && v === `http://${req.headers.host}`) continue;
      headers.set(k, v);
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request, { PREFIX });
    const out = { ...SECURITY };
    response.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  await serveStatic(url.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`MESHFOSS Web: http://${HOST}:${PORT}  (прокси: ${PREFIX}/* → https://school.mos.ru)`);
});
