/*
 * Masters School — generates <slug>.html + apply-<slug>.html for jobs that
 * exist in the store but have no hand-written static page yet.
 *
 * New positions are created from the admin dashboard (POST /api/jobs). The
 * 14 seed jobs already have hand-written pages; anything else is rendered by
 * this tool from the two canonical templates (german-teacher.html and
 * apply-german-teacher.html), embedding the job payload as window.MS_JOB so
 * careers.js can render it without touching the dictionary:
 *
 *   node tools/generate-job-pages.js                # data/jobs.json (or seed)
 *   node tools/generate-job-pages.js --jobs x.json # explicit job list
 *   node tools/generate-job-pages.js --force       # rewrite existing pages
 *   node tools/generate-job-pages.js --out tmp/    # write elsewhere (test)
 *
 * The generated pages use cfg WITHOUT `index` (the dictionary has no entry
 * for them) and rely on the embedded payload / live /api/jobs list.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readArgs() {
  const out = { jobsFile: '', force: false, outDir: '' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--jobs') out.jobsFile = argv[++i] || '';
    else if (argv[i] === '--force') out.force = true;
    else if (argv[i] === '--out') out.outDir = argv[++i] || '';
  }
  return out;
}

function slugify(title) {
  return String(title || 'job')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'job';
}

function jobsFromFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const list = JSON.parse(raw);
  return (Array.isArray(list) ? list : (list.jobs || [])).filter((j) => j && j.id && j.en && j.ar);
}

function defaultJobs() {
  const dataFile = path.join(process.env.MS_DATA_DIR || path.join(ROOT, 'data'), 'jobs.json');
  if (fs.existsSync(dataFile)) return jobsFromFile(dataFile);
  // Fall back to the seed (the 14 canonical jobs — normally no-op).
  const seed = require(path.join(ROOT, 'api', '_lib', 'jobs.seed.js')).SEED_JOBS;
  return seed.filter((j) => j && j.id && j.en && j.ar);
}

// The canonical templates carry the hand-written chrome; we swap the
// per-job parts (title, meta description, cfg) and inject the payload.
function loadTemplate(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// "Teach German to bilingual learners from Kindergarten to Secondary,
//  building fluency..." -> "Teach German to bilingual learners from
//  Kindergarten to Secondary at Masters Language School in El Santa,
//  Gharbia — apply online today."
function jobMeta(en) {
  const cut = String(en.desc || '').split(/,\s*|—/)[0].replace(/\.+$/, '').trim();
  return cut + ' at Masters Language School in El Santa, Gharbia — apply online today.';
}

function payloadScript(job) {
  const json = JSON.stringify({ id: job.id, en: job.en, ar: job.ar })
    .replace(/<\//g, '<\\/');
  return '<script>\n  window.MS_JOB = ' + json + ';\n</script>';
}

function renderJobPage(tpl, job, cfgIndex) {
  let out = tpl;
  out = out.replace(/<title>[\s\S]*?<\/title>/,
    '<title>' + job.en.r + ' — Careers | Masters Language School</title>');
  out = out.replace(/<meta name="description" content="[\s\S]*?">/,
    '<meta name="description" content="' + jobMeta(job.en) + '">');
  // Jobs without a hand-written page embed their payload; the canonical jobs
  // stay byte-identical to their committed pages (index-based cfg, no embed).
  if (cfgIndex === undefined) {
    out = out.replace(/(<script>\s*\n\s*window\.MS_CONFIG = [\s\S]*?<\/script>)/,
      '$1\n' + payloadScript(job));
  }
  const cfg = (cfgIndex === undefined)
    ? '{ mode: "job", slug: "' + job.id + '" }'
    : '{ mode: "job", slug: "' + job.id + '", index: ' + cfgIndex + ' }';
  out = out.replace(/static cfg = \{[^}]*\};/, 'static cfg = ' + cfg + ';');
  return out;
}

function renderApplyPage(tpl, job, cfgIndex) {
  let out = tpl;
  out = out.replace(/<title>[\s\S]*?<\/title>/,
    '<title>Application — ' + job.en.r + ' | Masters Language School</title>');
  out = out.replace(/<meta name="description" content="[\s\S]*?">/,
    '<meta name="description" content="Application form for the ' + job.en.r +
    ' position at Masters Language School in El Santa, Gharbia.">');
  if (cfgIndex === undefined) {
    out = out.replace(/(<script>\s*\n\s*window\.MS_CONFIG = [\s\S]*?<\/script>)/,
      '$1\n' + payloadScript(job));
  }
  const cfg = (cfgIndex === undefined)
    ? '{ mode: "apply", slug: "' + job.id + '" }'
    : '{ mode: "apply", slug: "' + job.id + '", index: ' + cfgIndex + ' }';
  out = out.replace(/static cfg = \{[^}]*\};/, 'static cfg = ' + cfg + ';');
  return out;
}

function main() {
  const args = readArgs();
  const jobs = args.jobsFile ? jobsFromFile(args.jobsFile) : defaultJobs();
  const outDir = args.outDir ? path.resolve(args.outDir) : ROOT;

  // Index of slugs with hand-written pages (from careers.js).
  const careersSrc = fs.readFileSync(path.join(ROOT, 'careers.js'), 'utf8');
  const m = careersSrc.match(/var SLUGS = \[([\s\S]*?)\];/);
  const SLUGS = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);

  const jobTpl = loadTemplate('german-teacher.html');
  const applyTpl = loadTemplate('apply-german-teacher.html');

  let created = 0, skipped = 0, rewrote = 0, bad = [];
  for (const job of jobs) {
    if (!job.en.r || !job.ar.r) { bad.push(job.id + ' (missing en/ar r)'); continue; }
    const idx = SLUGS.indexOf(job.id);
    const cfgIndex = idx === -1 ? undefined : idx;
    const target = path.join(outDir, job.id + '.html');
    const targetApply = path.join(outDir, 'apply-' + job.id + '.html');
    if (fs.existsSync(target) && fs.existsSync(targetApply) && !args.force) {
      skipped++;
      continue;
    }
    if (cfgIndex === undefined && !fs.existsSync(path.join(ROOT, 'data', 'jobs.json')) && !args.jobsFile) {
      // Job not in the canonical SLUGS list but no store present: this is the
      // seed fallback path — such ids would never appear via the seed alone.
      skipped++;
      continue;
    }
    const html = renderJobPage(jobTpl, job, cfgIndex);
    const apply = renderApplyPage(applyTpl, job, cfgIndex);
    const existed = fs.existsSync(target) && fs.existsSync(targetApply);
    fs.writeFileSync(target, html, 'utf8');
    fs.writeFileSync(targetApply, apply, 'utf8');
    if (existed) rewrote++; else created++;
    console.log('wrote ' + path.basename(target) + ' + ' + path.basename(targetApply));
  }
  console.log('jobs seen: ' + jobs.length + '; created: ' + created + '; rewrote: ' +
    rewrote + '; skipped (pages exist): ' + skipped + (bad.length ? '; BAD: ' + bad.join(', ') : ''));
}

if (require.main === module) main();

module.exports = { renderJobPage, renderApplyPage, jobMeta, payloadScript, readArgs };
