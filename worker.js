/**
 * Firerain website Worker
 * - POST /api/contact  → contact form handler (Turnstile + Email)
 * - Everything else    → static assets
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS' && url.pathname === '/api/contact') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    // Contact form handler
    if (request.method === 'POST' && url.pathname === '/api/contact') {
      return handleContact(request, env);
    }

    // Static assets
    return env.ASSETS.fetch(request);
  },
};

// --- Contact form ---

async function handleContact(request, env) {
  let body;
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      const fd = await request.formData();
      body = Object.fromEntries(fd.entries());
    }
  } catch {
    return jsonResponse({ success: false, error: 'Invalid request body.' }, 400, request);
  }

  const name          = (body.name     || '').trim();
  const business      = (body.business || '').trim();
  const email         = (body.email    || '').trim();
  const message       = (body.message  || '').trim();
  const turnstileToken = body['cf-turnstile-response'] || '';

  if (!name || name.length > 200)
    return jsonResponse({ success: false, error: 'Name is required.' }, 422, request);
  if (!email || email.length > 254 || !email.includes('@'))
    return jsonResponse({ success: false, error: 'A valid email address is required.' }, 422, request);
  if (!message || message.length > 5000)
    return jsonResponse({ success: false, error: 'Message is required (max 5,000 characters).' }, 422, request);
  if (business.length > 200)
    return jsonResponse({ success: false, error: 'Business name is too long.' }, 422, request);
  if (!turnstileToken)
    return jsonResponse({ success: false, error: 'Please complete the security check.' }, 422, request);

  // Verify Turnstile
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const tsResult = await fetch('https://challenges.cloudflare.com/turnstile/v1/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken, remoteip: ip }),
  }).then(r => r.json());

  if (!tsResult.success)
    return jsonResponse({ success: false, error: 'Security check failed. Please try again.' }, 422, request);

  // Send email
  try {
    const { text, html } = buildEmailBody({ name, business, email, message });
    await env.EMAIL.send({
      from: { name: 'Firerain Website', email: 'info@firerain.ai' },
      to:   [{ name: 'Firerain', email: 'info@firerain.ai' }],
      subject: `New enquiry from firerain.ai — ${name}`,
      text,
      html,
    });
  } catch (err) {
    console.error('Email send error:', err);
    return jsonResponse({ success: false, error: 'Failed to send message. Please try again shortly.' }, 500, request);
  }

  return jsonResponse({ success: true }, 200, request);
}

// --- Helpers ---

function buildEmailBody({ name, business, email, message }) {
  const businessLine = business ? `Business: ${business}\n` : '';
  const businessHtml = business ? `<p><strong>Business:</strong> ${esc(business)}</p>` : '';

  const text = [`New enquiry from firerain.ai`, ``, `Name: ${name}`, businessLine.trim(), `Email: ${email}`, ``, `Message:`, message]
    .filter(l => l !== undefined).join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1e2e">
  <h2 style="color:#ff751f;margin-bottom:16px">New enquiry from firerain.ai</h2>
  <p><strong>Name:</strong> ${esc(name)}</p>
  ${businessHtml}
  <p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
  <hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0">
  <p><strong>Message:</strong></p>
  <p style="white-space:pre-wrap">${esc(message)}</p>
</body></html>`;

  return { text, html };
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': 'https://firerain.ai',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}
