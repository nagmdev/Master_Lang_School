/*
 * Storage driver conformance suite.
 *
 * Runs the SAME assertions against every driver, so the production Postgres
 * driver is proven behaviourally identical to the local one rather than assumed
 * to be. Routes and the admin UI depend only on this contract.
 *
 *   node tests/store.test.js                       # local driver only
 *   DATABASE_URL=postgres://... node tests/store.test.js   # local + postgres
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function group(n) { console.log('\n\x1b[1m' + n + '\x1b[0m'); }
async function test(name, fn) {
  try { await fn(); pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; failures.push([name, e.message]); console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      → ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'expected') + `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

const VALID = { fname: 'Yara', lname: 'Hassan', grade: 'KG1', faName: 'Ahmed Hassan', faMobile: '01037993762' };
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x0d, 0x0a, 0x2d, 0x2d, 0x00, 0x7f]);

async function runSuite(label, store, cleanup) {
  group(label);

  let id = '';
  await test('creates an application and returns a well-formed id', async () => {
    const row = await store.createApplication({ fields: VALID, files: [] });
    assert(/^MST-\d{4}-\d{4}$/.test(row.id), 'bad id: ' + row.id);
    eq(row.status, 'new', 'initial status');
    eq(row.notes, '', 'initial notes');
    assert(!isNaN(Date.parse(row.submittedAt)), 'submittedAt is not a date: ' + row.submittedAt);
    id = row.id;
  });

  await test('round-trips every submitted field unchanged', async () => {
    const row = await store.getApplication(id);
    for (const [k, v] of Object.entries(VALID)) eq(row.fields[k], v, 'field ' + k);
  });

  await test('preserves unicode and arabic values', async () => {
    const fields = { ...VALID, arname: 'يارا حسن', cHealth: 'حساسية — الفول السوداني' };
    const row = await store.createApplication({ fields, files: [] });
    const back = await store.getApplication(row.id);
    eq(back.fields.arname, 'يارا حسن', 'arabic name');
    eq(back.fields.cHealth, 'حساسية — الفول السوداني', 'arabic note');
  });

  await test('stores and returns binary documents byte-for-byte', async () => {
    const row = await store.createApplication({
      fields: VALID,
      files: [{ field: 'd2', filename: 'birth.pdf', contentType: 'application/pdf', buffer: PDF }],
    });
    const back = await store.getApplication(row.id);
    eq(back.files.length, 1, 'file count');
    eq(back.files[0].field, 'd2', 'field');
    eq(back.files[0].bytes, PDF.length, 'byte count');
    const got = await store.readFile(row.id, back.files[0].storedAs);
    assert(got && Buffer.from(got.buffer).equals(PDF), 'document bytes were altered in storage');
  });

  await test('never returns document bytes in the list view', async () => {
    const out = await store.listApplications({});
    for (const r of out.rows) {
      for (const f of r.files || []) {
        assert(f.data === undefined && f.buffer === undefined,
          'list view carries raw file bytes — this will not scale');
      }
    }
  });

  await test('ignores empty file slots', async () => {
    const row = await store.createApplication({
      fields: VALID,
      files: [{ field: 'd1', filename: '', contentType: '', buffer: Buffer.alloc(0) }],
    });
    eq((await store.getApplication(row.id)).files.length, 0, 'empty upload should not be stored');
  });

  await test('lists newest first', async () => {
    const out = await store.listApplications({});
    assert(out.rows.length >= 4, 'expected several rows, got ' + out.rows.length);
    const times = out.rows.map(r => Date.parse(r.submittedAt));
    for (let i = 1; i < times.length; i++) assert(times[i - 1] >= times[i], 'ordering is not newest-first');
  });

  await test('search matches applicant details, case-insensitively', async () => {
    eq((await store.listApplications({ q: 'zzzznotfound' })).total, 0, 'nonsense term matched');
    assert((await store.listApplications({ q: 'YARA' })).total > 0, 'known applicant not found');
    assert((await store.listApplications({ q: '01037993762' })).total > 0, 'mobile search failed');
  });

  await test('status filter and counts agree', async () => {
    await store.updateApplication(id, { status: 'accepted' });
    const all = await store.listApplications({});
    const filtered = await store.listApplications({ status: 'accepted' });
    eq(filtered.total, all.counts.accepted, 'filtered total != counts.accepted');
    assert(filtered.rows.every(r => r.status === 'accepted'), 'filter leaked other statuses');
  });

  await test('updates status and notes, and stamps updatedAt', async () => {
    const row = await store.updateApplication(id, { status: 'reviewing', notes: 'Called parent' });
    eq(row.status, 'reviewing', 'status');
    eq(row.notes, 'Called parent', 'notes');
    assert(row.updatedAt && !isNaN(Date.parse(row.updatedAt)), 'updatedAt not set');
  });

  await test('rejects an unknown status', async () => {
    let threw = false;
    try { await store.updateApplication(id, { status: 'hacked' }); } catch (e) { threw = true; }
    assert(threw, 'an invalid status was accepted');
  });

  await test('returns null for unknown ids instead of throwing', async () => {
    eq(await store.getApplication('MST-1900-0001'), null, 'getApplication');
    eq(await store.updateApplication('MST-1900-0001', { status: 'accepted' }), null, 'updateApplication');
    eq(await store.readFile('MST-1900-0001', 'nope.pdf'), null, 'readFile');
  });

  await test('does not serve one application\'s document via another id', async () => {
    const a = await store.createApplication({
      fields: VALID, files: [{ field: 'd2', filename: 'a.pdf', contentType: 'application/pdf', buffer: PDF }],
    });
    const b = await store.createApplication({ fields: VALID, files: [] });
    const name = (await store.getApplication(a.id)).files[0].storedAs;
    eq(await store.readFile(b.id, name), null, 'cross-application document access is possible');
  });

  await test('deletes an application and reports what was removed', async () => {
    const row = await store.createApplication({
      fields: { ...VALID, fname: 'ToDelete' },
      files: [{ field: 'd2', filename: 'gone.pdf', contentType: 'application/pdf', buffer: PDF }],
    });
    const before = (await store.listApplications({})).total;
    const removed = await store.deleteApplication(row.id);
    assert(removed && removed.id === row.id, 'delete did not return the removed row');
    eq(await store.getApplication(row.id), null, 'application still readable after delete');
    eq((await store.listApplications({})).total, before - 1, 'list total did not drop');
  });

  await test('deleting an application also destroys its documents', async () => {
    const row = await store.createApplication({
      fields: VALID,
      files: [{ field: 'd1', filename: 'id.pdf', contentType: 'application/pdf', buffer: PDF }],
    });
    const stored = (await store.getApplication(row.id)).files[0].storedAs;
    assert(await store.readFile(row.id, stored), 'document not readable before delete');
    await store.deleteApplication(row.id);
    eq(await store.readFile(row.id, stored), null,
      'the document survived deletion — a birth certificate is still on disk with nothing pointing at it');
  });

  await test('deleting an unknown application returns null rather than throwing', async () => {
    eq(await store.deleteApplication('MST-1900-0001'), null, 'unknown id');
    eq(await store.deleteApplication(''), null, 'empty id');
  });

  await test('deleting one application leaves the others untouched', async () => {
    const keep = await store.createApplication({ fields: { ...VALID, fname: 'Keeper' }, files: [] });
    const drop = await store.createApplication({ fields: { ...VALID, fname: 'Dropper' }, files: [] });
    await store.deleteApplication(drop.id);
    const survivor = await store.getApplication(keep.id);
    assert(survivor && survivor.fields.fname === 'Keeper', 'deleting one row removed another');
  });

  await test('concurrent submissions all persist with unique ids', async () => {
    const before = (await store.listApplications({})).total;
    const made = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.createApplication({ fields: { ...VALID, fname: 'Concurrent' + i }, files: [] }))
    );
    const ids = new Set(made.map(r => r.id));
    eq(ids.size, 8, 'ids collided under concurrency');
    eq((await store.listApplications({})).total, before + 8, 'a concurrent submission was lost');
  });

  if (cleanup) await cleanup();
}

(async function main() {
  // ---- local driver -------------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-store-'));
  process.env.MS_DATA_DIR = dir;
  delete require.cache[require.resolve('../api/_lib/store.local')];
  const local = require('../api/_lib/store.local');
  await runSuite('local driver (development)', local, async () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  });

  // ---- postgres driver ----------------------------------------------------
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    console.log('\n\x1b[33m!\x1b[0m postgres driver skipped — set DATABASE_URL to include it');
  } else {
    const pg = require('../api/_lib/store.postgres');
    await pg.migrate();
    // start from a clean slate so counts/ordering assertions are meaningful
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
    await p.query('TRUNCATE application_files, applications');
    await p.end();
    await runSuite('postgres driver (production)', pg, async () => { await pg.close(); });
  }

  console.log('\n' + '─'.repeat(64));
  console.log(`  ${pass} passed, ${fail} failed, ${pass + fail} total`);
  if (fail) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    failures.forEach(([n, m], i) => console.log(`  ${i + 1}. ${n}\n     ${m}`));
  }
  console.log('─'.repeat(64));
  process.exit(fail ? 1 : 0);
})();
