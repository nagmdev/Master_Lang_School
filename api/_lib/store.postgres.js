/*
 * Postgres storage driver — the production backend.
 *
 * Implements exactly the same interface as store.local.js, so routes and the
 * admin UI are unchanged. Required on Vercel: serverless filesystems are
 * ephemeral, so anything written to disk is lost on the next deploy or cold
 * start. Applications must live in a database.
 *
 * Document bytes are stored as bytea in a side table rather than in the
 * application row, so listing applications never drags megabytes of scanned
 * PDFs through memory.
 */
'use strict';
const crypto = require('crypto');
const { Pool } = require('pg');

const STATUSES = ['new', 'reviewing', 'assessment_booked', 'accepted', 'rejected', 'withdrawn'];

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.MS_DATABASE_URL;

// Hosted Postgres (Vercel/Neon/Supabase) requires TLS; a local dev cluster does not.
function sslOption(cs) {
  if (/sslmode=disable/.test(cs || '')) return false;
  if (/localhost|127\.0\.0\.1/.test(cs || '')) return false;
  return { rejectUnauthorized: false };
}

let pool = null;
function getPool() {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: sslOption(connectionString),
      // Serverless invocations are short-lived and numerous; a small pool with a
      // quick idle timeout avoids exhausting the database's connection limit.
      max: Number(process.env.MS_PG_POOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', err => console.error('[pg] idle client error', err.message));
  }
  return pool;
}

let readyPromise = null;
function migrate() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const sql = `
        CREATE TABLE IF NOT EXISTS applications (
          id            TEXT PRIMARY KEY,
          submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ,
          status        TEXT NOT NULL DEFAULT 'new',
          notes         TEXT NOT NULL DEFAULT '',
          fields        JSONB NOT NULL DEFAULT '{}'::jsonb,
          search        TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS application_files (
          id            BIGSERIAL PRIMARY KEY,
          application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          field         TEXT NOT NULL,
          filename      TEXT NOT NULL,
          stored_as     TEXT NOT NULL,
          content_type  TEXT NOT NULL,
          bytes         INTEGER NOT NULL,
          data          BYTEA NOT NULL
        );
        CREATE INDEX IF NOT EXISTS applications_submitted_idx ON applications (submitted_at DESC);
        CREATE INDEX IF NOT EXISTS applications_status_idx    ON applications (status);
        CREATE INDEX IF NOT EXISTS application_files_app_idx  ON application_files (application_id);
      `;
      await getPool().query(sql);
    })().catch(err => { readyPromise = null; throw err; });
  }
  return readyPromise;
}

function newApplicationId() {
  return 'MST-' + new Date().getFullYear() + '-' + crypto.randomInt(1000, 10000);
}
function safeName(name) {
  return String(name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 80);
}
function searchBlob(id, fields) {
  return [id, ...Object.values(fields || {})].join(' ').toLowerCase().slice(0, 8000);
}

function rowToApplication(r, files) {
  return {
    id: r.id,
    submittedAt: new Date(r.submitted_at).toISOString(),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
    status: r.status,
    notes: r.notes || '',
    fields: r.fields || {},
    files: files || [],
  };
}

