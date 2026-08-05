/*
 * Storage adapter for admissions applications.
 *
 * Two drivers share one interface so the production database can be swapped in
 * without touching any route handler:
 *   - local  : JSON index + files on disk. Zero dependencies, used for dev.
 *   - postgres: added in milestone 2 (same interface).
 *
 * Uploaded documents are deliberately written OUTSIDE the web root. They contain
 * children's birth certificates and parents' national IDs, so they are never
 * statically served — they are only readable through the authenticated
 * /api/file route.
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.MS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const INDEX_FILE = path.join(DATA_DIR, 'applications.json');

const STATUSES = ['new', 'reviewing', 'accepted', 'provisionally_accepted', 'rejected', 'waiting_list'];

function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, '[]', 'utf8');
}

async function readAll() {
  ensureDirs();
  try {
    const raw = await fsp.readFile(INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Serialised writes: concurrent submissions must not clobber the index.
let writeChain = Promise.resolve();
function withWriteLock(fn) {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

async function writeAll(rows) {
  ensureDirs();
  const tmp = INDEX_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await fsp.rename(tmp, INDEX_FILE); // atomic-ish: never leaves a half-written index
}

// Applicant references double as the academic code: "<year>-<seq>", numbered
// sequentially from 1800 (e.g. 2026-1800, 2026-1801). The year is configurable
// so it can be rolled forward each intake without a code change.
const ACADEMIC_YEAR = () => String(process.env.MS_ACADEMIC_YEAR || '2026');
const REF_START = 1800;
function nextReference(rows) {
  let max = REF_START - 1;
  for (const r of rows) {
    const m = /^(?:\d{4})-(\d+)$/.exec(r.id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return ACADEMIC_YEAR() + '-' + (max + 1);
}

// Admin-only workflow fields (never set by the public form): who checks the
// payment, the interview date, the registration date, and follow-up state.
const ADMIN_KEYS = ['paymentResponsible', 'interviewDate', 'registrationDate', 'followupStatus'];
function sanitizeAdmin(obj) {
  const out = {};
  for (const k of ADMIN_KEYS) {
    if (obj && obj[k] !== undefined && obj[k] !== null) out[k] = String(obj[k]).slice(0, 200);
  }
  return out;
}

function safeName(name) {
  return String(name || 'file')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 80);
}

/**
 * @param {object} input
 * @param {object} input.fields   plain form fields
 * @param {Array}  input.files    [{ field, filename, contentType, buffer }]
 */
async function createApplication(input) {
  const fields = input.fields || {};
  const files = input.files || [];
  return withWriteLock(async () => {
    const rows = await readAll();
    let id = nextReference(rows);
    while (rows.some(r => r.id === id)) id = ACADEMIC_YEAR() + '-' + (Number(id.split('-')[1]) + 1);

    const dir = path.join(UPLOAD_DIR, id);
    await fsp.mkdir(dir, { recursive: true });

    const stored = [];
    for (const f of files) {
      if (!f || !f.buffer || !f.buffer.length) continue;
      const fname = safeName(f.field + '-' + (f.filename || 'upload'));
      await fsp.writeFile(path.join(dir, fname), f.buffer);
      stored.push({
        field: f.field,
        filename: f.filename || fname,
        storedAs: fname,
        contentType: f.contentType || 'application/octet-stream',
        bytes: f.buffer.length,
      });
    }

    const row = {
      id,
      submittedAt: new Date().toISOString(),
      status: 'new',
      notes: '',
      admin: {},
      fields,
      files: stored,
    };
    rows.unshift(row);
    await writeAll(rows);
    return row;
  });
}

async function listApplications(opts) {
  const { q = '', status = '', limit = 200, offset = 0 } = opts || {};
  const rows = await readAll();
  const needle = String(q).trim().toLowerCase();
  let out = rows;
  if (status) out = out.filter(r => r.status === status);
  if (needle) {
    out = out.filter(r => {
      const hay = [r.id, r.status, ...Object.values(r.fields || {})]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }
  return {
    total: out.length,
    counts: rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}),
    rows: out.slice(offset, offset + limit),
  };
}

