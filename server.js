/*
 * Local development server: serves the static site AND the admissions API.
 *
 *   node server.js            → http://localhost:8123
 *   PORT=3000 node server.js
 *
 * Replaces `python -m http.server`, which can only serve static files and so
 * cannot exercise the admin dashboard.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const api = require('./api/_routes');

const PORT = Number(process.env.PORT || 8123);
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// Applicant documents live in ./data and must never be reachable as static files.
const BLOCKED = [path.resolve(ROOT, 'data')];

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(ROOT, '.' + rel);

  if (!full.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  if (BLOCKED.some(b => full === b || full.startsWith(b + path.sep))) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) { res.writeHead(302, { Location: rel + '/' }).end(); return; }
    const body = await fsp.readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found: ' + rel);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (await api.handle(req, res, url)) return;
    await serveStatic(req, res, url);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  }
});

server.listen(PORT, () => {
  console.log('  Masters School — dev server');
  console.log('  site      http://localhost:' + PORT + '/');
  console.log('  admin     http://localhost:' + PORT + '/admin.html');
  if (!process.env.MS_ADMIN_PASSWORD) console.log('  password  masters-dev  (dev default — set MS_ADMIN_PASSWORD to change)');
  console.log('');
});

module.exports = server;
