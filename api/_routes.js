/*
 * API routes for the admissions backend.
 *
 * Mounted by server.js for local development. Each handler takes (req, res, url)
 * and returns true if it handled the request, so the same table can be reused by
 * a serverless adapter in milestone 2.
 */
'use strict';
const store = require('./_lib/store');
const auth = require('./_lib/auth');
const { json, parseRequest, send } = require('./_lib/http');

function clientKey(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function requireAdmin(req, res) {
  const cfg = auth.configError();
  if (cfg) { json(res, 500, { error: 'server not configured: ' + cfg }); return false; }
  if (!auth.isAuthed(req)) { json(res, 401, { error: 'not authenticated' }); return false; }
  return true;
}

/* ------------------------------- public ---------------------------------- */

// POST /api/applications — a parent submits the admissions form.
async function createApplication(req, res) {
  const { fields, files } = await parseRequest(req);

  // Minimum viable application: without these the record is not actionable.
  const required = ['fname', 'lname', 'grade', 'faName', 'faMobile'];
  const missing = required.filter(k => !String(fields[k] || '').trim());
  if (missing.length) {
    return json(res, 400, { error: 'missing required fields', fields: missing });
  }

  const row = await store.createApplication({ fields, files });
  // Never echo the stored payload back to the public caller.
  return json(res, 201, { applicationId: row.id, submittedAt: row.submittedAt });
}

/* -------------------------------- admin ---------------------------------- */

async function login(req, res) {
  const cfg = auth.configError();
  if (cfg) return json(res, 500, { error: 'server not configured: ' + cfg });

  const key = clientKey(req);
  const { blocked, retryInMs } = auth.rateLimit(key);
  if (blocked) {
    return json(res, 429, { error: 'too many attempts', retryInSeconds: Math.ceil(retryInMs / 1000) });
  }

  const { fields } = await parseRequest(req);
  if (!auth.checkPassword(fields.password)) {
    return json(res, 401, { error: 'incorrect password' });
  }
  auth.resetLimit(key);
  return json(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(auth.issueToken()) });
}

async function logout(req, res) {
  return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
}

async function session(req, res) {
  return json(res, 200, { authenticated: auth.isAuthed(req), configError: auth.configError() });
}

async function listApplications(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const out = await store.listApplications({
    q: url.searchParams.get('q') || '',
    status: url.searchParams.get('status') || '',
    limit: Math.min(Number(url.searchParams.get('limit')) || 200, 500),
    offset: Number(url.searchParams.get('offset')) || 0,
  });
  return json(res, 200, Object.assign(out, { statuses: store.STATUSES }));
}

async function getApplication(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const row = await store.getApplication(url.searchParams.get('id'));
  if (!row) return json(res, 404, { error: 'not found' });
  return json(res, 200, row);
}

async function updateApplication(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const { fields } = await parseRequest(req);
  try {
    const row = await store.updateApplication(url.searchParams.get('id') || fields.id, fields);
    if (!row) return json(res, 404, { error: 'not found' });
    return json(res, 200, row);
  } catch (e) {
    return json(res, 400, { error: String(e.message || e) });
  }
}

// Permanent deletion of an application and every document attached to it.
async function deleteApplication(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const id = url.searchParams.get('id');
  if (!id) return json(res, 400, { error: 'missing id' });
  const removed = await store.deleteApplication(id);
  if (!removed) return json(res, 404, { error: 'not found' });
  // Deleting a family's application is irreversible — leave an audit line.
  console.log('[admin] deleted application', id, 'submitted', removed.submittedAt);
  return json(res, 200, { ok: true, id: id, deletedFiles: (removed.files || []).length });
}

// Uploaded documents are private: served only to an authenticated admin.
async function downloadFile(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const found = await store.readFile(url.searchParams.get('id'), url.searchParams.get('name'));
  if (!found) return json(res, 404, { error: 'not found' });
  return send(res, 200, found.buffer, {
    'Content-Type': found.meta.contentType,
    // attachment: never render an uploaded file inline in the admin's origin
    'Content-Disposition': 'attachment; filename="' + found.meta.filename.replace(/"/g, '') + '"',
    'X-Content-Type-Options': 'nosniff',
  });
}

const ROUTES = [
  { method: 'POST', path: '/api/applications', handler: createApplication },
  { method: 'GET', path: '/api/applications', handler: listApplications },
  { method: 'GET', path: '/api/application', handler: getApplication },
  { method: 'PATCH', path: '/api/application', handler: updateApplication },
  { method: 'POST', path: '/api/application', handler: updateApplication },
  { method: 'DELETE', path: '/api/application', handler: deleteApplication },
  { method: 'POST', path: '/api/login', handler: login },
  { method: 'POST', path: '/api/logout', handler: logout },
  { method: 'GET', path: '/api/session', handler: session },
  { method: 'GET', path: '/api/file', handler: downloadFile },
];

/**
 * Vercel adapter. Each /api/*.js entry point delegates here with its own path,
 * which avoids relying on rewrites (a rewrite rewrites req.url, so the router
 * would no longer be able to tell which endpoint was requested).
 */
async function handleVercel(req, res, pathname) {
  const incoming = new URL(req.url || pathname, 'http://localhost');
  const url = new URL(pathname + incoming.search, 'http://localhost');
  return handle(req, res, url);
}

async function handle(req, res, url) {
  const route = ROUTES.find(r => r.path === url.pathname && r.method === req.method);
  if (!route) {
    if (url.pathname.startsWith('/api/')) { json(res, 404, { error: 'no such endpoint' }); return true; }
    return false;
  }
  try {
    await route.handler(req, res, url);
  } catch (e) {
    const code = e.statusCode || 500;
    if (code >= 500) console.error('[api]', url.pathname, e);
    json(res, code, { error: code >= 500 ? 'internal error' : String(e.message || e) });
  }
  return true;
}

module.exports = { handle, handleVercel, ROUTES };
