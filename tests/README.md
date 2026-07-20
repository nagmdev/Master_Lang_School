# Tests — Admissions feature

Three suites, all dependency-free (no npm install, no test framework).

| Suite | Runs where | Covers |
|---|---|---|
| `static.test.js` | `node tests/static.test.js` | Source-level: content dictionaries, bindings, EN/AR parity, fidelity to the two source documents, business rules, a11y/SEO markup |
| `api.test.js` | `node tests/api.test.js` | The backend over real HTTP: submission, validation, uploads, auth, status workflow, document security |
| `dom.test.js` | In the browser | Runtime: real rendering, language switching, RTL, form behaviour, submission, state resets |

```bash
npm test          # static + api
npm run serve         # dev server on http://localhost:8123
```

## 1. Static suite

```bash
node tests/static.test.js
```

Exits non-zero on failure, so it drops straight into CI or a pre-commit hook.

It asserts, among ~120 checks:

- **The three business edits** — assessment fee is **600 EGP** (not 2,000), acceptance requires the **first installment** fee, and the **10,000 EGP** registration fee appears nowhere — verified in *both* languages.
- **Procedures fidelity** — all 5 journey steps, both initial-document rules, the "assessment does not guarantee a place" caveat, the 5-working-day decision window, all 8 final documents, the 1 August deadline, campus visits, and the admissions contact details.
- **Form fidelity** — every field from the application-form document is defined in English *and* Arabic *and* actually rendered (each gets its own named test), plus dropdown option sets, radio group sizes, and upload accept types.
- **Bilingual integrity** — every `{{ t.adm.* }}` binding resolves in both dictionaries, the two dictionaries expose identical keys, and no key is defined but never rendered (dead content).
- **Accessibility / SEO / responsive** — `<title>`, meta description, `<html lang>`, label↔control association, working `required` attributes, and collapsing grid layouts.

## 2. DOM suite

1. Start the dev server (config in `.claude/launch.json`):
   ```bash
   python -m http.server 8123
   ```
2. Open <http://localhost:8123>, open DevTools → Console.
3. Paste the entire contents of `dom.test.js` and press Enter.

It prints a `console.table` and resolves to `{ passed, failed, total, failures }`.

You can also run it without pasting:

```js
fetch('/tests/dom.test.js').then(r => r.text()).then(t => eval(t)).then(console.log)
```

## The admissions backend (milestone 1)

```
server.js            dev server: serves the site AND the API
api/routes.js        endpoints
api/_lib/store.js    storage adapter (local JSON+disk driver)
api/_lib/auth.js     admin session auth
api/_lib/http.js     body reading + multipart parser
admin.html           the admin dashboard
data/                submitted applications + uploads  (gitignored)
```

Run `npm run serve`, then:

- site → <http://localhost:8123>
- admin → <http://localhost:8123/admin.html> (dev password `masters-dev`)

Applications submitted on the site appear in the dashboard immediately, with
search, status filters (new / reviewing / assessment booked / accepted /
rejected / withdrawn), internal notes, and document downloads.

### Security properties (all covered by `api.test.js`)

- uploaded documents live in `data/` **outside the web root** and are served
  only through `/api/file` to a signed-in admin — never as static files
- session is an HMAC-signed, `HttpOnly`, `SameSite=Strict` cookie; forged
  cookies are rejected in constant time
- login is rate-limited (8 attempts / 10 min)
- path traversal via the download filename is blocked
- the submission response never echoes personal data back
- in production the server **refuses to authenticate** unless
  `MS_ADMIN_PASSWORD` (min 12 chars) and `MS_SESSION_SECRET` are set — it will
  not fall back to a dev default

### Environment variables

| Variable | Purpose |
|---|---|
| `MS_ADMIN_PASSWORD` | admin password — **required in production** |
| `MS_SESSION_SECRET` | HMAC key for sessions — **required in production** |
| `MS_DATA_DIR` | where applications/uploads are written (default `./data`) |
| `MS_MAX_BODY_BYTES` | upload size cap (default 12 MB) |
| `PORT` | dev server port (default 8123) |

### Known limitation

The local driver stores applications as JSON on disk, which is right for
development and a single small server but not for serverless hosting (where the
filesystem is ephemeral). Milestone 2 swaps `store.js` for a Postgres + object
storage driver behind the same interface; no route or UI code changes.

Note also that the admin API shares an origin with the public site, so an XSS on
the public pages could read applications while an admin is signed in. Serving
the dashboard from a separate subdomain would remove that class of risk.

## Receiving real applications

The form now collects every field (76 named controls, ~58 populated on a typical
submission) and POSTs them as `multipart/form-data`, including the uploaded
birth certificate / national ID / school certificate.

It ships **unconfigured**, which means **DEMO MODE**: nothing is stored or
emailed, and the confirmation screen says so explicitly rather than pretending
the application succeeded. A warning is also logged to the console.

To go live, set one variable before `support.js` loads in `index.html`:

```html
<script>window.MS_CONFIG = { applicationsEndpoint: "https://your-endpoint" };</script>
<script src="./support.js"></script>
```

Any endpoint accepting `multipart/form-data` works — Formspree/Web3Forms, a
Supabase edge function, or a Vercel serverless function. If it replies with JSON
containing `applicationId` (or `id`), that value is shown to the parent as their
reference number; otherwise a local `MST-2026-####` id is generated.

Behaviour once configured:

- while in flight the button shows "Sending…" and is disabled
- a network/HTTP failure keeps the parent **on the form** with their answers
  intact and shows a `role="alert"` error — it never shows a false success
- only a `2xx` response reaches the confirmation screen

⚠️ This form carries children's birth certificates and parents' national IDs.
Choose where those files are stored deliberately.

## Notes for future maintainers

Two runtime behaviours of the DC template engine bit us and are now regression-tested:

1. **Bare boolean attributes are dropped.** `<input required>` never reaches the DOM, so
   validation silently never fires. Always write `required="required"`.
2. **Inline styles are re-serialised with a space** — authored `grid-template-columns:1fr 1fr`
   renders as `grid-template-columns: 1fr 1fr`. Any `[style*="..."]` CSS selector must cover
   **both** spellings or it matches nothing at runtime.

Also: React re-renders asynchronously. In `dom.test.js` every click/submit is followed by
`await sleep(SETTLE)` — asserting synchronously reads the previous DOM and produces
false failures.

When editing content, keep `index.html` and `Masters School.dc.html` byte-identical
(`static.test.js` enforces this).
