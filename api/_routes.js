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
const email = require('./_lib/email');
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
  const required = ['sname', 'arname', 'grade', 'faName', 'faMobile', 'stNid', 'faNid', 'moNid'];
  const missing = required.filter(k => !String(fields[k] || '').trim());
  if (missing.length) {
    return json(res, 400, { error: 'missing required fields', fields: missing });
  }

  const row = await store.createApplication({ fields, files });

  // Fire-and-forget: notifyNewApplication() catches its own errors, so a
  // Resend/network hiccup never delays or breaks the parent's confirmation.
  email.notifyNewApplication(row, fields);

  // Never echo the stored payload back to the public caller.
  return json(res, 201, { applicationId: row.id, submittedAt: row.submittedAt });
}

/* ---------------------------- careers (public) ---------------------------- */

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

// Careers attachment policy (spec 15–20): validate real file signatures, not
// just the filename — renaming monkey.jpg → resume.pdf must not pass.
const FILE_SIGS = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],                        // "%PDF-"
  doc: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],      // OLE2/Compound File
  docx: [0x50, 0x4b, 0x03, 0x04],                             // ZIP (OOXML)
  jpg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
};
const CV_KINDS = { pdf: 1, doc: 1, docx: 1 };
const CERT_KINDS = { pdf: 1, jpg: 1, png: 1 };
function fileKindOf(buf) {
  for (const k in FILE_SIGS) {
    const sig = FILE_SIGS[k];
    let ok = buf && buf.length >= sig.length;
    for (let i = 0; ok && i < sig.length; i++) ok = buf[i] === sig[i];
    if (ok) return k;
  }
  return '';
}

// POST /api/careers — a candidate applies for a job from careers.html,
// <job>.html, apply-<job>.html, or the embedded Careers section of index.html.
// All of those pages post the same field names (name, phone, email_2,
// position, years, edu) plus required cv/cert (and optional portfolio) file
// parts. Validation mirrors the client-side rules on the careers pages.
async function createCareerApplication(req, res) {
  const { fields, files } = await parseRequest(req);

  const name = String(fields.name || '').trim();
  const phone = String(fields.phone || '').trim();
  const email_ = String(fields.email_2 || fields.email || '').trim();
  const years = String(fields.years || '').trim();
  const edu = String(fields.edu || '').trim();
  const hasFile = (n) => !!files.find((f) => f.field === n && f.buffer.length > 0);
  const typeOk = (n, kinds) => {
    const f = files.find((x) => x.field === n && x.buffer.length > 0);
    return !!f && !!kinds[fileKindOf(f.buffer)];
  };

  const missing = [];
  if (!name) missing.push('name');
  if (!phone) missing.push('phone');
  else if (!/^01[0125]\d{8}$/.test(phone)) missing.push('phone');
  if (!email_) missing.push('email');
  else if (!EMAIL_RE.test(email_)) missing.push('email');
  if (years && !(/^\d{1,2}$/.test(years) && Number(years) <= 50)) missing.push('years');
  if (!edu) missing.push('edu');
  if (!hasFile('cv') || !typeOk('cv', CV_KINDS)) missing.push('cv');
  if (!hasFile('cert') || !typeOk('cert', CERT_KINDS)) missing.push('cert');
  if (missing.length) {
    return json(res, 400, { error: 'missing or invalid required fields', fields: missing });
  }

  const row = await store.createCareerApplication({
    fields: {
      name, phone, email_2: email_,
      position: String(fields.position || '').trim(),
      years, edu,
    },
    files,
  });

  // Fire-and-forget, same rationale as notifyNewApplication above.
  email.notifyNewCareerApplication(row, row.fields);

  return json(res, 201, { careerId: row.id, submittedAt: row.submittedAt });
}

/* ---------------------------- contact (public) ----------------------------- */

// Contact messages are not stored — the email IS the delivery — so a light
// in-memory rate limit is the only thing standing between this endpoint and
// a spam script. That is an acceptable trade-off for a low-traffic school
// contact form and mirrors the limit the previous SendGrid-based endpoint used.
const contactAttempts = new Map();
const CONTACT_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_MAX = 5;
function contactRateLimited(key) {
  const now = Date.now();
  const recent = (contactAttempts.get(key) || []).filter(t => now - t < CONTACT_WINDOW_MS);
  const blocked = recent.length >= CONTACT_MAX;
  if (!blocked) contactAttempts.set(key, recent.concat(now));
  if (contactAttempts.size > 5000) contactAttempts.clear(); // crude bound
  return blocked;
}

