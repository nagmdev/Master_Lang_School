// Simple Vercel serverless endpoint to send site messages via SendGrid
'use strict';
const sgMail = require('@sendgrid/mail');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    // Parse JSON body (Vercel provides parsed body for typical JSON POSTs)
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    const name = body.name || '';
    const email = body.email || '';
    const phone = body.phone || '';
    const subject = body.subject || `Website message from ${name || email || 'visitor'}`;
    const message = body.message || '';

    if (!message) return res.status(400).json({ error: 'Missing message' });

    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'SendGrid API key not configured' });
    sgMail.setApiKey(apiKey);

    const from = process.env.EMAIL_FROM || 'no-reply@masters-edu.com';
    const to = process.env.EMAIL_TO || 'mastersschool59@gmail.com';
    const replyTo = process.env.REPLY_TO || email || 'mastersschool59@gmail.com';

    const html = `<p><strong>From:</strong> ${name || 'visitor'} &lt;${email || ''}&gt;</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <div style="margin-top:12px">${String(message).replace(/\n/g, '<br/>')}</div>`;

    const msg = {
      to: to,
      from: from,
      subject: subject,
      text: String(message),
      html: html,
      replyTo: replyTo
    };

    await sgMail.send(msg);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-email error', err && (err.response || err));
    return res.status(500).json({ error: 'Email send failed' });
  }
};
