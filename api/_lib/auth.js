/*
 * Admin authentication.
 *
 * One shared admin password (env MS_ADMIN_PASSWORD) exchanged for an HMAC-signed
 * session cookie. No password is ever stored or logged; the cookie carries only
 * an expiry plus a signature, so it cannot be forged without the secret.
 *
 * In development a throwaway secret is generated and a default password is
 * allowed, with a loud warning. In production both env vars are REQUIRED —
 * the module refuses to authenticate rather than silently accepting a default,
 * because this endpoint exposes children's identity documents.
 */
'use strict';
const crypto = require('crypto');

const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const COOKIE = 'ms_admin';
const TTL_MS = 8 * 60 * 60 * 1000; // one working day

let devSecret = null;
function secret() {
  if (process.env.MS_SESSION_SECRET) return process.env.MS_SESSION_SECRET;
  if (IS_PROD) return null;
  if (!devSecret) {
    devSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[Masters] DEV: generated a temporary session secret — sessions end on restart. Set MS_SESSION_SECRET for a stable one.');
  }
  return devSecret;
}

function adminPassword() {
  if (process.env.MS_ADMIN_PASSWORD) return process.env.MS_ADMIN_PASSWORD;
  if (IS_PROD) return null;
  console.warn('[Masters] DEV: MS_ADMIN_PASSWORD is not set — falling back to "masters-dev". Never use this in production.');
  return 'masters-dev';
}

/** Reports why auth cannot run, so routes can return a clear 500 instead of a silent failure. */
function configError() {
  if (!IS_PROD) return null;
  if (!process.env.MS_ADMIN_PASSWORD) return 'MS_ADMIN_PASSWORD is not set';
  if (!process.env.MS_SESSION_SECRET) return 'MS_SESSION_SECRET is not set';
  if (String(process.env.MS_ADMIN_PASSWORD).length < 12) return 'MS_ADMIN_PASSWORD must be at least 12 characters';
  return null;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

function issueToken() {
  const exp = String(Date.now() + TTL_MS);
  return exp + '.' + sign(exp);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const s = secret();
  if (!s) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b); // constant-time: no signature oracle
}

function checkPassword(given) {
  const expected = adminPassword();
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthed(req) {
  return verifyToken(parseCookies(req)[COOKIE]);
}

function sessionCookie(token) {
  const bits = [
    COOKIE + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',            // unreadable from JS: blunts XSS session theft
    'SameSite=Strict',     // blunts CSRF on the admin routes
    'Max-Age=' + Math.floor(TTL_MS / 1000),
  ];
  if (IS_PROD) bits.push('Secure');
  return bits.join('; ');
}

function clearCookie() {
  return COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
}

/* --- login throttling: a shared password deserves brute-force resistance --- */
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function rateLimit(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, first: now };
  if (now - rec.first > WINDOW_MS) { rec.n = 0; rec.first = now; }
  rec.n += 1;
  attempts.set(key, rec);
  if (attempts.size > 5000) attempts.clear(); // crude bound; fine for one school
  return { blocked: rec.n > MAX_ATTEMPTS, retryInMs: Math.max(0, WINDOW_MS - (now - rec.first)) };
}
function resetLimit(key) { attempts.delete(key); }

module.exports = {
  COOKIE, IS_PROD, configError,
  issueToken, verifyToken, checkPassword,
  isAuthed, parseCookies, sessionCookie, clearCookie,
  rateLimit, resetLimit,
};
