// Vercel serverless endpoint for contact-form messages at /api/send-email.
'use strict';
const PATH = '/api/send-email';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUEST_BYTES = 16 * 1024;
const attempts = new Map();
let sgMail;

function mailClient() {
  if (!sgMail) sgMail = require('@sendgrid/mail');
  return sgMail;
}

function clientKey(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        const error = new Error('message is too large');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) { const error = new Error('invalid JSON'); error.statusCode = 400; reject(error); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const key = clientKey(req);
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter(timestamp => now - timestamp < WINDOW_MS);
  if (recent.length >= 5) return res.status(429).json({ error: 'too many messages; try again later' });

  try {
    const body = await readJson(req);
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().slice(0, 254);
    const phone = String(body.phone || '').trim().slice(0, 30);
    const subject = String(body.subject || `Website message from ${name || email || 'visitor'}`).trim().slice(0, 160);
    const message = String(body.message || '').trim().slice(0, 5000);
    if (!name || !message) return res.status(400).json({ error: 'name and message are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'valid email is required' });

    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'SendGrid API key not configured' });
    const from = process.env.EMAIL_FROM;
    const to = process.env.EMAIL_TO;
    if (!from || !to) return res.status(500).json({ error: 'email sender and recipient are not configured' });

    attempts.set(key, recent.concat(now));
    const mail = mailClient();
    mail.setApiKey(apiKey);
    await mail.send({
      to,
      from,
      subject,
      text: `From: ${name} <${email}>\nPhone: ${phone}\n\n${message}`,
      html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p><strong>Phone:</strong> ${escapeHtml(phone)}</p><p><strong>Subject:</strong> ${escapeHtml(subject)}</p><div>${escapeHtml(message).replace(/\n/g, '<br>')}</div>`,
      replyTo: process.env.REPLY_TO || email,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('send-email error', error && (error.response || error));
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Email send failed' });
  }
};

// Raw body access keeps this handler consistent with the other Vercel entries.
module.exports.config = { api: { bodyParser: false } };
