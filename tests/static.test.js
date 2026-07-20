/*
 * Masters School — Admissions feature: static test suite
 * Zero dependencies. Run with:  node tests/static.test.js
 *
 * Validates the admissions feature against its two source specifications:
 *   - uploads/Masters_School_Website_Master_Prompt.txt (brand/a11y/SEO/responsive requirements)
 *   - the admissions procedures doc (الاجراءات) and application-form doc (admission.docx)
 * plus the three business edits: assessment fee 600 EGP, first-installment on
 * acceptance, and no 10,000 EGP registration fee — in BOTH Arabic and English.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const MIRROR = path.join(ROOT, 'Masters School.dc.html');
const src = fs.readFileSync(INDEX, 'utf8');

/* ------------------------------ tiny harness ------------------------------ */
let pass = 0, fail = 0;
const failures = [];
function group(name) { console.log('\n\x1b[1m' + name + '\x1b[0m'); }
function test(name, fn) {
  try { fn(); pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; failures.push([name, e.message]); console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      → ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertHas(haystack, needle, label) {
  assert(haystack.includes(needle), (label || 'expected to find') + ': ' + JSON.stringify(needle));
}
function assertMissing(haystack, needle, label) {
  assert(!haystack.includes(needle), (label || 'should NOT contain') + ': ' + JSON.stringify(needle));
}

/* ------------------------------ parsing utils ----------------------------- */
// The template is everything before the DC script block; the dictionaries live inside it.
const TEMPLATE = src.split('data-dc-script')[0];
const SCRIPT = src.slice(src.indexOf('data-dc-script'));
const HEAD = src.slice(0, src.indexOf('</head>'));

function matchBraces(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(openIdx, i + 1); }
  }
  throw new Error('unbalanced braces from index ' + openIdx);
}
function langAdmBlock(lang) {
  const re = new RegExp('\\n\\s+' + lang + ': \\{');
  const m = re.exec(SCRIPT);
  assert(m, 'could not locate "' + lang + '" language dictionary');
  const admIdx = SCRIPT.indexOf('adm: {', m.index);
  assert(admIdx > -1, 'could not locate adm block in "' + lang + '"');
  return matchBraces(SCRIPT, SCRIPT.indexOf('{', admIdx));
}
const EN = langAdmBlock('en');
const AR = langAdmBlock('ar');

// The admissions application form markup
const formStart = TEMPLATE.indexOf('<form onSubmit="{{ submit }}"');
assert(formStart > -1, 'admissions form not found');
const FORM = TEMPLATE.slice(formStart, TEMPLATE.indexOf('</form>', formStart));

// The admissions page region (journey + form)
const admStart = TEMPLATE.indexOf('<!-- ================= ADMISSIONS =================');
const admEnd = TEMPLATE.indexOf('<!-- ================= ABOUT =================');
assert(admStart > -1 && admEnd > admStart, 'admissions region not found');
const ADMISSIONS = TEMPLATE.slice(admStart, admEnd);

