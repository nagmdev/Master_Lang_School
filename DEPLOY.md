# Deploying to Vercel

Repo: `Mahmoud-Hashim-pro/masters-school-website` — Vercel redeploys on every push.

> **Why a database is not optional.** Vercel's filesystem is **ephemeral**:
> anything written to disk vanishes on the next deploy or cold start. Without
> `DATABASE_URL`, submitted applications would be silently lost. The app logs a
> FATAL warning in production if it is missing.

---

## Step 1 — Commit and push

None of the backend work is in git yet. From the project folder:

```bash
git add -A
git commit -m "Add admissions backend, admin dashboard and tests"
git push
```

`.env`, `data/` and `node_modules/` are gitignored, so **no password and no
applicant data leave your machine**. Verify before pushing:

```bash
git status --porcelain     # .env and data/ must NOT appear
```

## Step 2 — Create the database

Vercel dashboard → **Storage → Create Database → Postgres** → attach to this
project. Vercel injects `DATABASE_URL` / `POSTGRES_URL` automatically.

Any Postgres works (Neon, Supabase, Railway). The app reads, in order:
`DATABASE_URL`, `POSTGRES_URL`, `MS_DATABASE_URL`.

**No migration step.** The `applications` and `application_files` tables are
created automatically on the first request.

## Step 3 — Set environment variables

**Settings → Environment Variables**, for Production *and* Preview:

| Variable | Value |
|---|---|
| `MS_ADMIN_PASSWORD` | the shared admissions password (min 12 chars) — **not recorded in this repo** |
| `MS_SESSION_SECRET` | a 64-character random string (generate below) |

Generate the session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Never write either value into this file or any other tracked file. This repo is
> public; the admin login opens applicants' identity documents. The local value
> lives only in `.env`, which is gitignored.

⚠️ **Paste the password RAW — no quotes.** The quotes in `.env` exist only
because `#` starts a comment in env *files*. In the Vercel form, quotes would
become part of the password and lock you out.

If either variable is missing, the API returns
`500 server not configured` rather than falling back to a weak default — this
endpoint exposes children's identity documents.

## Step 4 — Deploy

Pushing in step 1 triggers the build. Vercel runs `npm install` (one dependency,
`pg`); there is no build step.

## Step 5 — Verify on the live URL

1. **Admissions → submit a test application** with a document attached.
   Expect the confirmation and an ID like `MST-2026-1234`.
2. Open `/admin.html`, sign in, confirm the test application is listed.
3. Open it → download the document → **Delete** it.
4. Confirm `https://<domain>/data/applications.json` returns **403/404**.

Verified locally against a real PostgreSQL instance in production mode
(`VERCEL=1`, `NODE_ENV=production`):

| Check | Result |
|---|---|
| Parent submits with document | `201` |
| Anonymous listing | `401` blocked |
| Admin login | `200`, `Secure` cookie |
| Admin sees application + downloads document | `200` |
| Delete removes row + document | `200` |
| Nothing written to disk | confirmed — Postgres only |

---

## How it is wired

```
api/applications.js   POST public submit · GET admin list
api/application.js    GET detail · PATCH/POST update · DELETE remove
api/login.js          POST password → signed session cookie
api/logout.js         POST clear session
api/session.js        GET is-signed-in
api/file.js           GET document download (admin only)
api/_routes.js        shared router   (underscore = not a public endpoint)
api/_lib/             storage drivers, auth, multipart parser
admin.html            dashboard
```

Each `api/*.js` is a Vercel serverless function delegating to the shared router,
so local dev (`server.js`) and production run identical code. Body parsing is
disabled per function (`bodyParser: false`) — platform JSON parsing would corrupt
uploaded PDFs.

## Known limits

- **Request body cap ~4.5 MB.** One submission's documents must total under that.
  The form rejects oversized files client-side with a clear message before
  uploading. If parents hit it often, the fix is direct-to-storage uploads
  (Vercel Blob client upload).
- **Documents live in Postgres** as `bytea`. Fine for a few hundred applications
  a year; beyond that move the bytes to Vercel Blob and keep the reference.
  Isolated to `store.postgres.js`.
- **Shared origin.** The dashboard is on the same domain as the public site, so
  an XSS on public pages could read applications while an admin is signed in.
  A separate subdomain would remove that risk.
- **Status is read-only.** The Update control was removed by request, so every
  application stays `new` and internal notes cannot be filled. The API endpoint
  still exists, so restoring the button is a small change.

## Testing

```bash
npm test                                          # static + store + api
DATABASE_URL=postgres://... npm run test:store    # includes the postgres driver
```

`tests/store.test.js` runs identical assertions against the local and Postgres
drivers, so the production driver is proven equivalent rather than assumed.
