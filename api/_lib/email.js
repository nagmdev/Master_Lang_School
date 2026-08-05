'use strict';
/*
 * Email notifications via Resend (https://resend.com).
 *
 * Configure with these Vercel env vars:
 *   RESEND_API_KEY   — API key from the Resend dashboard (required)
 *   MS_NOTIFY_EMAIL  — where new-application alerts are sent
 *                       (defaults to mastersschool59@gmail.com below)
 *   MS_FROM_EMAIL    — verified sender, e.g. "Masters School <no-reply@masters-edu.com>"
 *                       (defaults to Resend's shared test sender, which only
 *                       works until you verify your own domain)
 *   MS_SITE_URL      — e.g. https://masters-edu.com (used to link back to
 *                       the admin dashboard in the email body)
 *
 * Never throws: a failed email must never block an application from being
 * stored, so every error is caught and logged instead of propagated.
 */

const NOTIFY_TO = process.env.MS_NOTIFY_EMAIL || 'mastersschool59@gmail.com';
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

module.exports = { notifyNewApplication };

