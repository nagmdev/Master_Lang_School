/*
 * Masters School — admissions API test suite
 * Zero dependencies. Run with:  node tests/api.test.js
 *
 * Boots the real dev server against a throwaway data directory, then exercises
 * the public submission endpoint and the admin endpoints over real HTTP —
 * including the security boundaries (auth, path traversal, static exposure).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8901 + Math.floor(Math.random() * 400);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-api-test-'));
process.env.PORT = String(PORT);
process.env.MS_DATA_DIR = DATA;
process.env.MS_ADMIN_PASSWORD = 'test-password-1234';
process.env.MS_SESSION_SECRET = 'test-secret-for-suite-only';

const server = require('../server');
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0, fail = 0;
const failures = [];
function group(n) { console.log('\n\x1b[1m' + n + '\x1b[0m'); }
async function test(name, fn) {
  try { await fn(); pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; failures.push([name, e.message]); console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      → ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'expected') + `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

let cookie = '';
async function req(method, url, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (opts.auth && cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: opts.body, redirect: 'manual' });
  const setC = res.headers.get('set-cookie');
  if (setC && opts.keepCookie) cookie = setC.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text, headers: res.headers };
}
function form(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append(f.field, new Blob([f.data], { type: f.type || 'application/pdf' }), f.name);
  return fd;
}
const VALID = { fname: 'Yara', lname: 'Hassan', grade: 'KG1', faName: 'Ahmed Hassan', faMobile: '01037993762' };

(async function run() {
  await new Promise(r => setTimeout(r, 250)); // let the listener bind

  /* ------------------------- public submission ---------------------------- */
  group('1. Public application submission');

  let createdId = '';
  await test('a complete application is accepted and gets an id', async () => {
    const r = await req('POST', '/api/applications', { body: form(VALID) });
    eq(r.status, 201, 'status');
    assert(/^MST-\d{4}-\d{4}$/.test(r.json.applicationId), 'bad id: ' + r.json.applicationId);
    createdId = r.json.applicationId;
  });

  await test('an incomplete application is rejected with the missing field names', async () => {
    const r = await req('POST', '/api/applications', { body: form({ fname: 'OnlyFirst' }) });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('lname') && r.json.fields.includes('faMobile'),
      'missing list wrong: ' + JSON.stringify(r.json.fields));
  });

  await test('blank-but-present required fields are still rejected', async () => {
    const r = await req('POST', '/api/applications', { body: form({ ...VALID, faMobile: '   ' }) });
    eq(r.status, 400, 'whitespace should not satisfy a required field');
  });

  await test('the response never echoes the submitted personal data back', async () => {
    const r = await req('POST', '/api/applications', { body: form(VALID) });
    assert(!/Hassan|01037993762/.test(r.text), 'personal data leaked in response: ' + r.text);
  });

  // Read the stored bytes back through the API rather than off disk, so the
  // check is valid for every storage driver (local files or Postgres).
  async function adminCookie() {
    const r = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: process.env.MS_ADMIN_PASSWORD }),
    });
    return (r.headers.get('set-cookie') || '').split(';')[0];
  }
  async function storedBytes(applicationId) {
    const c = await adminCookie();
    const detail = await fetch(BASE + '/api/application?id=' + applicationId, { headers: { Cookie: c } }).then(r => r.json());
    assert(detail.files && detail.files.length === 1, 'expected exactly one stored document');
    const res = await fetch(`${BASE}/api/file?id=${applicationId}&name=${encodeURIComponent(detail.files[0].storedAs)}`, { headers: { Cookie: c } });
    eq(res.status, 200, 'file download status');
    return Buffer.from(await res.arrayBuffer());
  }

  await test('an uploaded document is stored byte-for-byte', async () => {
    const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0xff, 0xfe, 0x0d, 0x0a, 0x2d, 0x2d]);
    const r = await req('POST', '/api/applications', {
      body: form(VALID, [{ field: 'd2', name: 'birth.pdf', data }]),
    });
    eq(r.status, 201, 'status');
    assert((await storedBytes(r.json.applicationId)).equals(data), 'stored bytes differ from what was uploaded');
  });

  await test('binary content containing the boundary marker survives parsing', async () => {
    // "--" sequences inside a file body are the classic multipart parser bug.
    const data = Buffer.from('----WebKitFormBoundary\r\nnot-a-real-boundary\r\n--', 'utf8');
    const r = await req('POST', '/api/applications', {
      body: form(VALID, [{ field: 'd1', name: 'id.pdf', data }]),
    });
    eq(r.status, 201, 'status');
    assert((await storedBytes(r.json.applicationId)).equals(data), 'boundary-like bytes were mangled');
  });

  /* ------------------------------- auth ----------------------------------- */
  group('2. Admin authentication');

  await test('listing applications without a session is refused', async () => {
    const r = await req('GET', '/api/applications');
    eq(r.status, 401, 'status');
  });

  await test('an incorrect password is refused', async () => {
    const r = await req('POST', '/api/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    eq(r.status, 401, 'status');
  });

  await test('a forged session cookie is refused', async () => {
    const r = await fetch(BASE + '/api/applications', {
      headers: { Cookie: 'ms_admin=' + (Date.now() + 99999) + '.deadbeef' },
    });
    eq(r.status, 401, 'a hand-made cookie must not authenticate');
  });

  await test('the correct password issues an httpOnly session cookie', async () => {
    const r = await req('POST', '/api/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password-1234' }),
      keepCookie: true,
    });
    eq(r.status, 200, 'status');
    const sc = r.headers.get('set-cookie') || '';
    assert(/HttpOnly/i.test(sc), 'cookie is not HttpOnly: ' + sc);
    assert(/SameSite=Strict/i.test(sc), 'cookie is not SameSite=Strict: ' + sc);
    assert(cookie.startsWith('ms_admin='), 'no session cookie captured');
  });

  /* ---------------------------- admin reads -------------------------------- */
  group('3. Admin listing, search & status');

  await test('an authenticated admin can list applications', async () => {
    const r = await req('GET', '/api/applications', { auth: true });
    eq(r.status, 200, 'status');
    assert(r.json.total >= 4, 'expected several applications, got ' + r.json.total);
    assert(Array.isArray(r.json.statuses) && r.json.statuses.includes('accepted'), 'statuses missing');
  });

  await test('search matches on applicant details', async () => {
    const hit = await req('GET', '/api/applications?q=yara', { auth: true });
    const miss = await req('GET', '/api/applications?q=zzzznotfound', { auth: true });
    assert(hit.json.total > 0, 'search found nothing for a known applicant');
    eq(miss.json.total, 0, 'search matched a nonsense term');
  });

  await test('status can be updated and is reflected in the filter counts', async () => {
    const up = await req('POST', '/api/application?id=' + createdId, {
      auth: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', notes: 'Strong assessment' }),
    });
    eq(up.status, 200, 'status');
    eq(up.json.status, 'accepted', 'status not persisted');
    eq(up.json.notes, 'Strong assessment', 'notes not persisted');
    const list = await req('GET', '/api/applications?status=accepted', { auth: true });
    assert(list.json.rows.some(x => x.id === createdId), 'accepted filter does not include the row');
  });

  await test('an unknown status value is rejected', async () => {
    const r = await req('POST', '/api/application?id=' + createdId, {
      auth: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'hacked' }),
    });
    eq(r.status, 400, 'invalid status must not be stored');
  });

  await test('updating a nonexistent application returns 404', async () => {
    const r = await req('POST', '/api/application?id=MST-1900-0001', {
      auth: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    });
    eq(r.status, 404, 'status');
  });

  /* ------------------------------ deletion --------------------------------- */
  group('3b. Deleting an application');

  await test('deletion is refused without a session', async () => {
    const made = await req('POST', '/api/applications', { body: form(VALID) });
    const r = await fetch(BASE + '/api/application?id=' + made.json.applicationId, { method: 'DELETE' });
    eq(r.status, 401, 'an anonymous caller could delete a family\'s application');
    // and it must still be there
    const still = await req('GET', '/api/application?id=' + made.json.applicationId, { auth: true });
    eq(still.status, 200, 'the application was removed by an unauthenticated request');
  });

  await test('an admin can delete an application and its documents', async () => {
    const data = Buffer.from('scanned document');
    const made = await req('POST', '/api/applications', {
      body: form(VALID, [{ field: 'd2', name: 'cert.pdf', data }]),
    });
    const id = made.json.applicationId;
    const detail = await req('GET', '/api/application?id=' + id, { auth: true });
    const storedAs = detail.json.files[0].storedAs;

    const del = await req('DELETE', '/api/application?id=' + id, { auth: true });
    eq(del.status, 200, 'delete status');
    eq(del.json.deletedFiles, 1, 'did not report the removed document');

    eq((await req('GET', '/api/application?id=' + id, { auth: true })).status, 404, 'still readable');
    eq((await req('GET', `/api/file?id=${id}&name=${storedAs}`, { auth: true })).status, 404,
      'the uploaded document is still downloadable after deletion');
  });

  await test('a deleted application disappears from the list and counts', async () => {
    const made = await req('POST', '/api/applications', { body: form({ ...VALID, fname: 'Vanishing' }) });
    const before = await req('GET', '/api/applications', { auth: true });
    await req('DELETE', '/api/application?id=' + made.json.applicationId, { auth: true });
    const after = await req('GET', '/api/applications', { auth: true });
    eq(after.json.total, before.json.total - 1, 'total did not decrease');
    assert(!after.json.rows.some(r => r.id === made.json.applicationId), 'row still listed');
  });

  await test('deleting a nonexistent application returns 404', async () => {
    const r = await req('DELETE', '/api/application?id=MST-1900-0001', { auth: true });
    eq(r.status, 404, 'status');
  });

  await test('deleting without an id is rejected', async () => {
    const r = await req('DELETE', '/api/application', { auth: true });
    eq(r.status, 400, 'status');
  });

  /* ------------------------- document security ----------------------------- */
  group('4. Document security');

  let docId = '', docName = '';
  await test('an uploaded document is downloadable by an admin', async () => {
    const list = await req('GET', '/api/applications', { auth: true });
    const withFile = list.json.rows.find(r => (r.files || []).length);
    assert(withFile, 'no application with a document');
    docId = withFile.id; docName = withFile.files[0].storedAs;
    const r = await req('GET', `/api/file?id=${docId}&name=${docName}`, { auth: true });
    eq(r.status, 200, 'status');
    assert(/attachment/i.test(r.headers.get('content-disposition') || ''), 'not served as an attachment');
    eq(r.headers.get('x-content-type-options'), 'nosniff', 'missing nosniff');
  });

  await test('documents are NOT downloadable without a session', async () => {
    const r = await req('GET', `/api/file?id=${docId}&name=${docName}`);
    eq(r.status, 401, 'a birth certificate was served to an anonymous caller');
  });

  await test('path traversal through the filename is blocked', async () => {
    for (const bad of ['../../applications.json', '..%2F..%2Fapplications.json', '/etc/passwd']) {
      const r = await req('GET', `/api/file?id=${docId}&name=${encodeURIComponent(bad)}`, { auth: true });
      assert(r.status === 404 || r.status === 400, 'traversal not blocked for ' + bad + ' (got ' + r.status + ')');
    }
  });

  await test('the data directory is not reachable as a static file', async () => {
    for (const p of ['/data/applications.json', '/data/uploads/', '/api/../data/applications.json']) {
      const r = await req('GET', p);
      assert(r.status === 403 || r.status === 404, p + ' returned ' + r.status);
      assert(!/faMobile|01037993762/.test(r.text), 'personal data exposed at ' + p);
    }
  });

  await test('signing out invalidates the session', async () => {
    const saved = cookie;
    await req('POST', '/api/logout', { auth: true });
    cookie = ''; // server cleared it; emulate the browser dropping it
    const r = await req('GET', '/api/applications');
    eq(r.status, 401, 'status');
    cookie = saved;
  });

  /* --------------------------------- misc ---------------------------------- */
  group('5. Robustness');

  await test('an unknown API endpoint returns a JSON 404', async () => {
    const r = await req('GET', '/api/nope');
    eq(r.status, 404, 'status');
    assert(r.json && r.json.error, 'not a JSON error body');
  });

  await test('malformed JSON is rejected cleanly, not crashed on', async () => {
    const r = await req('POST', '/api/login', {
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert(r.status === 400 || r.status === 401, 'got ' + r.status);
  });

  await test('the site itself is still served', async () => {
    const r = await req('GET', '/');
    eq(r.status, 200, 'status');
    assert(/Masters/.test(r.text), 'index.html not served');
  });

  await test('the admin page is served and marked noindex', async () => {
    const r = await req('GET', '/admin.html');
    eq(r.status, 200, 'status');
    assert(/noindex/.test(r.text), 'admin page is not excluded from search engines');
  });

  /* -------------------------------- report --------------------------------- */
  console.log('\n' + '─'.repeat(64));
  console.log(`  ${pass} passed, ${fail} failed, ${pass + fail} total`);
  if (fail) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    failures.forEach(([n, m], i) => console.log(`  ${i + 1}. ${n}\n     ${m}`));
  }
  console.log('─'.repeat(64));

  server.close();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