async function getApplication(id) {
  const rows = await readAll();
  return rows.find(r => r.id === id) || null;
}

async function updateApplication(id, patch) {
  return withWriteLock(async () => {
    const rows = await readAll();
    const i = rows.findIndex(r => r.id === id);
    if (i === -1) return null;
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) throw new Error('invalid status: ' + patch.status);
      rows[i].status = patch.status;
    }
    if (patch.notes !== undefined) rows[i].notes = String(patch.notes).slice(0, 4000);
    if (patch.admin !== undefined) {
      rows[i].admin = Object.assign({}, rows[i].admin, sanitizeAdmin(patch.admin));
    }
    rows[i].updatedAt = new Date().toISOString();
    await writeAll(rows);
    return rows[i];
  });
}

/**
 * Permanently removes an application AND its uploaded documents.
 * Deleting the row without the files would leave birth certificates and ID
 * scans orphaned on disk with nothing pointing at them.
 */
async function deleteApplication(id) {
  if (!id) return null;
  return withWriteLock(async () => {
    const rows = await readAll();
    const i = rows.findIndex(r => r.id === id);
    if (i === -1) return null;
    const [removed] = rows.splice(i, 1);
    await writeAll(rows);
    const dir = path.join(UPLOAD_DIR, id);
    const root = path.resolve(UPLOAD_DIR);
    if (path.resolve(dir).startsWith(root + path.sep)) {
      try { await fsp.rm(dir, { recursive: true, force: true }); } catch (e) {}
    }
    return removed;
  });
}

/** Resolves a stored upload, guarding against path traversal via the query string. */
async function readFile(id, storedAs) {
  const row = await getApplication(id);
  if (!row) return null;
  const meta = (row.files || []).find(f => f.storedAs === storedAs);
  if (!meta) return null;
  const full = path.join(UPLOAD_DIR, id, storedAs);
  const root = path.resolve(UPLOAD_DIR);
  if (!path.resolve(full).startsWith(root + path.sep)) return null;
  try {
    return { meta, buffer: await fsp.readFile(full) };
  } catch (e) {
    return null;
  }
}

/*
 * ---------------------------------------------------------------------------
 * Career / job applications (careers.html, <job>.html, apply-<job>.html).
 *
 * A separate index + upload directory from admissions on purpose: the two
 * forms collect different fields (no national IDs here) and are reviewed by
 * different people (HR vs admissions), so mixing them into one table would
 * make both harder to search and easier to leak across teams.
 * ---------------------------------------------------------------------------
 */
const CAREER_UPLOAD_DIR = path.join(DATA_DIR, 'careers-uploads');
const CAREER_INDEX_FILE = path.join(DATA_DIR, 'careers.json');
const CAREER_STATUSES = ['new', 'reviewing', 'shortlisted', 'rejected', 'hired'];
const CAREER_REF_START = 1000;

function ensureCareerDirs() {
  fs.mkdirSync(CAREER_UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(CAREER_INDEX_FILE)) fs.writeFileSync(CAREER_INDEX_FILE, '[]', 'utf8');
}

