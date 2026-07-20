/*
 * Masters School — admin dashboard: runtime (DOM) test suite
 *
 * Usage:
 *   1. Start the server:  npm run dev
 *   2. Open http://localhost:8123/admin.html
 *   3. Paste this file into the DevTools console (it signs in for you), or:
 *        fetch('/tests/admin.test.js').then(r=>r.text()).then(t=>eval(t)).then(console.log)
 *
 * Covers the behaviours that are easy to break silently: the Refresh button,
 * status switching, notes auto-save, status filters and search.
 *
 * Set window.MS_TEST_PASSWORD before running if the password is not the default.
 */
(async function runAdminTests() {
  'use strict';

  const results = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SETTLE = 700;
  const $ = s => document.querySelector(s);
  const rows = () => [...document.querySelectorAll('#rows tr')];
  const chipText = () => [...document.querySelectorAll('.chip')].map(c => c.innerText.replace(/\s+/g, ' ').trim());
  const chip = re => [...document.querySelectorAll('.chip')].find(c => re.test(c.innerText));

  async function check(name, fn) {
    try { const d = await fn(); results.push({ name, pass: true, detail: d || '' }); }
    catch (e) { results.push({ name, pass: false, detail: e.message }); }
  }
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

  /* --------------------------------- sign in -------------------------------- */
  if (!$('#app-view') || $('#app-view').classList.contains('hidden')) {
    $('#pw').value = window.MS_TEST_PASSWORD || 'Masters@Gharbia#2004';
    $('#login-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await sleep(900);
  }
  await check('signs in and lists applications', () => {
    assert(!$('#app-view').classList.contains('hidden'), 'dashboard did not open — wrong password?');
    assert(rows().length > 0, 'no applications to test against — submit one first');
    return rows().length + ' rows';
  });
  if (!rows().length) { console.warn('[admin tests] no data; aborting'); return { passed: 0, failed: 1, total: 1 }; }

  /* -------------------------------- refresh --------------------------------- */
  await check('REGRESSION — Refresh reloads and restores its own label', async () => {
    const btn = $('#refresh');
    const before = rows().length;
    btn.click();
    await sleep(SETTLE);
    assert(rows().length === before, `row count changed unexpectedly (${before} → ${rows().length})`);
    assert(btn.disabled === false, 'button left disabled after refreshing');
    assert(/Refresh/i.test(btn.textContent), 'label not restored: ' + btn.textContent);
    assert($('#list-error').classList.contains('hidden'), 'an error banner is showing');
    return before + ' rows reloaded';
  });

  await check('REGRESSION — a failed load surfaces an error instead of failing silently', async () => {
    const realFetch = window.fetch;
    window.fetch = () => Promise.resolve(new Response('boom', { status: 500 }));
    try {
      $('#refresh').click();
      await sleep(SETTLE);
      assert(!$('#list-error').classList.contains('hidden'),
        'load failed but nothing was shown to the user');
      return $('#list-error').textContent.slice(0, 40);
    } finally {
      window.fetch = realFetch;
      $('#refresh').click();
      await sleep(SETTLE);
    }
  });

  /* ---------------------------- status switching ---------------------------- */
  let appId = '';
  await check('status can be switched, and saves without a button', async () => {
    rows()[0].click();
    await sleep(SETTLE);
    appId = $('#d-id').textContent.trim();
    const sel = $('#d-status');
    assert(sel, 'no status dropdown in the drawer');
    const opts = [...sel.options].map(o => o.value);
    for (const s of ['new', 'reviewing', 'assessment_booked', 'accepted', 'rejected', 'withdrawn']) {
      assert(opts.includes(s), 'missing status option: ' + s);
    }
    sel.value = 'reviewing';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(SETTLE + 200);
    const server = await fetch('/api/application?id=' + encodeURIComponent(appId), { credentials: 'same-origin' }).then(r => r.json());
    assert(server.status === 'reviewing', 'server still reports status ' + server.status);
    return opts.length + ' statuses, saved as "reviewing"';
  });

  await check('the filter counts update the moment a status changes', () => {
    const txt = chipText().join(' ');
    assert(/Reviewing\s*[1-9]/.test(txt), 'Reviewing count did not increase: ' + txt);
    return txt;
  });

  await check('internal notes auto-save on blur', async () => {
    const nt = $('#d-notes');
    assert(nt, 'no notes field');
    const value = 'Called the parent — test ' + rows().length;
    nt.value = value;
    nt.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(SETTLE + 200);
    const server = await fetch('/api/application?id=' + encodeURIComponent(appId), { credentials: 'same-origin' }).then(r => r.json());
    assert(server.notes === value, 'server has notes: ' + JSON.stringify(server.notes));
    return 'persisted';
  });

  $('#close-drawer').click();
  await sleep(300);

  /* -------------------------------- filters --------------------------------- */
  await check('status filter narrows the list to that status only', async () => {
    chip(/Reviewing/i).click();
    await sleep(SETTLE);
    assert(rows().length > 0, 'Reviewing filter returned nothing');
    for (const r of rows()) {
      assert(/Reviewing/i.test(r.innerText), 'a non-Reviewing row leaked into the filter: ' + r.innerText);
    }
    return rows().length + ' row(s)';
  });

  await check('the All filter restores every application', async () => {
    const reviewing = rows().length;
    chip(/^All/).click();
    await sleep(SETTLE);
    assert(rows().length >= reviewing, `All (${rows().length}) should be >= Reviewing (${reviewing})`);
    return rows().length + ' rows';
  });

  await check('an empty status bucket shows zero rows, not everything', async () => {
    const withdrawn = chip(/Withdrawn/i);
    const count = Number((withdrawn.innerText.match(/(\d+)\s*$/) || [0, 0])[1]);
    withdrawn.click();
    await sleep(SETTLE);
    assert(rows().length === count, `chip says ${count} but ${rows().length} rows rendered`);
    chip(/^All/).click();
    await sleep(SETTLE);
    return count + ' matches the chip';
  });

  /* --------------------------------- search --------------------------------- */
  await check('search finds an applicant by name', async () => {
    const name = rows()[0].children[1].innerText.trim().split(' ')[0];
    $('#q').value = name;
    $('#search-btn').click();
    await sleep(SETTLE);
    assert(rows().length > 0, 'search for "' + name + '" returned nothing');
    for (const r of rows()) assert(new RegExp(name, 'i').test(r.innerText), 'unrelated row in results');
    return `"${name}" → ${rows().length} row(s)`;
  });

  await check('search matches on application id', async () => {
    $('#q').value = '';
    $('#search-btn').click();
    await sleep(SETTLE);
    const id = rows()[0].children[0].innerText.trim();
    $('#q').value = id;
    $('#search-btn').click();
    await sleep(SETTLE);
    assert(rows().length === 1, `expected exactly 1 row for ${id}, got ${rows().length}`);
    return id;
  });

  await check('a search with no matches shows an explanatory empty state', async () => {
    $('#q').value = 'zzzz-no-such-applicant';
    $('#search-btn').click();
    await sleep(SETTLE);
    assert(rows().length === 0, 'expected no rows');
    assert(/No applications match/i.test($('#empty').innerText), 'no empty-state message shown');
    return $('#empty').innerText;
  });

  await check('clearing the search restores the full list', async () => {
    $('#q').value = '';
    $('#search-btn').click();
    await sleep(SETTLE);
    assert(rows().length > 0, 'list stayed empty after clearing the search');
    return rows().length + ' rows';
  });

  /* --------------------------------- report --------------------------------- */
  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  console.table(results.map(r => ({ test: r.name, result: r.pass ? 'PASS' : 'FAIL', detail: r.detail })));
  console.log(`%c${passed} passed, ${failed} failed, ${results.length} total`,
    `font-weight:bold;color:${failed ? '#c0392b' : '#27ae60'}`);
  return { passed, failed, total: results.length, failures: results.filter(r => !r.pass) };
})();