// POST /api/contact — the Contact page's message form (index.html).
async function submitContact(req, res) {
  const key = clientKey(req);
  if (contactRateLimited(key)) {
    return json(res, 429, { error: 'too many messages; try again later' });
  }

  const { fields } = await parseRequest(req);
  const name = String(fields.name || '').trim().slice(0, 120);
  const email_ = String(fields.email || '').trim().slice(0, 254);
  const phone = String(fields.phone || '').trim().slice(0, 30);
  const message = String(fields.message || '').trim().slice(0, 5000);

  if (!name) return json(res, 400, { error: 'name is required' });
  if (!email_ || !EMAIL_RE.test(email_)) return json(res, 400, { error: 'a valid email is required' });
  if (!message || message.length < 10) return json(res, 400, { error: 'message is too short' });

  const sent = await email.notifyContactMessage({ name, email: email_, phone, message });
  if (!sent) {
    // Nothing was stored, so a failed send means the message is genuinely
    // lost — tell the visitor rather than showing a false "sent" screen.
    return json(res, 502, { error: 'could not deliver message — please try WhatsApp or phone instead' });
  }
  return json(res, 200, { ok: true });
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

// Human-readable name per upload field, so a download is "Birth-Certificate.pdf"
// rather than the raw "d2-scan.pdf" the parent happened to name it.
const FIELD_NAMES = {
  photo: 'Personal-Photo',
  d1: 'Guardian-National-ID',
  d2: 'Student-Birth-Certificate',
  d3: 'Last-Stage-Certificate',
  d4: 'Additional-Document',
};
function documentName(meta) {
  const base = FIELD_NAMES[meta.field] || 'Document';
  const ext = (/\.([A-Za-z0-9]+)$/.exec(meta.filename || '') || [, ''])[1];
  return ext ? base + '.' + ext.toLowerCase() : base;
}
// Serving an uploaded HTML/SVG inline in the admin origin would be an XSS vector,
// so inline is allowed only for PDFs and images; everything else is forced to
// download regardless of the requested mode.
function inlineSafe(contentType) {
  return contentType === 'application/pdf' || /^image\//.test(contentType || '');
}

// Uploaded documents are private: served only to an authenticated admin.
async function downloadFile(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const found = await store.readFile(url.searchParams.get('id'), url.searchParams.get('name'));
  if (!found) return json(res, 404, { error: 'not found' });
  const wantsInline = url.searchParams.get('mode') === 'inline' && inlineSafe(found.meta.contentType);
  const disposition = wantsInline ? 'inline' : 'attachment';
  return send(res, 200, found.buffer, {
    'Content-Type': found.meta.contentType,
    'Content-Disposition': disposition + '; filename="' + documentName(found.meta).replace(/"/g, '') + '"',
    'X-Content-Type-Options': 'nosniff',
  });
}

/* ---------------------------- careers (admin) ------------------------------ */

async function listCareerApplications(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const out = await store.listCareerApplications({
    q: url.searchParams.get('q') || '',
    status: url.searchParams.get('status') || '',
    limit: Math.min(Number(url.searchParams.get('limit')) || 200, 500),
    offset: Number(url.searchParams.get('offset')) || 0,
  });
  return json(res, 200, Object.assign(out, { statuses: store.CAREER_STATUSES }));
}

async function getCareerApplication(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const row = await store.getCareerApplication(url.searchParams.get('id'));
  if (!row) return json(res, 404, { error: 'not found' });
  return json(res, 200, row);
}

async function updateCareerApplication(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const { fields } = await parseRequest(req);
  try {
    const row = await store.updateCareerApplication(url.searchParams.get('id') || fields.id, fields);
    if (!row) return json(res, 404, { error: 'not found' });
    return json(res, 200, row);
  } catch (e) {
    return json(res, 400, { error: String(e.message || e) });
  }
}

async function deleteCareerApplication(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const id = url.searchParams.get('id');
  if (!id) return json(res, 400, { error: 'missing id' });
  const removed = await store.deleteCareerApplication(id);
  if (!removed) return json(res, 404, { error: 'not found' });
  console.log('[admin] deleted career application', id, 'submitted', removed.submittedAt);
  return json(res, 200, { ok: true, id: id, deletedFiles: (removed.files || []).length });
}

// Human-readable names for career-application uploads, same rationale as
// FIELD_NAMES above.
const CAREER_FIELD_NAMES = { cv: 'CV', cert: 'Certificates', portfolio: 'Portfolio' };
function careerDocumentName(meta) {
  const base = CAREER_FIELD_NAMES[meta.field] || 'Document';
  const ext = (/\.([A-Za-z0-9]+)$/.exec(meta.filename || '') || [, ''])[1];
  return ext ? base + '.' + ext.toLowerCase() : base;
}

async function downloadCareerFile(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const found = await store.readCareerFile(url.searchParams.get('id'), url.searchParams.get('name'));
  if (!found) return json(res, 404, { error: 'not found' });
  const wantsInline = url.searchParams.get('mode') === 'inline' && inlineSafe(found.meta.contentType);
  const disposition = wantsInline ? 'inline' : 'attachment';
  return send(res, 200, found.buffer, {
    'Content-Type': found.meta.contentType,
    'Content-Disposition': disposition + '; filename="' + careerDocumentName(found.meta).replace(/"/g, '') + '"',
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
  { method: 'POST', path: '/api/careers', handler: createCareerApplication },
  { method: 'GET', path: '/api/careers', handler: listCareerApplications },
  { method: 'GET', path: '/api/career', handler: getCareerApplication },
  { method: 'PATCH', path: '/api/career', handler: updateCareerApplication },
  { method: 'POST', path: '/api/career', handler: updateCareerApplication },
  { method: 'DELETE', path: '/api/career', handler: deleteCareerApplication },
  { method: 'GET', path: '/api/careerfile', handler: downloadCareerFile },
  { method: 'POST', path: '/api/contact', handler: submitContact },
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
