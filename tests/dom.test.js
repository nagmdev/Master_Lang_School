/*
 * Masters School — Admissions feature: runtime (DOM) test suite
 *
 * The site is a DC-runtime SPA with no build step, so these tests run IN THE PAGE.
 * Usage:
 *   1. Start the dev server (see .claude/launch.json) → http://localhost:8123
 *   2. Open it, then paste this whole file into the browser DevTools console.
 *   3. Read the printed table; the call resolves to a JSON summary.
 *
 * It drives the real UI: navigates to Admissions, switches EN↔AR, checks RTL and
 * <html lang>, counts controls, verifies the three business edits are on screen,
 * submits the form, and asserts confirmation state resets when navigating away.
 *
 * NOTE: every interaction must be awaited — React re-renders asynchronously, so
 * asserting synchronously after a click or submit reads the *previous* DOM.
 */
(async function runAdmissionsDomTests() {
  'use strict';

  const results = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SETTLE = 200; // ms to let React commit a re-render

  async function check(name, fn) {
    try { const d = await fn(); results.push({ name, pass: true, detail: d || '' }); }
    catch (e) { results.push({ name, pass: false, detail: e.message }); }
  }
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  const txt = () => document.body.innerText;
  const controls = () => document.querySelectorAll('input, select, textarea');

  // --- UI drivers -----------------------------------------------------------
  async function goTo(labelRe) {
    const b = [...document.querySelectorAll('nav button')]
      .find(x => labelRe.test(x.innerText.trim()));
    assert(b, 'nav button not found for ' + labelRe);
    b.click(); await sleep(SETTLE);
  }
  async function toggleLanguage() {
    const b = [...document.querySelectorAll('button')]
      .find(x => /^(العربية|English)$/.test(x.innerText.trim()));
    assert(b, 'language toggle not found');
    b.click(); await sleep(SETTLE);
  }
  // Values must satisfy each control's own validation (an email field will reject
  // "Test"), otherwise requestSubmit() silently blocks and the test reads as a
  // product failure when it is really bad test data.
  const SAMPLE = {
    email: 'parent@example.com', tel: '01000000000', number: '5',
    url: 'https://example.com', date: '2019-05-10', text: 'Test',
  };
  function fillRequired(form) {
    form.querySelectorAll('[required]').forEach(el => {
      if (el.tagName === 'SELECT') { if (el.selectedIndex < 0) el.selectedIndex = 0; return; }
      el.value = SAMPLE[el.type] || SAMPLE.text;
    });
    const bad = [...form.querySelectorAll(':invalid')];
    if (bad.length) throw new Error('could not satisfy: ' +
      bad.map(b => `${b.type}#${b.id}: ${b.validationMessage}`).join(' | '));
  }
  const isArabic = () => /الرئيسية|القبول والتسجيل/.test(txt());

  // Start from a clean English state on the Admissions page
  if (isArabic()) await toggleLanguage();
  await goTo(/^Admissions$/i);

  /* ------------------------- English rendering ---------------------------- */
  await check('admissions page renders the journey heading', () => {
    assert(/Your step-by-step path to Masters/.test(txt()));
  });

  await check('all five journey steps render', () => {
    const steps = ['Online Application', 'Document Submission', 'Student Assessment',
      'Results & Preliminary Registration', 'Final Required Documents'];
    const missing = steps.filter(s => !txt().includes(s));
    assert(missing.length === 0, 'missing steps: ' + missing.join(', '));
    return steps.length + ' steps';
  });

  await check('EDIT 1 — assessment fee shows 600 EGP', () => {
    assert(/600 EGP/.test(txt()), 'fee not shown as 600 EGP');
  });

  await check('EDIT 2 — acceptance requires the first installment fee', () => {
    assert(/first installment fee is required/.test(txt()));
  });

  await check('EDIT 2 — no 10,000 EGP registration fee anywhere on the page', () => {
    assert(!/10,000|10000/.test(txt()), 'stale 10,000 EGP fee still rendered');
  });

  await check('EDIT 1 — no stale 2,000 EGP assessment fee', () => {
    assert(!/2,000|2000 EGP/.test(txt()), 'stale 2,000 EGP fee still rendered');
  });

  await check('all eight final documents are listed', () => {
    const docs = ['passport-sized colored photographs', 'birth certificate', 'National IDs',
      'vaccination certificate', 'end-of-year reports', 'Good Conduct',
      'Study Sequence Certificate', 'transfer forms'];
    const missing = docs.filter(d => !txt().includes(d));
    assert(missing.length === 0, 'missing: ' + missing.join(', '));
    return '8 documents';
  });

  await check('admissions office contact is shown', () => {
    assert(/admission@masters-edu\.com/.test(txt()), 'email missing');
    assert(/799\s?3762/.test(txt()), 'phone missing');
  });

  /* ---------------------------- form structure ---------------------------- */
  let enControlCount = 0;
  await check('the application form renders a substantial field set', () => {
    enControlCount = controls().length;
    assert(enControlCount >= 60, 'only ' + enControlCount + ' controls, expected 60+');
    return enControlCount + ' controls';
  });

  await check('student name fields appear in document order', () => {
    const labels = [...document.querySelectorAll('label')].map(l => l.innerText.trim().split('\n')[0]);
    const order = labels.filter(l => /First name|Middle name|Last name|Student full name|Full name in Arabic/.test(l));
    assert(order.length === 5, 'expected 5 name fields, got ' + order.length + ': ' + order);
    assert(/First/.test(order[0]) && /Middle/.test(order[1]) && /Last/.test(order[2])
      && /Student full name/.test(order[3]) && /Arabic/.test(order[4]), 'wrong order: ' + order);
    return order.join(' → ');
  });

  await check('no label renders blank (every binding resolves)', () => {
    const blank = [...document.querySelectorAll('label')].filter(l => !l.innerText.trim()).length;
    assert(blank === 0, blank + ' labels rendered empty');
  });

  await check('grade dropdown starts at Pre-K and ends at Grade 12', () => {
    const sel = [...document.querySelectorAll('select')]
      .find(s => [...s.options].some(o => o.text === 'Pre-K'));
    assert(sel, 'grade dropdown not found');
    const opts = [...sel.options].map(o => o.text);
    assert(opts.length === 15, 'expected 15 grades, got ' + opts.length);
    assert(opts[0] === 'Pre-K' && opts[opts.length - 1] === 'Grade 12', 'wrong range');
    return opts.length + ' grades';
  });

  await check('radio groups are functional and mutually exclusive', () => {
    const names = [...new Set([...document.querySelectorAll('input[type=radio]')].map(r => r.name))];
    assert(names.length >= 5, 'expected 5+ radio groups, got ' + names.join(','));
    const g = document.querySelectorAll('input[type=radio][name=gender]');
    assert(g.length === 2, 'gender group should have 2 options');
    g[0].click();
    assert(g[0].checked && !g[1].checked, 'radios are not mutually exclusive');
    return names.length + ' groups';
  });

  await check('REGRESSION — required fields carry a working required attribute', () => {
    const req = document.querySelectorAll('[required]').length;
    assert(req > 0, 'the DC runtime stripped every required attribute — validation never fires');
    const form = document.querySelector('form');
    assert(form.checkValidity() === false, 'an empty form should be invalid but reports valid');
    return req + ' required controls';
  });

  await check('REGRESSION — every text control is associated with a label', () => {
    const list = [...controls()].filter(c => c.type !== 'file' && c.type !== 'radio');
    const unlabelled = list.filter(c => {
      if (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)) return false;
      return !c.closest('label');
    });
    assert(unlabelled.length === 0,
      `${unlabelled.length}/${list.length} controls have no associated label (WCAG 1.3.1/3.3.2)`);
    return list.length + ' controls labelled';
  });

  await check('REGRESSION — responsive grid rules actually match rendered elements', () => {
    // Guards the bug where the media query was written against the authored
    // spelling ("prop:value") while the runtime emits "prop: value".
    const twoCol = document.querySelectorAll('[style*="grid-template-columns: 1fr 1fr"]').length;
    assert(twoCol > 0, 'no rendered two-column grids found — selector spelling has drifted');
    let matched = 0;
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of rules || []) {
        if (rule.type !== CSSRule.MEDIA_RULE) continue;
        for (const inner of rule.cssRules || []) {
          if (!inner.selectorText || !/grid-template-columns/.test(inner.selectorText)) continue;
          try { matched += document.querySelectorAll(inner.selectorText).length; } catch (e) {}
        }
      }
    }
    assert(matched > 0,
      'the responsive media-query selectors match ZERO rendered elements — the layout will never collapse');
    return matched + ' elements covered';
  });

  await check('REGRESSION — the form actually serialises its data', () => {
    // Without name attributes FormData yields nothing, so any backend would
    // receive an empty application no matter how well it is wired up.
    const form = document.querySelector('form');
    const named = form.querySelectorAll('[name]').length;
    const total = form.querySelectorAll('input, select, textarea').length;
    assert(named === total, `${total - named} of ${total} controls have no name attribute`);
    const el = form.querySelector('[name="fname"]');
    assert(el, 'first-name control not found by name');
    el.value = 'Yara';
    const fd = new FormData(form);
    assert(fd.get('fname') === 'Yara', 'field values are not captured by FormData');
    assert([...fd.entries()].length > 40, 'only ' + [...fd.entries()].length + ' fields serialised');
    el.value = '';
    return [...fd.entries()].length + ' fields serialised';
  });

  await check('REGRESSION — submit button is enabled and state-driven', () => {
    // disabled="{{ sending }}" must resolve to a real boolean; a stringified
    // "false" would be truthy and permanently disable the button.
    const btn = document.querySelector('form button[type=submit]');
    assert(btn, 'submit button not found');
    assert(btn.disabled === false, 'submit button is disabled while idle — parents cannot apply');
    assert(/Submit application/i.test(btn.innerText), 'unexpected button label: ' + btn.innerText);
  });

  await check('clicking a label focuses its control', () => {
    const input = [...controls()].find(c => c.id && c.type === 'text');
    assert(input, 'no identifiable text input');
    const lab = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    assert(lab, 'no label points at ' + input.id);
    lab.click();
    assert(document.activeElement === input, 'label click did not focus the control');
    return input.id;
  });

  /* ------------------------------ Arabic / RTL ---------------------------- */
  await toggleLanguage();

  await check('switching to Arabic flips the layout to RTL', () => {
    const el = document.querySelector('[dir]');
    assert(el && el.getAttribute('dir') === 'rtl', 'dir is not rtl');
  });

  await check('REGRESSION — <html> lang/dir follow the language switch', () => {
    assert(document.documentElement.lang === 'ar',
      'documentElement.lang is "' + document.documentElement.lang + '", expected "ar"');
    assert(document.documentElement.dir === 'rtl', 'documentElement.dir is not rtl');
    return 'lang=ar dir=rtl';
  });

  await check('REGRESSION — page title is localised to Arabic', () => {
    assert(/ماسترز/.test(document.title), 'title not localised: ' + document.title);
    return document.title;
  });

  await check('Arabic journey content renders', () => {
    assert(/طريقك إلى ماسترز/.test(txt()), 'Arabic journey heading missing');
    assert(/التقديم الإلكتروني/.test(txt()), 'Arabic step 1 missing');
    assert(/رحلة القبول/.test(txt()), 'Arabic eyebrow missing');
  });

  await check('EDIT 1 (Arabic) — assessment fee shows 600 جنيه', () => {
    assert(/600 جنيه مصري/.test(txt()));
  });

  await check('EDIT 2 (Arabic) — first installment wording present, 10,000 gone', () => {
    assert(/رسوم القسط الأول/.test(txt()), 'first installment wording missing');
    assert(!/10,000|10000|١٠٠٠٠/.test(txt()), 'stale 10,000 fee still present');
  });

  await check('Arabic renders the same number of form controls as English', () => {
    const ar = controls().length;
    assert(ar === enControlCount, `ar=${ar} vs en=${enControlCount}`);
    return ar + ' controls';
  });

  await check('no blank labels in Arabic', () => {
    const blank = [...document.querySelectorAll('label')].filter(l => !l.innerText.trim()).length;
    assert(blank === 0, blank + ' Arabic labels rendered empty');
  });

  await check('Arabic phone renders left-to-right inside the RTL layout', () => {
    const ltr = [...document.querySelectorAll('[dir="ltr"]')]
      .some(e => /799\s?3762|\+201037993762/.test(e.innerText));
    assert(ltr, 'phone is not wrapped in dir="ltr" — it will display mirrored');
  });

  await toggleLanguage(); // back to English

  await check('REGRESSION — <html> lang returns to en', () => {
    assert(document.documentElement.lang === 'en', 'lang=' + document.documentElement.lang);
  });

  /* --------------------------- upload feedback ---------------------------- */

  await check('picking a file confirms the filename and size on the tile', async () => {
    const form = document.querySelector('form');
    const input = form.querySelector('input[type=file][name="d2"]');
    assert(input, 'birth-certificate input not found');
    const tile = input.closest('label');
    const before = tile.innerText.replace(/\s+/g, ' ').trim();

    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(1500000)], 'birth-certificate.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(SETTLE);

    const after = tile.innerText.replace(/\s+/g, ' ').trim();
    assert(after !== before, 'the tile still reads "Upload file" — a parent cannot tell the file registered');
    assert(/birth-certificate\.pdf/.test(after), 'filename not shown: ' + after);
    assert(/1\.4 MB|1\.5 MB/.test(after), 'file size not shown: ' + after);
    return after;
  });

  await check('an oversized file is rejected with a clear message', async () => {
    const form = document.querySelector('form');
    const input = form.querySelector('input[type=file][name="d3"]');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(6 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(SETTLE);
    assert(/too large/i.test(txt()), 'no size error shown for a 6 MB file');
    assert(input.files.length === 0, 'the oversized file was left attached');
    return 'rejected + input cleared';
  });

  await check('progress bar tracks a slow upload from 0 → 100', async () => {
    // Loopback uploads finish in ~60ms and emit a single 100% event, so a real
    // submission can never demonstrate the bar moving. Substitute a stand-in
    // XMLHttpRequest that emits staged progress, proving the wiring end to end.
    const RealXHR = window.XMLHttpRequest;
    const seen = new Set();
    function FakeXHR() {
      this.upload = {};
      this.status = 201;
      this.responseText = JSON.stringify({ applicationId: 'MST-2026-4242' });
    }
    FakeXHR.prototype.open = function () {};
    FakeXHR.prototype.setRequestHeader = function () {};
    FakeXHR.prototype.send = function () {
      const steps = [12, 40, 73, 100];
      let i = 0;
      const tick = () => {
        if (i < steps.length) {
          const p = steps[i++];
          if (this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded: p, total: 100 });
          setTimeout(tick, 70);
        } else {
          if (this.upload.onload) this.upload.onload();
          if (this.onload) this.onload();
        }
      };
      setTimeout(tick, 40);
    };
    window.XMLHttpRequest = FakeXHR;

    const poll = setInterval(() => {
      const bar = document.querySelector('[role="progressbar"]');
      if (bar) seen.add(Number(bar.getAttribute('aria-valuenow')));
    }, 15);

    try {
      const form = document.querySelector('form');
      fillRequired(form);
      form.requestSubmit();
      await sleep(700);
    } finally {
      clearInterval(poll);
      window.XMLHttpRequest = RealXHR;
    }

    const vals = [...seen].filter(n => !isNaN(n)).sort((a, b) => a - b);
    assert(vals.some(v => v > 0 && v < 100),
      'the bar never showed an intermediate percentage — progress is not wired to the UI. Saw: ' + vals.join(','));
    assert(vals.length >= 2, 'progress never changed value. Saw: ' + vals.join(','));
    assert(/Application received/.test(txt()), 'the simulated upload did not complete');
    assert(/MST-2026-4242/.test(txt()), 'the server-issued id was not used');
    return 'percentages seen: ' + vals.join(' → ');
  });

  // back to a fresh admissions form for the real submission checks
  await goTo(/^Home$/i);
  await goTo(/^Admissions$/i);

  /* ---------------------------- submission flow --------------------------- */
  let appId = '';
  await check('submitting the application shows the confirmation with an ID', async () => {
    const form = document.querySelector('form');
    assert(form, 'form not found');
    fillRequired(form);
    assert(form.checkValidity(), 'form still invalid after filling required fields');
    form.requestSubmit();
    await sleep(SETTLE);
    assert(/Application received/.test(txt()), 'confirmation panel did not render');
    const m = /MST-2026-\d{4}/.exec(txt());
    assert(m, 'no application ID in MST-2026-#### format');
    appId = m[0];
    return appId;
  });

  await check('the form is hidden once submitted', () => {
    assert(!document.querySelector('form'), 'form still visible after submission');
  });

  await check('the confirmation tells the truth for the current mode', () => {
    const t = txt();
    const live = !!(window.MS_CONFIG && window.MS_CONFIG.applicationsEndpoint);
    assert(!/confirmation email has been sent/i.test(t),
      'claims a confirmation email was sent, but nothing sends one');
    if (live) {
      assert(!/Demo mode/i.test(t), 'shows a demo warning even though an endpoint is configured');
      assert(/MST-\d{4}-\d{4}/.test(t), 'no application id shown');
      return 'live — id issued by the server';
    }
    assert(/Demo mode/i.test(t),
      'no demo disclosure — a parent is told it succeeded when nothing was saved');
    return 'demo — disclosed';
  });

  await check('a live submission is persisted, and its detail requires a session', async () => {
    if (!(window.MS_CONFIG && window.MS_CONFIG.applicationsEndpoint)) return 'skipped (demo mode)';
    const id = (/MST-\d{4}-\d{4}/.exec(txt()) || [])[0];
    assert(id, 'no application id on the confirmation screen');
    // Drop any admin session this browser may already hold, otherwise the check
    // below passes for the wrong reason (an authorised admin legitimately gets 200).
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    const res = await fetch('/api/application?id=' + encodeURIComponent(id), { credentials: 'same-origin' });
    assert(res.status === 401,
      'a parent application is readable without signing in (status ' + res.status + ')');
    return id + ' stored, detail protected';
  });

  /* --------------------------- state reset (bug) -------------------------- */
  await goTo(/^Careers$/i);
  await check('REGRESSION — admissions confirmation does not leak onto other pages', () => {
    assert(!/Application received/.test(txt()), 'admissions confirmation leaked onto Careers');
  });

  await check('REGRESSION — careers confirmation clears when navigating away and back', async () => {
    const form = document.querySelector('form');
    assert(form, 'careers form not found');
    fillRequired(form);
    form.requestSubmit();
    await sleep(SETTLE);
    assert(/Thank you for applying|MST-HR-/.test(txt()), 'careers form did not submit');
    await goTo(/^Admissions$/i);
    await goTo(/^Careers$/i);
    assert(!/Thank you for applying|MST-HR-/.test(txt()),
      'stale careers confirmation persists — go() does not reset careerSubmitted');
    assert(document.querySelector('form'), 'careers form did not come back');
    return 'reset correctly';
  });

  await goTo(/^Home$/i);

  /* --------------------------------- report -------------------------------- */
  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  console.table(results.map(r => ({ test: r.name, result: r.pass ? 'PASS' : 'FAIL', detail: r.detail })));
  console.log(`%c${passed} passed, ${failed} failed, ${results.length} total`,
    `font-weight:bold;color:${failed ? '#c0392b' : '#27ae60'}`);
  return { passed, failed, total: results.length, failures: results.filter(r => !r.pass) };
})();