async function readAllCareers() {
  ensureCareerDirs();
  try {
    const raw = await fsp.readFile(CAREER_INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function writeAllCareers(rows) {
  ensureCareerDirs();
  const tmp = CAREER_INDEX_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await fsp.rename(tmp, CAREER_INDEX_FILE);
}

// "MST-HR-<seq>" starting at 1000 — matches the format the careers pages
// already show while the request is in flight, so the real reference the
// server returns never surprises an applicant with a different shape.
function nextCareerReference(rows) {
  let max = CAREER_REF_START - 1;
  for (const r of rows) {
    const m = /^MST-HR-(\d+)$/.exec(r.id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'MST-HR-' + (max + 1);
}

async function createCareerApplication(input) {
  const fields = input.fields || {};
  const files = input.files || [];
  return withWriteLock(async () => {
    const rows = await readAllCareers();
    let id = nextCareerReference(rows);
    while (rows.some(r => r.id === id)) id = 'MST-HR-' + (Number(id.split('-')[2]) + 1);

    const dir = path.join(CAREER_UPLOAD_DIR, id);
    await fsp.mkdir(dir, { recursive: true });

    const stored = [];
    for (const f of files) {
      if (!f || !f.buffer || !f.buffer.length) continue;
      const fname = safeName(f.field + '-' + (f.filename || 'upload'));
      await fsp.writeFile(path.join(dir, fname), f.buffer);
      stored.push({
        field: f.field,
        filename: f.filename || fname,
        storedAs: fname,
        contentType: f.contentType || 'application/octet-stream',
        bytes: f.buffer.length,
      });
    }

    const row = {
      id,
      submittedAt: new Date().toISOString(),
      status: 'new',
      notes: '',
      fields,
      files: stored,
    };
    rows.unshift(row);
    await writeAllCareers(rows);
    return row;
  });
}

async function listCareerApplications(opts) {
  const { q = '', status = '', limit = 200, offset = 0 } = opts || {};
  const rows = await readAllCareers();
  const needle = String(q).trim().toLowerCase();
  let out = rows;
  if (status) out = out.filter(r => r.status === status);
  if (needle) {
    out = out.filter(r => {
      const hay = [r.id, r.status, ...Object.values(r.fields || {})].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }
  return {
    total: out.length,
    counts: rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}),
    rows: out.slice(offset, offset + limit),
  };
}

async function getCareerApplication(id) {
  const rows = await readAllCareers();
  return rows.find(r => r.id === id) || null;
}

async function updateCareerApplication(id, patch) {
  return withWriteLock(async () => {
    const rows = await readAllCareers();
    const i = rows.findIndex(r => r.id === id);
    if (i === -1) return null;
    if (patch.status !== undefined) {
      if (!CAREER_STATUSES.includes(patch.status)) throw new Error('invalid status: ' + patch.status);
      rows[i].status = patch.status;
    }
    if (patch.notes !== undefined) rows[i].notes = String(patch.notes).slice(0, 4000);
    rows[i].updatedAt = new Date().toISOString();
    await writeAllCareers(rows);
    return rows[i];
  });
}

async function deleteCareerApplication(id) {
  if (!id) return null;
  return withWriteLock(async () => {
    const rows = await readAllCareers();
    const i = rows.findIndex(r => r.id === id);
    if (i === -1) return null;
    const [removed] = rows.splice(i, 1);
    await writeAllCareers(rows);
    const dir = path.join(CAREER_UPLOAD_DIR, id);
    const root = path.resolve(CAREER_UPLOAD_DIR);
    if (path.resolve(dir).startsWith(root + path.sep)) {
      try { await fsp.rm(dir, { recursive: true, force: true }); } catch (e) {}
    }
    return removed;
  });
}

async function readCareerFile(id, storedAs) {
  const row = await getCareerApplication(id);
  if (!row) return null;
  const meta = (row.files || []).find(f => f.storedAs === storedAs);
  if (!meta) return null;
  const full = path.join(CAREER_UPLOAD_DIR, id, storedAs);
  const root = path.resolve(CAREER_UPLOAD_DIR);
  if (!path.resolve(full).startsWith(root + path.sep)) return null;
  try {
    return { meta, buffer: await fsp.readFile(full) };
  } catch (e) {
    return null;
  }
}

module.exports = {
  STATUSES,
  createApplication,
  listApplications,
  getApplication,
  updateApplication,
  deleteApplication,
  readFile,
  CAREER_STATUSES,
  createCareerApplication,
  listCareerApplications,
  getCareerApplication,
  updateCareerApplication,
  deleteCareerApplication,
  readCareerFile,
  _paths: { DATA_DIR, UPLOAD_DIR, INDEX_FILE, CAREER_UPLOAD_DIR, CAREER_INDEX_FILE },
  driver: 'local',
  async close() {},
};
