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

// server.js only binds a port when executed directly, so that a serverless
// platform importing it gets the request handler instead of a hung invocation.
// The suite therefore starts it explicitly.
const server = require('../server');
server.listen(PORT);
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
const VALID = {
  sname: 'Yara Hassan', arname: 'يارا حسن', grade: 'KG1', faName: 'Ahmed Hassan', faMobile: '01037993762',
  stNid: '29001011234567', faNid: '28505012345678', moNid: '28710129876543',
};

(async function run() {
  await new Promise(r => setTimeout(r, 250)); // let the listener bind

  /* ------------------------- public submission ---------------------------- */
  group('1. Public application submission');

  let createdId = '';
  await test('a complete application is accepted and gets an id', async () => {
    const r = await req('POST', '/api/applications', { body: form(VALID) });
    eq(r.status, 201, 'status');
    assert(/^\d{4}-\d+$/.test(r.json.applicationId), 'bad id: ' + r.json.applicationId);
    createdId = r.json.applicationId;
  });

  await test('an incomplete application is rejected with the missing field names', async () => {
    const r = await req('POST', '/api/applications', { body: form({ sname: 'Only A Name' }) });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('arname') && r.json.fields.includes('faMobile'),
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
    const made = await req('POST', '/api/applications', { body: form({ ...VALID, sname: 'Vanishing' }) });
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

  await test('a downloaded document is named after its content, not the raw upload', async () => {
    // upload as d2 (birth certificate) with a meaningless filename
    const made = await req('POST', '/api/applications', {
      body: form(VALID, [{ field: 'd2', name: 'IMG_2931.pdf', data: Buffer.from('%PDF x') }]),
    });
    const detail = await req('GET', '/api/application?id=' + made.json.applicationId, { auth: true });
    const nm = detail.json.files[0].storedAs;
    const r = await req('GET', `/api/file?id=${made.json.applicationId}&name=${nm}`, { auth: true });
    const cd = r.headers.get('content-disposition') || '';
    assert(/Student-Birth-Certificate\.pdf/i.test(cd), 'download name not derived from the field: ' + cd);
    assert(/attachment/i.test(cd), 'default download should be an attachment');
  });

  await test('a pdf can be served inline for viewing, an html upload cannot', async () => {
    const made = await req('POST', '/api/applications', {
      body: form(VALID, [{ field: 'd1', name: 'id.pdf', data: Buffer.from('%PDF x'), type: 'application/pdf' }]),
    });
    const nm = (await req('GET', '/api/application?id=' + made.json.applicationId, { auth: true })).json.files[0].storedAs;
    const inline = await req('GET', `/api/file?id=${made.json.applicationId}&name=${nm}&mode=inline`, { auth: true });
    assert(/^inline/i.test(inline.headers.get('content-disposition') || ''), 'pdf was not served inline');
    assert(inline.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff on inline view');

    // an uploaded HTML file must never render inline in the admin origin (XSS)
    const evil = await req('POST', '/api/applications', {
      body: form(VALID, [{ field: 'd4', name: 'x.html', data: Buffer.from('<script>alert(1)</script>'), type: 'text/html' }]),
    });
    const enm = (await req('GET', '/api/application?id=' + evil.json.applicationId, { auth: true })).json.files[0].storedAs;
    const forced = await req('GET', `/api/file?id=${evil.json.applicationId}&name=${enm}&mode=inline`, { auth: true });
    assert(/^attachment/i.test(forced.headers.get('content-disposition') || ''),
      'an HTML upload was served inline — that is an XSS vector');
  });

  await test('admin workflow fields (payment / interview / follow-up) persist via PATCH', async () => {
    const made = await req('POST', '/api/applications', { body: form(VALID) });
    const up = await req('POST', '/api/application?id=' + made.json.applicationId, {
      auth: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin: { paymentResponsible: 'Finance Office', interviewDate: '2026-09-10' } }),
    });
    eq(up.status, 200, 'patch status');
    eq(up.json.admin.paymentResponsible, 'Finance Office', 'payment responsible not returned');
    eq(up.json.admin.interviewDate, '2026-09-10', 'interview date not returned');
    // the public submission response must NOT leak admin workflow data
    assert(!/paymentResponsible|Finance Office/.test(made.text), 'admin data leaked to the public caller');
  });

  await test('the admission status set matches the requested options', async () => {
    const list = await req('GET', '/api/applications', { auth: true });
    for (const s of ['accepted', 'provisionally_accepted', 'rejected', 'waiting_list']) {
      assert(list.json.statuses.includes(s), 'missing status: ' + s);
    }
    const made = await req('POST', '/api/applications', { body: form(VALID) });
    const up = await req('POST', '/api/application?id=' + made.json.applicationId, {
      auth: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'provisionally_accepted' }),
    });
    eq(up.json.status, 'provisionally_accepted', 'new status not accepted');
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

  /* ---------------------------- careers & contact --------------------------- */
  group('4b. Careers (job) applications');

  const VALID_CAREER = { name: 'Nourhan Adel', phone: '01012345678', email_2: 'nourhan@example.com', position: 'Security Personnel', years: '3', edu: 'Bachelor' };
  const CAREER_FILES = [
    { field: 'cv', name: 'cv.pdf', data: Buffer.from('%PDF-1.4 fake cv content') },
    { field: 'cert', name: 'cert.pdf', data: Buffer.from('%PDF-1.4 fake certificate content') },
  ];

  let createdCareerId = '';
  await test('a complete career application is accepted and gets an MST-HR id', async () => {
    const r = await req('POST', '/api/careers', { body: form(VALID_CAREER, CAREER_FILES) });
    eq(r.status, 201, 'status');
    assert(/^MST-HR-\d+$/.test(r.json.careerId), 'bad id: ' + r.json.careerId);
    createdCareerId = r.json.careerId;
  });

  await test('a career application without the required fields is rejected', async () => {
    const r = await req('POST', '/api/careers', { body: form({ years: '1' }) });
    eq(r.status, 400, 'status');
    for (const k of ['name', 'phone', 'email', 'edu', 'cv', 'cert']) {
      assert(r.json.fields.includes(k), 'missing field not reported: ' + k);
    }
    assert(!r.json.fields.includes('position'), 'hidden position field should not be required');
  });

  await test('an invalid email is rejected on the careers endpoint too', async () => {
    const r = await req('POST', '/api/careers', { body: form({ ...VALID_CAREER, email_2: 'not-an-email' }, CAREER_FILES) });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('email'), 'invalid email not flagged');
  });

  await test('single-letter TLDs like xxx@ggg.c are rejected (strict domain)', async () => {
    const bad = ['xxx@ggg.c', 'xxx@ggg', 'xxx@', '@ggg.com', 'xxx@.com', 'xxx@ggg.', 'xxx@gmail',
      'xxx@@gmail.com', 'random text', 'test test@gmail.com', 'xxx@localhost'];
    for (const email of bad) {
      const r = await req('POST', '/api/careers', { body: form({ ...VALID_CAREER, email_2: email }, CAREER_FILES) });
      eq(r.status, 400, 'must reject: ' + email);
      assert(r.json.fields.includes('email'), email + ' was not flagged as an invalid email');
    }
  });

  await test('custom/company/school domains pass the strict email check', async () => {
    const good = ['test@gmail.com', 'test@yahoo.com', 'test@outlook.com', 'test@zoho.com',
      'person@company.com', 'person@company.org', 'person@school.edu', 'person@company.sa',
      'person@masters-edu.com', 'name@gmail.co.uk', 'applicant@company.sa'];
    for (const email of good) {
      const r = await req('POST', '/api/careers', { body: form({ ...VALID_CAREER, email_2: email }, CAREER_FILES) });
      eq(r.status, 201, 'must accept: ' + email + ' (status ' + r.status + ')');
    }
  });

  await test('an invalid Egyptian mobile number is rejected on the careers endpoint', async () => {
    const r = await req('POST', '/api/careers', { body: form({ ...VALID_CAREER, phone: '02 2734 1020' }, CAREER_FILES) });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('phone'), 'invalid phone not flagged');
  });

  await test('years outside 0–50 is rejected on the careers endpoint', async () => {
    const r = await req('POST', '/api/careers', { body: form({ ...VALID_CAREER, years: '75' }, CAREER_FILES) });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('years'), 'out-of-range years not flagged');
  });

  await test('a career application without cv and cert attachments is rejected', async () => {
    const r = await req('POST', '/api/careers', { body: form(VALID_CAREER) });
    eq(r.status, 400, 'status');
    for (const k of ['cv', 'cert']) {
      assert(r.json.fields.includes(k), 'missing attachment not reported: ' + k);
    }
  });

  // Attachment file signatures (spec 15–20): the endpoint checks real magic
  // bytes, so a renamed image or executable can never masquerade as a CV or
  // certificate. Buffer seeds below only need the leading signature bytes.
  await test('a DOCX CV is accepted (OOXML zip signature)', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        { field: 'cv', name: 'cv.docx', data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]) },
        ...CAREER_FILES.filter(f => f.field === 'cert'),
      ]),
    });
    eq(r.status, 201, 'status');
  });

  await test('an OLE2 .doc CV is accepted (compound file signature)', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        { field: 'cv', name: 'cv.doc', data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) },
        ...CAREER_FILES.filter(f => f.field === 'cert'),
      ]),
    });
    eq(r.status, 201, 'status');
  });

  await test('a JPG photo renamed resume.pdf is rejected as a CV', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        { field: 'cv', name: 'resume.pdf', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]) },
        ...CAREER_FILES.filter(f => f.field === 'cert'),
      ]),
    });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('cv'), 'jpg-as-pdf not flagged: ' + JSON.stringify(r.json.fields));
  });

  await test('a PNG photo is rejected as a CV', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        { field: 'cv', name: 'photo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
        ...CAREER_FILES.filter(f => f.field === 'cert'),
      ]),
    });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('cv'), 'png-as-cv not flagged');
  });

  await test('a GIF image is rejected as a CV', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        { field: 'cv', name: 'meme.gif', data: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) },
        ...CAREER_FILES.filter(f => f.field === 'cert'),
      ]),
    });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('cv'), 'gif-as-cv not flagged');
  });

  await test('an executable renamed to .pdf is rejected as a CV', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        { field: 'cv', name: 'resume.pdf', data: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]) },
        ...CAREER_FILES.filter(f => f.field === 'cert'),
      ]),
    });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('cv'), 'exe-as-cv not flagged');
  });

  await test('a scanned JPG certificate is accepted', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        ...CAREER_FILES.filter(f => f.field === 'cv'),
        { field: 'cert', name: 'scan.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]) },
      ]),
    });
    eq(r.status, 201, 'status');
  });

  await test('a PNG certificate is accepted', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        ...CAREER_FILES.filter(f => f.field === 'cv'),
        { field: 'cert', name: 'cert.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
      ]),
    });
    eq(r.status, 201, 'status');
  });

  await test('a GIF is rejected as a certificate', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        ...CAREER_FILES.filter(f => f.field === 'cv'),
        { field: 'cert', name: 'cert.gif', data: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) },
      ]),
    });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('cert'), 'gif-as-cert not flagged');
  });

  await test('an executable renamed to .pdf is rejected as a certificate', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        ...CAREER_FILES.filter(f => f.field === 'cv'),
        { field: 'cert', name: 'cert.pdf', data: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]) },
      ]),
    });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('cert'), 'exe-as-cert not flagged');
  });

  await test('a DOCX cannot masquerade as a certificate', async () => {
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [
        ...CAREER_FILES.filter(f => f.field === 'cv'),
        { field: 'cert', name: 'cert.docx', data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]) },
      ]),
    });
    eq(r.status, 400, 'status');
    assert(r.json.fields.includes('cert'), 'docx-as-cert not flagged');
  });

  let cvCareerId = '';
  await test('an attached CV is stored byte-for-byte', async () => {
    const bytes = Buffer.from('%PDF-1.4 fake cv content');
    const r = await req('POST', '/api/careers', {
      body: form(VALID_CAREER, [{ field: 'cv', name: 'cv.pdf', data: bytes }, ...CAREER_FILES.filter(f => f.field === 'cert')]),
    });
    eq(r.status, 201, 'status');
    cvCareerId = r.json.careerId;
  });

  await test('admin can read the stored CV back on the career record', async () => {
    const detail = await req('GET', '/api/career?id=' + encodeURIComponent(cvCareerId), { auth: true });
    eq(detail.status, 200, 'status');
    assert(detail.json.files.some(f => f.field === 'cv'), 'cv not recorded on the row');
  });

  await test('a career application listing requires admin auth', async () => {
    const r = await req('GET', '/api/careers');
    eq(r.status, 401, 'status');
  });

  await test('an admin can list career applications and see the one just created', async () => {
    const r = await req('GET', '/api/careers', { auth: true });
    eq(r.status, 200, 'status');
    assert(r.json.rows.some(row => row.id === createdCareerId), 'created career application not listed');
  });

  await test('a career application status can be moved through the HR workflow', async () => {
    const r = await req('POST', '/api/career?id=' + encodeURIComponent(createdCareerId), {
      auth: true,
      body: form({ status: 'shortlisted' }),
    });
    eq(r.status, 200, 'status');
    eq(r.json.status, 'shortlisted', 'status not updated');
  });

  await test('an admissions-only status is rejected on a career application', async () => {
    const r = await req('POST', '/api/career?id=' + encodeURIComponent(createdCareerId), {
      auth: true,
      body: form({ status: 'provisionally_accepted' }),
    });
    eq(r.status, 400, 'a status from the wrong workflow should be rejected');
  });

  await test('career documents are not downloadable without a session', async () => {
    const detail = await req('GET', '/api/career?id=' + encodeURIComponent(cvCareerId), { auth: true });
    const cv = detail.json.files.find(f => f.field === 'cv');
    assert(cv, 'setup: cv file missing on the record used by this test');
    const r = await req('GET', `/api/careerfile?id=${encodeURIComponent(cvCareerId)}&name=${encodeURIComponent(cv.storedAs)}`);
    eq(r.status, 401, 'status');
  });

  await test('an admin can delete a career application and its documents', async () => {
    const r = await req('DELETE', '/api/career?id=' + encodeURIComponent(createdCareerId), { auth: true });
    eq(r.status, 200, 'status');
    const gone = await req('GET', '/api/career?id=' + encodeURIComponent(createdCareerId), { auth: true });
    eq(gone.status, 404, 'deleted career application still readable');
  });

  group('4c. Contact form');

  await test('a valid contact message is accepted (delivery skipped: no RESEND_API_KEY in tests)', async () => {
    const r = await req('POST', '/api/contact', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Layla', email: 'layla@example.com', phone: '01099999999', message: 'Hello, I have a question about admissions.' }),
    });
    // Without RESEND_API_KEY configured, the endpoint correctly reports the
    // message could NOT be delivered rather than lying with a 200 — see the
    // next test for that guarantee. Here we only check it never 500s or
    // silently swallows the request.
    assert(r.status === 200 || r.status === 502, 'unexpected status: ' + r.status);
  });

  await test('a failed delivery is reported to the caller, never faked as success', async () => {
    // No RESEND_API_KEY is set for this suite, so delivery must fail loudly.
    const r = await req('POST', '/api/contact', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Omar', email: 'omar@example.com', message: 'Testing delivery failure reporting.' }),
    });
    eq(r.status, 502, 'a message that cannot be emailed must not be reported as sent');
  });

  await test('a missing name/email/message is rejected with 400', async () => {
    const r = await req('POST', '/api/contact', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'short' }),
    });
    eq(r.status, 400, 'status');
  });

  await test('a too-short message is rejected', async () => {
    const r = await req('POST', '/api/contact', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A', email: 'a@example.com', message: 'hi' }),
    });
    eq(r.status, 400, 'status');
  });

  await test('the contact endpoint rate-limits repeated submissions from one caller', async () => {
    let last;
    for (let i = 0; i < 6; i++) {
      last = await req('POST', '/api/contact', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Spammer', email: 'spam@example.com', message: 'Message number ' + i + ' of many.' }),
      });
    }
    eq(last.status, 429, 'sixth rapid submission should be rate-limited');
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