async function createApplication(input) {
  await migrate();
  const fields = input.fields || {};
  const files = (input.files || []).filter(f => f && f.buffer && f.buffer.length);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    let id = newApplicationId();
    // Retry on the (unlikely) id collision rather than failing the parent's submission.
    for (let i = 0; i < 5; i++) {
      const hit = await client.query('SELECT 1 FROM applications WHERE id = $1', [id]);
      if (!hit.rowCount) break;
      id = newApplicationId();
    }
    await client.query(
      'INSERT INTO applications (id, status, notes, fields, search) VALUES ($1, $2, $3, $4::jsonb, $5)',
      [id, 'new', '', JSON.stringify(fields), searchBlob(id, fields)]
    );
    const stored = [];
    for (const f of files) {
      const storedAs = safeName(f.field + '-' + (f.filename || 'upload'));
      await client.query(
        `INSERT INTO application_files (application_id, field, filename, stored_as, content_type, bytes, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, f.field, f.filename || storedAs, storedAs,
         f.contentType || 'application/octet-stream', f.buffer.length, f.buffer]
      );
      stored.push({
        field: f.field, filename: f.filename || storedAs, storedAs,
        contentType: f.contentType || 'application/octet-stream', bytes: f.buffer.length,
      });
    }
    await client.query('COMMIT');
    const r = await client.query('SELECT * FROM applications WHERE id = $1', [id]);
    return rowToApplication(r.rows[0], stored);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function listApplications(opts) {
  await migrate();
  const { q = '', status = '', limit = 200, offset = 0 } = opts || {};
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (String(q).trim()) { params.push('%' + String(q).trim().toLowerCase() + '%'); where.push(`search LIKE $${params.length}`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const pool = getPool();
  const [countRes, countsRes, rowsRes] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM applications ${clause}`, params),
    pool.query('SELECT status, count(*)::int AS n FROM applications GROUP BY status'),
    pool.query(
      `SELECT id, submitted_at, updated_at, status, notes, fields
         FROM applications ${clause}
        ORDER BY submitted_at DESC
        LIMIT ${Math.min(Number(limit) || 200, 500)} OFFSET ${Math.max(Number(offset) || 0, 0)}`,
      params
    ),
  ]);

  const ids = rowsRes.rows.map(r => r.id);
  let byApp = {};
  if (ids.length) {
    const fr = await pool.query(
      `SELECT application_id, field, filename, stored_as, content_type, bytes
         FROM application_files WHERE application_id = ANY($1)`, [ids]
    );
    byApp = fr.rows.reduce((a, f) => {
      (a[f.application_id] = a[f.application_id] || []).push({
        field: f.field, filename: f.filename, storedAs: f.stored_as,
        contentType: f.content_type, bytes: f.bytes,
      });
      return a;
    }, {});
  }
  return {
    total: countRes.rows[0].n,
    counts: countsRes.rows.reduce((a, r) => (a[r.status] = r.n, a), {}),
    rows: rowsRes.rows.map(r => rowToApplication(r, byApp[r.id] || [])),
  };
}

async function getApplication(id) {
  await migrate();
  if (!id) return null;
  const pool = getPool();
  const r = await pool.query('SELECT * FROM applications WHERE id = $1', [id]);
  if (!r.rowCount) return null;
  const f = await pool.query(
    `SELECT field, filename, stored_as, content_type, bytes
       FROM application_files WHERE application_id = $1`, [id]
  );
  return rowToApplication(r.rows[0], f.rows.map(x => ({
    field: x.field, filename: x.filename, storedAs: x.stored_as,
    contentType: x.content_type, bytes: x.bytes,
  })));
}

async function updateApplication(id, patch) {
  await migrate();
  if (!id) return null;
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    throw new Error('invalid status: ' + patch.status);
  }
  const sets = ['updated_at = now()'];
  const params = [];
  if (patch.status !== undefined) { params.push(patch.status); sets.push(`status = $${params.length}`); }
  if (patch.notes !== undefined) { params.push(String(patch.notes).slice(0, 4000)); sets.push(`notes = $${params.length}`); }
  params.push(id);
  const r = await getPool().query(
    `UPDATE applications SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`, params
  );
  if (!r.rowCount) return null;
  return getApplication(id);
}

/**
 * Permanently removes an application. application_files is declared
 * ON DELETE CASCADE, so the stored document bytes go with it — no orphaned
 * birth certificates left in the database.
 */
async function deleteApplication(id) {
  await migrate();
  if (!id) return null;
  const existing = await getApplication(id);
  if (!existing) return null;
  await getPool().query('DELETE FROM applications WHERE id = $1', [id]);
  return existing;
}

async function readFile(id, storedAs) {
  await migrate();
  if (!id || !storedAs) return null;
  const r = await getPool().query(
    `SELECT field, filename, stored_as, content_type, bytes, data
       FROM application_files WHERE application_id = $1 AND stored_as = $2 LIMIT 1`,
    [id, storedAs]
  );
  if (!r.rowCount) return null;
  const x = r.rows[0];
  return {
    meta: { field: x.field, filename: x.filename, storedAs: x.stored_as, contentType: x.content_type, bytes: x.bytes },
    buffer: x.data,
  };
}

async function close() { if (pool) { await pool.end(); pool = null; readyPromise = null; } }

module.exports = {
  STATUSES, createApplication, listApplications, getApplication,
  updateApplication, deleteApplication, readFile, migrate, close,
  driver: 'postgres',
};
