// Password gate for the whole site (pages and API).
//
// The password is NOT stored in this repository. Set it in Netlify:
//   Site configuration → Environment variables → SITE_PASSWORD
// then redeploy. If SITE_PASSWORD is missing the site stays locked.
//
// Successful logins get an HttpOnly cookie holding an HMAC of the password,
// so changing SITE_PASSWORD signs everyone out.

const COOKIE = 'mcs_ujb_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const LOGIN_PATH = '/__auth/login';
const LOGOUT_PATH = '/__auth/logout';

const enc = new TextEncoder();

async function sessionToken(password) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('mcs-user-journey-builder/session/v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function safeNext(value) {
  // Only allow same-site relative paths.
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/__auth') ? value : '/';
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage({ next = '/', error = '', status = 200 } = {}) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Made Clear Studios – User Journey Builder</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
         background: #000; color: #fff; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 380px; }
  img { width: 200px; height: auto; display: block; margin-bottom: 40px; }
  h1 { font-size: 30px; line-height: 1.15; margin: 0 0 8px; letter-spacing: -0.01em; }
  mark { background: #FFFF00; color: #000; padding: 0 6px; }
  p { margin: 0 0 28px; color: #9a9a9a; }
  label { display: block; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
  input { width: 100%; font: inherit; padding: 12px 14px; border-radius: 0; border: 2px solid #fff; background: #000; color: #fff; }
  input:focus { outline: 3px solid #FFFF00; outline-offset: 2px; }
  button { margin-top: 16px; width: 100%; font: inherit; font-weight: 700; padding: 12px 14px; border: 2px solid #fff;
           background: #fff; color: #000; cursor: pointer; }
  button:hover { background: #FFFF00; border-color: #FFFF00; }
  .error { color: #ff8a8a; margin: 12px 0 0; font-size: 14px; }
</style>
</head>
<body>
<main>
  <img src="/assets/mcs-logo-white.png" alt="Made Clear Studios">
  <h1>User <mark>Journey</mark> Builder</h1>
  <p>Enter the password to continue.</p>
  <form method="post" action="${LOGIN_PATH}">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
    <button type="submit">Enter</button>
  </form>
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

export default async function auth(request, context) {
  const url = new URL(request.url);
  const password = globalThis.Netlify?.env?.get('SITE_PASSWORD') || '';

  if (!password) {
    return new Response('This site is locked: SITE_PASSWORD is not set in Netlify environment variables.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const expected = await sessionToken(password);

  if (url.pathname === LOGOUT_PATH) {
    return new Response(null, {
      status: 303,
      headers: { location: '/', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, 'cache-control': 'no-store' },
    });
  }

  if (url.pathname === LOGIN_PATH) {
    if (request.method !== 'POST') return Response.redirect(new URL('/', url), 303);
    let form;
    try { form = await request.formData(); } catch { form = new FormData(); }
    const next = safeNext(form.get('next'));
    const attempt = String(form.get('password') || '');
    if (safeEqual(await sessionToken(attempt), expected)) {
      return new Response(null, {
        status: 303,
        headers: {
          location: next,
          'set-cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
          'cache-control': 'no-store',
        },
      });
    }
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return loginPage({ next, error: 'That password is not right. Try again.', status: 401 });
  }

  if (safeEqual(readCookie(request, COOKIE), expected)) {
    const response = await context.next();
    response.headers.set('cache-control', 'private, no-store');
    return response;
  }

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorised' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  return loginPage({ next: safeNext(url.pathname + url.search), status: 401 });
}

export const config = {
  path: '/*',
  // The logo and favicon are needed by the login page itself.
  excludedPath: ['/assets/mcs-logo-white.png', '/assets/favicon.svg'],
};
