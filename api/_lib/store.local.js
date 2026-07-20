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

const STATUSES = ['new', 'reviewing', 'assessment_booked', 'accepted', 'rejected', 'withdrawn'];

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

/** Application ids are shown to parents, so they must be unguessable-ish but short. */
function newApplicationId() {
  const n = crypto.randomInt(1000, 10000);
  return 'MST-' + new Date().getFullYear() + '-' + n;
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
    let id = newApplicationId();
    while (rows.some(r => r.id === id)) id = newApplicationId();

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

module.exports = {
  STATUSES,
  createApplication,
  listApplications,
  getApplication,
  updateApplication,
  deleteApplication,
  readFile,
  _paths: { DATA_DIR, UPLOAD_DIR, INDEX_FILE },
  driver: 'local',
  async close() {},
};