// All {{ t.adm.* }} bindings used in markup
const bindings = [...new Set([...TEMPLATE.matchAll(/\{\{\s*(t\.adm(?:\.[a-zA-Z0-9]+)+)/g)].map(m => m[1]))];
// Content can also be reached indirectly through renderVals() in the component
// script (e.g. submitLabel picks between f.submit and f.sending), so reachability
// must consider the whole file, not just the template.
const reachable = new Set(
  [...src.matchAll(/t\.adm(?:\.[a-zA-Z0-9]+)+/g)].map(m => m[0].split('.').pop())
);
const bindingLeaves = reachable;
// Strip string literals first, so words appearing inside prose (e.g. "Assessment
// fee:", "Pre-K و KG1: ...") are never mistaken for object keys.
function keysOf(block) {
  const noStrings = block.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return new Set([...noStrings.matchAll(/([a-zA-Z0-9]+)\s*:/g)].map(m => m[1]));
}
const enKeys = keysOf(EN), arKeys = keysOf(AR);

/* =============================== 1. INTEGRITY ============================== */
group('1. File integrity & template structure');

test('index.html and "Masters School.dc.html" are byte-identical', () => {
  const mirror = fs.readFileSync(MIRROR, 'utf8');
  assert(mirror === src, 'the two source copies have drifted — re-sync them');
});

test('sc-if tags are balanced', () => {
  const open = (src.match(/<sc-if/g) || []).length, close = (src.match(/<\/sc-if>/g) || []).length;
  assert(open === close, `<sc-if> ${open} vs </sc-if> ${close}`);
});

test('sc-for tags are balanced', () => {
  const open = (src.match(/<sc-for/g) || []).length, close = (src.match(/<\/sc-for>/g) || []).length;
  assert(open === close, `<sc-for> ${open} vs </sc-for> ${close}`);
});

test('admissions page is guarded by its own sc-if', () => {
  assertHas(ADMISSIONS, '<sc-if value="{{ isAdmissions }}"');
});

test('every sc-for in the admissions region declares list and as', () => {
  for (const tag of ADMISSIONS.match(/<sc-for[^>]*>/g) || []) {
    assert(/list="/.test(tag) && /as="/.test(tag), 'malformed sc-for: ' + tag);
  }
});

/* ============================ 2. BINDING SAFETY ============================ */
group('2. Binding resolution & bilingual parity');

test('every {{ t.adm.* }} binding resolves to a defined key (English)', () => {
  const missing = bindings.filter(b => !enKeys.has(b.split('.').pop()));
  assert(missing.length === 0, 'unresolved in en: ' + missing.join(', '));
});

test('every {{ t.adm.* }} binding resolves to a defined key (Arabic)', () => {
  const missing = bindings.filter(b => !arKeys.has(b.split('.').pop()));
  assert(missing.length === 0, 'unresolved in ar: ' + missing.join(', '));
});

test('no admissions dictionary key is defined but never rendered (dead content)', () => {
  // A key counts as reachable if it is mentioned anywhere OUTSIDE the two
  // dictionaries — as a {{ }} binding, or via a local alias in the component
  // (e.g. `const t = ...adm.f; t.tooLarge`). Matching only `t.adm.f.x` would
  // wrongly flag the aliased ones.
  const outside = src.replace(EN, '').replace(AR, '');
  const containers = new Set(['adm', 'f', 'need', 'conf', 'dates', 'l', 'v']);
  const dead = [...enKeys].filter(k =>
    !containers.has(k) && !new RegExp('\\b' + k + '\\b').test(outside));
  assert(dead.length === 0, 'defined but never rendered: ' + dead.join(', '));
});

test('English and Arabic admissions dictionaries expose the same keys', () => {
  const onlyEn = [...enKeys].filter(k => !arKeys.has(k));
  const onlyAr = [...arKeys].filter(k => !enKeys.has(k));
  assert(onlyEn.length === 0 && onlyAr.length === 0,
    'en-only: [' + onlyEn.join(', ') + '] ar-only: [' + onlyAr.join(', ') + ']');
});

/* ======================= 3. BUSINESS RULES (the edits) ===================== */
group('3. Business rules — the three requested edits');

test('EDIT 1: assessment fee is 600 EGP (English)', () => assertHas(EN, '600 EGP'));
test('EDIT 1: assessment fee is 600 EGP (Arabic)', () => assertHas(AR, '600 جنيه مصري'));

test('EDIT 1: the superseded 2,000 EGP fee appears nowhere', () => {
  for (const bad of ['2,000', '2000 EGP', '2000 جنيه']) {
    assertMissing(EN, bad, 'English still contains'); assertMissing(AR, bad, 'Arabic still contains');
  }
});

test('EDIT 2: acceptance requires the FIRST INSTALLMENT fee (English)', () =>
  assertHas(EN, 'first installment fee is required'));
test('EDIT 2: acceptance requires the FIRST INSTALLMENT fee (Arabic)', () =>
  assertHas(AR, 'رسوم القسط الأول'));

test('EDIT 2: the 10,000 EGP registration fee is fully removed', () => {
  for (const bad of ['10,000', '10000', '١٠٠٠٠']) {
    assertMissing(EN, bad, 'English still contains'); assertMissing(AR, bad, 'Arabic still contains');
  }
});

test('EDIT 3: assessment fee is non-refundable in both languages', () => {
  assertHas(EN, 'non-refundable'); assertHas(AR, 'غير مستردة');
});

/* ==================== 4. PROCEDURES DOC (الاجراءات.docx) =================== */
group('4. Admissions procedures — fidelity to الاجراءات.docx');

const STEP_KEYS = ['s1t', 's1d', 's2t', 's2d', 's3t', 's3d', 's4t', 's4d', 's5t', 's5d'];
test('all five journey steps have a title and body in both languages', () => {
  for (const k of STEP_KEYS) {
    assert(new RegExp('\\b' + k + ':').test(EN), 'missing ' + k + ' in English');
    assert(new RegExp('\\b' + k + ':').test(AR), 'missing ' + k + ' in Arabic');
  }
});

test('all five journey steps are rendered in the markup', () => {
  for (const k of STEP_KEYS) assertHas(ADMISSIONS, '{{ t.adm.' + k + ' }}', 'step not rendered');
});

test('step 2 lists both initial-document rules (nursery report + transfer)', () => {
  assertHas(EN, 'nursery report'); assertHas(EN, 'Letter of Good Conduct');
  assertHas(AR, 'التقرير الأكاديمي للحضانة'); assertHas(AR, 'حسن سير وسلوك');
});

test('step 2 keeps the "assessment does not guarantee a place" caveat', () => {
  assertHas(EN, 'does not guarantee a place');
  assertHas(AR, 'لا تضمن بالضرورة قبول الطالب');
});

test('step 3 states the fee is paid at the Business Office on assessment morning', () => {
  assertHas(EN, 'Business Office'); assertHas(EN, 'morning of the assessment');
  assertHas(AR, 'الخزينة المدرسية'); assertHas(AR, 'صباح يوم التقييم');
});

test('step 4 promises a decision within five (5) working days', () => {
  assertHas(EN, 'five (5) working days'); assertHas(AR, 'خمسة (5) أيام عمل');
});

test('step 5 lists all EIGHT final required documents in both languages', () => {
  for (const [block, lang] of [[EN, 'English'], [AR, 'Arabic']]) {
    const m = /s5docs:\s*\[([\s\S]*?)\]/.exec(block);
    assert(m, 's5docs array missing in ' + lang);
    const count = (m[1].match(/"/g) || []).length / 2;
    assert(count === 8, lang + ' has ' + count + ' final documents, expected 8');
  }
});

test('step 5 documents are rendered via sc-for', () => {
  assertHas(ADMISSIONS, 'list="{{ t.adm.s5docs }}"');
});

test('final documents are due before the 1st of August', () => {
  assertHas(EN, '1st of August'); assertHas(AR, 'الأول من أغسطس');
});

test('School Visits & Tours section is present in both languages', () => {
  assert(enKeys.has('visitsH') && enKeys.has('visitsD'), 'missing visits keys in English');
  assert(arKeys.has('visitsH') && arKeys.has('visitsD'), 'missing visits keys in Arabic');
  assertHas(ADMISSIONS, '{{ t.adm.visitsH }}');
});

test('Admissions Office contact details match the document', () => {
  assertHas(EN, 'admission@masters-edu.com'); assertHas(AR, 'admission@masters-edu.com');
  assert(/\+20\s?10\s?3?\s?799\s?3762|\+201037993762/.test(EN.replace(/\s+/g, ' ')), 'English phone missing');
  assertHas(AR, '+201037993762');
});

test('applications are described as open year-round in both languages', () => {
  assertHas(EN, 'year-round'); assertHas(AR, 'طوال العام');
});

/* ===================== 5. APPLICATION FORM (admission.docx) ================ */
group('5. Application form — fidelity to admission.docx');

// Every field the form document specifies -> the dictionary key implementing it
const REQUIRED_FIELDS = {
  'Personal photo': 'photo', 'Academic year': 'year',
  'First name': 'fname', 'Middle name': 'mname', 'Last name': 'lname',
  'Student full name': 'sname', 'Arabic name': 'arname',
  'Grade applying to': 'grade', 'Gender': 'gender', 'Date of birth': 'dob', 'Age': 'age',
  'Citizenship': 'citizenship', 'Country of residence': 'country',
  'Address': 'address', 'Arabic address': 'araddress', 'Email': 'email',
  'Second language': 'lang2', 'Religion': 'religion',
  'Previous school name': 'psName', 'Previous education system': 'psSystem',
  'Previous grades': 'psGrades', 'Years attended': 'psYears', 'School location': 'psLocation',
  "Father's name": 'faName', "Father's occupation": 'faOcc', "Father's occupation category": 'faOccCat',
  "Father's email": 'faEmail', "Father's address": 'faAddress', "Father's citizenship": 'faCitizenship',
  "Father's mobile": 'faMobile', 'National ID': 'faNid',
  "Mother's name": 'moName', "Mother's occupation": 'moOcc', "Mother's occupation category": 'moOccCat',
  "Mother's email": 'moEmail', "Mother's address": 'moAddress', "Mother's citizenship": 'moCitizenship',
  "Mother's mobile": 'moMobile',
  'Marital status': 'marital', 'Number of siblings': 'siblingsNo', 'Birth order': 'birthOrder',
  'Mother tongue': 'tongue', 'Guardian': 'guardian',
  'Sibling name': 'sibName', 'Sibling school': 'sibSchool', 'Sibling age': 'sibAge',
  'Sibling grade': 'sibGrade', 'Sibling applying': 'sibApply',
  'Emergency name': 'eName', 'Emergency phone': 'ePhone', 'Emergency relation': 'eRelation',
  'Emergency address': 'eAddress',
  'Health concerns': 'cHealth', 'Psychological concerns': 'cPsych', 'Academic concerns': 'cAcademic',
  'School bus': 'bus', 'Bus route': 'busRoute',
  "Guardian's National ID upload": 'd1', 'Birth certificate upload': 'd2',
  'Last stage certificate upload': 'd3', 'Other attachments upload': 'd4',
};

for (const [label, key] of Object.entries(REQUIRED_FIELDS)) {
  test(`field "${label}" is defined (en+ar) and rendered`, () => {
    assert(enKeys.has(key), 'missing English key: ' + key);
    assert(arKeys.has(key), 'missing Arabic key: ' + key);
    assertHas(FORM, '{{ t.adm.f.' + key + ' }}', 'not rendered in the form');
  });
}

test('both emergency contacts (two persons other than parents) are present', () => {
  assertHas(FORM, '{{ t.adm.f.person1 }}'); assertHas(FORM, '{{ t.adm.f.person2 }}');
  const occurrences = (FORM.match(/\{\{ t\.adm\.f\.eName \}\}/g) || []).length;
  assert(occurrences === 2, 'expected 2 emergency-contact blocks, found ' + occurrences);
});

test('all four form sections from the document are present', () => {
  for (const k of ['student', 'parent', 'emergencyH', 'otherH', 'docs', 'concernsH', 'prevH', 'sibH']) {
    assertHas(FORM, '{{ t.adm.f.' + k + ' }}', 'missing section header');
  }
});

/* --------------------------- dropdown option sets -------------------------- */
group('6. Dropdown & radio option sets');

function arrayOf(block, key) {
  const m = new RegExp(key + ':\\s*\\[([\\s\\S]*?)\\]').exec(block);
  assert(m, key + ' array not found');
  return [...m[1].matchAll(/"([^"]*)"/g)].map(x => x[1]);
}

test('academic year offers 2026/2027 and 2027/2028', () => {
  const y = arrayOf(EN, 'yearOpts');
  assert(y.length === 2, 'expected 2 options, got ' + y.length);
  assert(y.join(' ').includes('2026') && y.join(' ').includes('2027'), 'years wrong: ' + y);
});

test('grade list runs Pre-K → KG1 → KG2 → Grade 1..12 (15 options)', () => {
  const g = arrayOf(EN, 'gradeOpts');
  assert(g.length === 15, 'expected 15 grades, got ' + g.length + ': ' + g);
  assert(g[0] === 'Pre-K' && g[1] === 'KG1' && g[2] === 'KG2', 'early stages wrong: ' + g.slice(0, 3));
  assert(g[14] === 'Grade 12', 'last grade wrong: ' + g[14]);
});

test('country of residence includes Egypt, KSA and UAE', () => {
  const c = arrayOf(EN, 'countryOpts').join(' ');
  for (const n of ['Egypt', 'KSA', 'UAE']) assertHas(c, n, 'country missing');
});

test("father's occupation category = public / private / self-employed", () => {
  const o = arrayOf(EN, 'occCatFatherOpts').join(' ').toLowerCase();
  for (const n of ['public', 'private', 'self-employed']) assertHas(o, n);
});

test("mother's occupation category = public / private / housewife", () => {
  const o = arrayOf(EN, 'occCatMotherOpts').join(' ').toLowerCase();
  for (const n of ['public', 'private', 'housewife']) assertHas(o, n);
});

test('guardian list has all six relationships from the document', () => {
  const g = arrayOf(EN, 'guardianOpts');
  assert(g.length === 6, 'expected 6, got ' + g.length + ': ' + g);
  for (const n of ['Father', 'Mother', 'Grandfather']) assertHas(g.join(' '), n);
});

test('emergency relationship list covers uncle/aunt/grandparent/family friend', () => {
  const r = arrayOf(EN, 'relationOpts').join(' ').toLowerCase();
  for (const n of ['uncle', 'aunt', 'grandparent', 'family friend']) assertHas(r, n);
});

test('bus route list is populated', () => assert(arrayOf(EN, 'busRouteOpts').length >= 2, 'need routes'));

test('every option array has the same length in Arabic as in English', () => {
  for (const key of ['yearOpts', 'gradeOpts', 'countryOpts', 'occCatFatherOpts',
    'occCatMotherOpts', 'guardianOpts', 'relationOpts', 'busRouteOpts']) {
    const e = arrayOf(EN, key).length, a = arrayOf(AR, key).length;
    assert(e === a, key + ': en=' + e + ' ar=' + a);
  }
});

test('radio groups all declare a name attribute', () => {
  for (const tag of FORM.match(/<input type="radio"[^>]*>/g) || []) {
    assert(/name="/.test(tag), 'radio without name: ' + tag);
  }
});

test('radio group names are used consistently (2 options for binary choices)', () => {
  const names = (FORM.match(/<input type="radio" name="([a-zA-Z0-9]+)"/g) || [])
    .map(t => /name="([a-zA-Z0-9]+)"/.exec(t)[1]);
  const counts = names.reduce((a, n) => (a[n] = (a[n] || 0) + 1, a), {});
  assert(counts.gender === 2, 'gender radios: ' + counts.gender);
  assert(counts.lang2 === 2, 'second-language radios: ' + counts.lang2);
  assert(counts.religion === 3, 'religion radios: ' + counts.religion);
  assert(counts.marital === 4, 'marital radios: ' + counts.marital);
  assert(counts.tongue === 3, 'mother-tongue radios: ' + counts.tongue);
});

test('required document uploads accept PDF/JPG/PNG', () => {
  const fileInputs = FORM.match(/<input type="file"[^>]*>/g) || [];
  assert(fileInputs.length >= 4, 'expected at least 4 file inputs, got ' + fileInputs.length);
  const docUploads = fileInputs.filter(t => /\.pdf/.test(t));
  assert(docUploads.length >= 4, 'document uploads must accept .pdf/.jpg/.png');
});

test('the "other attachments" upload accepts multiple files', () => {
  assert(/<input type="file"[^>]*multiple/.test(FORM), 'no multiple-file input found');
});

/* ============================ 7. SUBMISSION FLOW =========================== */
group('7. Submission & state handling');

test('the form is wired to the submit handler', () => assertHas(FORM, 'onSubmit="{{ submit }}"'));

test('submit generates an application ID in the MST-2026-#### format', () => {
  assert(/appId:\s*id|"MST-2026-"/.test(SCRIPT), 'application ID generation not found');
  assertHas(SCRIPT, 'MST-2026-');
});

test('a confirmation panel exists and is gated on submitted state', () => {
  assertHas(ADMISSIONS, '<sc-if value="{{ submitted }}"');
  assertHas(ADMISSIONS, '{{ appId }}');
});

test('the form is hidden once submitted (notSubmitted guard)', () => {
  assertHas(ADMISSIONS, '<sc-if value="{{ notSubmitted }}"');
});

test('every form control carries a name (or FormData submits nothing)', () => {
  const all = FORM.match(/<(input|select|textarea)\b[^>]*>/g) || [];
  const unnamed = all.filter(t => !/\sname="/.test(t));
  assert(unnamed.length === 0,
    `${unnamed.length}/${all.length} controls have no name attribute — they are invisible to FormData`);
  return all.length;
});

test('control names are unique per field (no accidental collisions)', () => {
  const names = (FORM.match(/\sname="([A-Za-z0-9_]+)"/g) || []).map(s => /name="([A-Za-z0-9_]+)"/.exec(s)[1]);
  const counts = names.reduce((a, n) => (a[n] = (a[n] || 0) + 1, a), {});
  // radio groups legitimately share a name; everything else must be unique
  const radioNames = new Set((FORM.match(/<input type="radio" name="([A-Za-z0-9_]+)"/g) || [])
    .map(s => /name="([A-Za-z0-9_]+)"/.exec(s)[1]));
  const dupes = Object.entries(counts).filter(([n, c]) => c > 1 && !radioNames.has(n));
  assert(dupes.length === 0, 'duplicate control names: ' + dupes.map(d => d[0]).join(', '));
});

test('submission posts to a configurable endpoint', () => {
  assertHas(SCRIPT, 'applicationsEndpoint', 'no configurable endpoint');
  assertHas(SCRIPT, 'new FormData', 'form data is never collected');
  assert(/xhr\.open\(\s*"POST"|fetch\(\s*url/.test(SCRIPT), 'the application is never POSTed');
});

test('a failed submission never shows the success screen', () => {
  // whichever transport is used, every failure path must keep submitted false
  const paths = [...SCRIPT.matchAll(/(onerror|ontimeout|const fail)[\s\S]{0,220}/g)].map(m => m[0]);
  assert(paths.length >= 2, 'no failure handlers found on the submission');
  const failFn = /const fail = \(msg\) => this\.setState\(\{([\s\S]*?)\}\)/.exec(SCRIPT);
  assert(failFn, 'no shared failure handler');
  assertHas(failFn[1], 'submitted: false', 'error path does not keep the user on the form');
  assertHas(failFn[1], 'sendError', 'error is not surfaced to the user');
});

/* --------------------------- upload feedback ----------------------------- */
group('7b. Upload feedback & progress');

test('upload progress is measurable (XHR, not fetch)', () => {
  // fetch() cannot report upload progress; a 0-100% bar requires XHR.
  assert(/xhr\.upload\.onprogress/.test(SCRIPT),
    'no upload progress listener — the progress bar can never move');
  assert(/lengthComputable/.test(SCRIPT), 'progress is not guarded on lengthComputable');
});

test('a progress bar is rendered while sending, with accessible semantics', () => {
  assertHas(ADMISSIONS, 'role="progressbar"', 'no progressbar element');
  assertHas(ADMISSIONS, 'aria-valuenow="{{ uploadPercent }}"', 'progress is not exposed to screen readers');
  assertHas(ADMISSIONS, '{{ pctLabel }}', 'no numeric percentage shown');
  assertHas(ADMISSIONS, '{{ barStyle }}', 'bar width is not state-driven');
  assert(/<sc-if value="\{\{ sending \}\}"/.test(ADMISSIONS), 'progress bar is not gated on sending');
});

test('percentage is clamped to a sane 1-99 range while in flight', () => {
  assert(/Math\.max\(1,\s*Math\.min\(99/.test(SCRIPT),
    'progress is not clamped — it can show 0% or hit 100% before the server replies');
});

test('every file input reports its selection back to the user', () => {
  const inputs = FORM.match(/<input type="file"[^>]*>/g) || [];
  assert(inputs.length >= 4, 'expected at least 4 file inputs');
  for (const i of inputs) {
    assert(/onChange="\{\{ onFilePick \}\}"/.test(i),
      'a file input has no change handler, so picking a file gives no feedback: ' + i.slice(0, 80));
  }
  // the hint line under each tile must be state-driven, not a static string
  for (const slot of ['Photo', 'D1', 'D2', 'D3', 'D4']) {
    assertHas(FORM, '{{ label' + slot + ' }}', 'tile ' + slot + ' never shows the chosen file');
    assertHas(FORM, '{{ style' + slot + ' }}', 'tile ' + slot + ' never changes appearance when picked');
  }
});

test('oversized files are rejected before upload, in both languages', () => {
  assert(enKeys.has('tooLarge') && arKeys.has('tooLarge'), 'no bilingual per-file size message');
  assert(enKeys.has('totalTooLarge') && arKeys.has('totalTooLarge'), 'no bilingual total size message');
  assert(/maxFileBytes|maxTotalBytes/.test(SCRIPT), 'no size limits enforced');
  assertHas(ADMISSIONS, '{{ fileError }}', 'size errors are never displayed');
});

test('picked files are cleared when navigating away', () => {
  const m = /go\(page\).*/.exec(SCRIPT);
  assert(m && /picked:\s*\{\}/.test(m[0]),
    'file selections leak across pages — a careers CV would count toward the admissions size limit');
});

test('with no endpoint configured the confirmation admits nothing was saved', () => {
  assert(enKeys.has('demoNote') && arKeys.has('demoNote'), 'no demo-mode notice defined');
  assertHas(ADMISSIONS, '{{ t.adm.conf.demoNote }}', 'demo notice never rendered');
  assertHas(ADMISSIONS, '<sc-if value="{{ demoMode }}"', 'demo notice is not conditional');
});

test('the confirmation no longer claims an email was sent', () => {
  const conf = /conf:\s*\{([\s\S]*?)\n\s{10}\}/.exec(EN);
  assert(conf, 'conf block not found');
  assert(!/confirmation email has been sent/i.test(conf[1]),
    'the confirmation still promises an email that nothing actually sends');
});

test('the submit button reflects the sending state and is disabled while in flight', () => {
  assertHas(ADMISSIONS, '{{ submitLabel }}', 'button label is not state-driven');
  assertHas(ADMISSIONS, 'disabled="{{ sending }}"', 'button stays clickable during submission');
  assert(enKeys.has('sending') && arKeys.has('sending'), 'no bilingual "Sending…" label');
});

test('a submission error is announced to assistive tech', () => {
  assert(/role="alert"/.test(ADMISSIONS), 'the error banner has no role="alert"');
  assert(enKeys.has('errorH') && arKeys.has('errorH'), 'no bilingual error heading');
});

test('BUG: navigating between pages clears every submitted flag', () => {
  const m = /go\(page\).*/.exec(SCRIPT);
  assert(m, 'go(page) not found');
  const body = m[0];
  for (const flag of ['submitted: false', 'careerSubmitted: false', 'contactSubmitted: false']) {
    assertHas(body, flag, 'go() leaves a stale confirmation screen — missing');
  }
});

/* ======================= 8. ACCESSIBILITY / SEO / RWD ====================== */
group('8. Accessibility, SEO & responsiveness');

test('BUG: the document has a <title>', () => {
  assert(/<title>[^<]{10,}<\/title>/.test(HEAD), 'no meaningful <title> in <head> (SEO)');
});

test('BUG: the document has a meta description', () => {
  assert(/<meta\s+name="description"\s+content="[^"]{30,}"/.test(HEAD), 'no meta description (SEO)');
});

test('BUG: <html> declares a lang attribute', () => {
  assert(/<html[^>]+lang="(en|ar)"/.test(src), '<html> has no lang attribute (a11y/SEO)');
});

test('BUG: switching language updates document lang/dir', () => {
  assert(/documentElement/.test(SCRIPT), 'nothing touches document.documentElement on language change');
  assert(/documentElement\.lang|setAttribute\(\s*"lang"/.test(SCRIPT), '<html lang> is never updated');
  assert(/documentElement\.dir|setAttribute\(\s*"dir"/.test(SCRIPT), '<html dir> is never updated');
  // and the sync must actually be invoked from the toggle
  const m = /toggleLang\(\)\s*\{([\s\S]*?)\n\s{2}\}/.exec(SCRIPT);
  assert(m, 'toggleLang() not found');
  assert(/applyDocLang|documentElement/.test(m[1]), 'toggleLang() never triggers the document sync');
});

test('language switch also updates the page title & meta description', () => {
  assert(/document\.title\s*=/.test(SCRIPT), 'title is not localised on language switch');
  assert(/meta\[name="description"\]/.test(SCRIPT), 'meta description is not localised');
  for (const [block, lang] of [[EN, 'English'], [AR, 'Arabic']]) {
    // meta lives at the top level of each language dict, not inside adm
    const dict = SCRIPT.slice(SCRIPT.indexOf('\n      ' + (lang === 'English' ? 'en' : 'ar') + ': {'));
    assert(/meta:\s*\{\s*title:/.test(dict.slice(0, 600)), lang + ' dictionary has no meta.title');
  }
});

test('BUG: every text input/select/textarea is associated with a label', () => {
  const controls = (FORM.match(/<(input|select|textarea)\b[^>]*>/g) || [])
    .filter(t => !/type="(file|radio)"/.test(t));
  const withId = controls.filter(t => /\sid="/.test(t));
  assert(withId.length === controls.length,
    `${controls.length - withId.length} of ${controls.length} form controls have no id/label association (WCAG 1.3.1, 3.3.2)`);
  const forCount = (FORM.match(/<label[^>]+for="/g) || []).length;
  assert(forCount >= controls.length, `only ${forCount} labels use for=, need ${controls.length}`);
});

test('BUG: required fields keep the required attribute after runtime parsing', () => {
  const bare = (FORM.match(/\srequired\s+style=/g) || []).length;
  assert(bare === 0,
    `${bare} controls use a bare "required" attribute — the DC runtime drops it, so validation never fires. Use required="required".`);
  assert(/required="required"/.test(FORM), 'no explicitly-valued required attribute found');
});

test('BUG: two-column form grids collapse on small screens', () => {
  const fixed = (FORM.match(/grid-template-columns:1fr 1fr/g) || []).length;
  if (fixed === 0) return; // form already uses intrinsically responsive tracks
  assert(/@media[^{]*max-width[^{]*\)\s*\{[\s\S]{0,400}?grid-template-columns:\s*1fr\s*!important/.test(src),
    `${fixed} fixed "1fr 1fr" grids in the form have no collapsing media query — unusable on mobile`);
});

test('BUG: the form/sidebar split collapses on tablet and below', () => {
  if (!/grid-template-columns:1\.6fr 1fr/.test(ADMISSIONS)) return;
  assert(/@media[^{]*max-width[^{]*\)\s*\{[\s\S]{0,400}?1\.6fr/.test(src)
    || /\[style\*="grid-template-columns:1\.6fr 1fr"\]/.test(src),
    'the 1.6fr/1fr form+sidebar grid never collapses on narrow viewports');
});

// The runtime re-serialises inline styles as "prop: value" (with a space). A
// media query written against the authored spelling ("prop:value") silently
// matches nothing at runtime, so every style-substring selector must cover both.
test('BUG: responsive style-substring selectors match the RUNTIME spelling', () => {
  const selectors = [...src.matchAll(/\[style\*="([^"]+)"\]/g)].map(m => m[1]);
  assert(selectors.length > 0, 'no style-substring selectors found');
  const spaced = selectors.filter(s => /:\s/.test(s));
  assert(spaced.length > 0,
    'every [style*=...] selector uses the authored "prop:value" spelling; the runtime emits '
    + '"prop: value", so these rules never match. Add the spaced variant.');
  // each unspaced selector must have a spaced counterpart
  for (const s of selectors.filter(x => /:(?!\s)/.test(x))) {
    const twin = s.replace(/:(?!\s)/, ': ');
    assert(selectors.includes(twin), `selector "${s}" has no runtime-spelling twin "${twin}"`);
  }
});

test('the language toggle is reachable and labelled', () => {
  assertHas(TEMPLATE, '{{ toggleLang }}'); assertHas(TEMPLATE, '{{ langLabel }}');
});

test('phone/email in the contact card are forced LTR inside RTL layout', () => {
  assert(/dir="ltr"[^>]*>\{\{ t\.adm\.contactPhone|<span dir="ltr">\{\{ t\.adm\.contactPhone/.test(ADMISSIONS),
    'phone number will render mirrored in Arabic without dir="ltr"');
});

/* ========================= 9. DEPLOYMENT (VERCEL) ========================= */
group('9. Vercel deployment wiring');

const API_DIR = path.join(ROOT, 'api');
const routesSrc = fs.readFileSync(path.join(API_DIR, '_routes.js'), 'utf8');
const apiFiles = fs.readdirSync(API_DIR).filter(f => f.endsWith('.js'));

test('vercel.json exists and is valid JSON', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  const cfg = JSON.parse(raw);
  assert(cfg.headers && cfg.headers.length, 'no security headers configured');
});

test('every API route has a matching serverless entry point', () => {
  const paths = [...new Set([...routesSrc.matchAll(/path:\s*'\/api\/([a-z]+)'/g)].map(m => m[1]))];
  assert(paths.length >= 6, 'expected at least 6 routes, found ' + paths.length);
  const missing = paths.filter(p => !apiFiles.includes(p + '.js'));
  assert(missing.length === 0,
    'these routes would 404 on Vercel (no api/<name>.js): ' + missing.join(', '));
  return paths.length + ' routes';
});

test('each entry point delegates to its own path', () => {
  for (const f of apiFiles) {
    if (f.startsWith('_')) continue;
    const src = fs.readFileSync(path.join(API_DIR, f), 'utf8');
    const name = f.replace(/\.js$/, '');
    assertHas(src, `'/api/${name}'`, `api/${f} delegates to the wrong path`);
  }
});

test('shared modules are underscore-prefixed so Vercel does not expose them', () => {
  // api/_routes.js and api/_lib/* must not become public endpoints.
  assert(fs.existsSync(path.join(API_DIR, '_routes.js')), '_routes.js missing');
  assert(fs.existsSync(path.join(API_DIR, '_lib')), '_lib missing');
  const exposed = apiFiles.filter(f => !f.startsWith('_') &&
    !['applications', 'application', 'login', 'logout', 'session', 'file'].includes(f.replace(/\.js$/, '')));
  assert(exposed.length === 0, 'unexpected public endpoints: ' + exposed.join(', '));
});

test('entry points disable body parsing so uploads are not corrupted', () => {
  for (const f of apiFiles) {
    if (f.startsWith('_')) continue;
    const src = fs.readFileSync(path.join(API_DIR, f), 'utf8');
    assert(/bodyParser:\s*false/.test(src), `api/${f} lets the platform parse the body — this breaks file uploads`);
  }
});

test('production refuses the ephemeral local store', () => {
  const dispatcher = fs.readFileSync(path.join(API_DIR, '_lib', 'store.js'), 'utf8');
  assert(/VERCEL|NODE_ENV.*production/.test(dispatcher), 'no production guard on the storage driver');
  assert(/DATABASE_URL/.test(dispatcher), 'DATABASE_URL is never consulted');
});

test('the postgres driver implements the full store interface', () => {
  const local = require(path.join(API_DIR, '_lib', 'store.local.js'));
  const pg = require(path.join(API_DIR, '_lib', 'store.postgres.js'));
  const required = ['createApplication', 'listApplications', 'getApplication', 'updateApplication', 'readFile', 'STATUSES'];
  const missing = required.filter(k => pg[k] === undefined);
  assert(missing.length === 0, 'postgres driver missing: ' + missing.join(', '));
  assert(JSON.stringify(pg.STATUSES) === JSON.stringify(local.STATUSES), 'drivers disagree on the status list');
});

test('BUG: no "start" script — it would make the host run server.js as a catch-all', () => {
  // With a "start" script the platform runs server.js for EVERY route, which
  // shadows CDN static serving. Static assets are not bundled into a function,
  // so index.html then 404s ("Not found: /index.html"). Static files must be
  // served by the CDN and only api/* by functions.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(!pkg.scripts.start,
    'a "start" script is defined — the host will run server.js as a catch-all and static files will 404. Use "serve" for local runs.');
});

test('BUG: auto-run scripts use no version-gated Node flags', () => {
  // A flag the deployed Node build does not recognise kills the process at boot,
  // so nothing listens and every request hangs with no HTTP response at all.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const risky = ['--env-file', '--experimental', '--loader', '--watch'];
  for (const name of ['start', 'build', 'serve']) {
    const script = pkg.scripts[name] || '';
    const hit = risky.filter(f => script.includes(f));
    assert(hit.length === 0,
      `"${name}" uses ${hit.join(', ')} — an older deployed Node exits at boot. Keep such flags in "dev" only.`);
  }
});

test('static assets exist at the repo root for the CDN to serve', () => {
  for (const f of ['index.html', 'admin.html', 'support.js', 'image-slot.js']) {
    assert(fs.existsSync(path.join(ROOT, f)), `${f} missing from the repo root — the CDN has nothing to serve`);
  }
});

test('the Node version is pinned to a major, not an open range', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const node = (pkg.engines || {}).node || '';
  assert(node && !/^>=/.test(node),
    `engines.node is "${node}" — an open range lets the platform pick an old Node. Pin a major (e.g. "22.x").`);
});

test('applicant data is gitignored', () => {
  const ig = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assertHas(ig, 'data/', 'submitted applications would be committed to git');
  assertHas(ig, 'node_modules', 'node_modules is not ignored');
});

/* ================================= report ================================= */
console.log('\n' + '─'.repeat(64));
console.log(`  ${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail) {
  console.log('\n\x1b[31mFailures:\x1b[0m');
  failures.forEach(([n, m], i) => console.log(`  ${i + 1}. ${n}\n     ${m}`));
}
console.log('─'.repeat(64));
process.exit(fail ? 1 : 0);
