import type { APIRoute } from 'astro';

const RESEND_API_URL = 'https://api.resend.com/emails';

const SUBJECT_LABELS: Record<string, string> = {
  membership: 'Membership Enquiry',
  'certificate-of-origin': 'Certificate of Origin',
  events: 'Events',
  advocacy: 'Business Advocacy',
  general: 'General Enquiry',
};

const toAddress = () => process.env.CONTACT_FORM_TO || 'info@meruchamber.co.ke';
const fromAddress = () => process.env.CONTACT_FORM_FROM || 'info@meruchamber.co.ke';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ ok: false, error: 'Contact form is not configured.' }, 500);
  }

  let body: Record<string, unknown>;
  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new URLSearchParams(await request.text());
      body = Object.fromEntries(formData.entries());
    } else {
      return json({ ok: false, error: 'Unsupported content type.' }, 400);
    }
  } catch {
    return json({ ok: false, error: 'Invalid request body.' }, 400);
  }

  // Honeypot: silently accept submissions where the hidden field is filled in.
  if (body.website && String(body.website).length > 0) {
    return json({ ok: true });
  }

  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  const subjectKey = String(body.subject ?? '').trim();
  const message = String(body.message ?? '').trim();

  if (!name || !message) {
    return json({ ok: false, error: 'Please provide your name and a message.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please provide a valid email address.' }, 400);
  }
  if (message.length > 10000 || name.length > 200 || email.length > 320) {
    return json({ ok: false, error: 'One or more fields are too long.' }, 400);
  }

  const subjectLabel = SUBJECT_LABELS[subjectKey] || 'General Enquiry';
  const subject = `[Meru Chamber Website] ${subjectLabel} - ${name}`;

  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : '',
    `Subject: ${subjectLabel}`,
    '',
    message,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6;">
      <h2 style="margin:0 0 16px;">New message from the Meru Chamber website</h2>
      <table cellpadding="4" cellspacing="0" style="margin-bottom:16px;">
        <tr><td style="font-weight:bold;padding-right:12px;">Name</td><td>${escapeHtml(name)}</td></tr>
        <tr><td style="font-weight:bold;padding-right:12px;">Email</td><td>${escapeHtml(email)}</td></tr>
        ${phone ? `<tr><td style="font-weight:bold;padding-right:12px;">Phone</td><td>${escapeHtml(phone)}</td></tr>` : ''}
        <tr><td style="font-weight:bold;padding-right:12px;">Subject</td><td>${escapeHtml(subjectLabel)}</td></tr>
      </table>
      <p style="white-space:pre-wrap;margin:0;">${escapeHtml(message)}</p>
    </div>
  `;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Meru Chamber Website <${fromAddress()}>`,
        to: [toAddress()],
        reply_to: email,
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Resend API error:', res.status, errorText);
      return json({ ok: false, error: 'Failed to send your message. Please try again or email us directly.' }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error('Failed to send email:', err);
    return json({ ok: false, error: 'Failed to send your message. Please try again or email us directly.' }, 502);
  }
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
