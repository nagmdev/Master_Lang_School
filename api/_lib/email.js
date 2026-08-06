'use strict';
/*
 * Email notifications via Resend (https://resend.com).
 *
 * Configure with these Vercel env vars:
 *   RESEND_API_KEY   — API key from the Resend dashboard (required)
 *   MS_NOTIFY_EMAIL  — where new-application alerts are sent
 *                       (defaults to admission@masters-edu.com below)
 *   MS_FROM_EMAIL    — verified sender, e.g. "Masters School <no-reply@masters-edu.com>"
 *                       (defaults to Resend's shared test sender, which only
 *                       works until you verify your own domain)
 *   MS_SITE_URL      — e.g. https://masters-edu.com (used to link back to
 *                       the admin dashboard in the email body)
 *
 * Never throws: a failed email must never block an application from being
 * stored, so every error is caught and logged instead of propagated.
 */

const NOTIFY_TO = process.env.MS_NOTIFY_EMAIL || 'admissions@masters-edu.com';
const FROM = process.env.MS_FROM_EMAIL || 'Masters School <onboarding@resend.dev>';

async function notifyNewApplication(row, fields) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Masters] RESEND_API_KEY not set — skipping email notification');
    return;
  }

  const dashboardUrl = process.env.MS_SITE_URL
    ? `${process.env.MS_SITE_URL.replace(/\/$/, '')}/admin.html`
    : '/admin.html on your live domain';

  // Intentionally NOT including national ID numbers here — those stay
  // behind the admin login. This is just enough to know a new application
  // came in and who to look for.
  const subject = `New application — ${fields.sname || fields.arname || row.id}`;
  const lines = [
    'A new admissions application was submitted.',
    '',
    `Reference: ${row.id}`,
    `Student (English): ${fields.sname || '—'}`,
    `Student (Arabic): ${fields.arname || '—'}`,
    `Grade: ${fields.grade || '—'}`,
    `Parent/Guardian: ${fields.faName || '—'}`,
    `Parent mobile: ${fields.faMobile || '—'}`,
    `Submitted: ${row.submittedAt}`,
    '',
    `View full details (incl. ID documents): ${dashboardUrl}`,
  ];

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [NOTIFY_TO],
        subject,
        text: lines.join('\n'),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[Masters] email notification failed:', res.status, body);
    }
  } catch (err) {
    console.error('[Masters] email notification error:', err);
  }
}

const HR_NOTIFY_TO = process.env.MS_HR_NOTIFY_EMAIL || NOTIFY_TO;

/**
 * Fires when a job application is submitted through the Careers pages
 * (embedded SPA form or any of the standalone apply-<job>.html pages).
 * Never throws — a failed email must never block the application from
 * being stored, mirroring notifyNewApplication().
 */
async function notifyNewCareerApplication(row, fields) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Masters] RESEND_API_KEY not set — skipping career email notification');
    return;
  }

  const dashboardUrl = process.env.MS_SITE_URL
    ? `${process.env.MS_SITE_URL.replace(/\/$/, '')}/admin.html`
    : '/admin.html on your live domain';

  const subject = `New job application — ${fields.position || 'Masters'} — ${fields.name || row.id}`;
  const lines = [
    'A new career application was submitted.',
    '',
    `Reference: ${row.id}`,
    `Position: ${fields.position || '—'}`,
    `Name: ${fields.name || '—'}`,
    `Phone: ${fields.phone || '—'}`,
    `Email: ${fields.email_2 || fields.email || '—'}`,
    `Years of experience: ${fields.years || '—'}`,
    `Education: ${fields.edu || '—'}`,
    `Submitted: ${row.submittedAt}`,
    '',
    `View full details (incl. CV / certificates): ${dashboardUrl}`,
  ];

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [HR_NOTIFY_TO],
        subject,
        text: lines.join('\n'),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[Masters] career email notification failed:', res.status, body);
    }
  } catch (err) {
    console.error('[Masters] career email notification error:', err);
  }
}

/**
 * Fires when the public Contact page's message form is submitted. Nothing is
 * persisted server-side for contact messages (unlike applications), so this
 * email IS the delivery — if it silently fails, the visitor's message is
 * gone, so every failure path here is logged loudly.
 */
async function notifyContactMessage(fields) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Masters] RESEND_API_KEY not set — cannot deliver contact message');
    return false;
  }

  const subject = `Website message from ${fields.name || fields.email || 'visitor'}`;
  const lines = [
    `From: ${fields.name || '—'} <${fields.email || '—'}>`,
    `Phone: ${fields.phone || '—'}`,
    '',
    fields.message || '',
  ];

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(fields.email ? {} : {}),
      },
      body: JSON.stringify({
        from: FROM,
        to: [NOTIFY_TO],
        subject,
        text: lines.join('\n'),
        reply_to: fields.email || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[Masters] contact email failed:', res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Masters] contact email error:', err);
    return false;
  }
}

module.exports = { notifyNewApplication, notifyNewCareerApplication, notifyContactMessage };
