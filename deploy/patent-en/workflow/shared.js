export const $ = (s, root = document) => root.querySelector(s);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
  maximumFractionDigits: 2, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export const when = t => new Date(t * 1000).toLocaleString();
export const terms = '<p>Stage 1 is an independent service costing <b>US$1,111</b>: US$111 for the initial review and consultation, US$555 to start the specialist report after the consultation, and US$445 to unlock the report password and Word file. The entire US$1,111 is non-refundable under the order terms, subject to mandatory rights that apply. After work starts, a requested change requiring a new analysis run is separately quoted at US$111. No Stage 2 services are ordered here.</p>';

export function notice(message, error = false) {
  const box = $('#notice'); box.hidden = !message; box.textContent = message || ''; box.classList.toggle('error', error);
}

export async function api(path, options = {}) {
  const { body, grant, raw, ...init } = options;
  const headers = new Headers(init.headers || {});
  if (grant) headers.set('x-pct-admin-link', grant);
  if (body && !(body instanceof FormData)) headers.set('content-type', 'application/json');
  const r = await fetch(path, { credentials: 'same-origin', ...init, headers, ...(body ?
    { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
  if (raw && r.ok) return r;
  const value = await r.json().catch(() => null);
  if (!r.ok) { const err = new Error(value?.message || `Request failed (${r.status}).`); err.status = r.status; throw err; }
  return value;
}

export const post = (path, body, grant) => api(path, { method: 'POST', body, grant });

export function set(html) { const app = $('#app'); app.innerHTML = html; app.setAttribute('aria-busy', 'false'); }

export function onForm(selector, callback) {
  $(selector)?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, btn = event.submitter || $('button[type="submit"]', form);
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    notice('');
    try { await callback(new FormData(form), form); }
    catch (error) { notice(error.message, true); }
    finally { if (btn) btn.disabled = false; }
  });
}

export function onClick(selector, callback) {
  $(selector)?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true; notice('');
    try { await callback(button); } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  });
}

export async function session(pct = false) { return (await api(pct ? '/api/pct/auth/me' : '/api/me')).user; }
export const requestCode = email => post('/api/auth/request-otp', { destination: email, channel: 'email' });

export function login(after, email = '', options = {}) {
  const accountEmail = value => `<label>Email<input type="email" name="email" autocomplete="username" required value="${esc(value)}"></label>`;
  set(`<section class="card auth-card"><span class="eyebrow">RESEARCHVAULT PATENT</span><h2>Sign in / create an account</h2>
    <p>Use a one-time code sent to your email.</p>
    ${options.google ? '<p><a class="button google" href="/api/pct/auth/google/start"><span aria-hidden="true">G</span> Continue with Google</a></p>' : ''}
    <form id="login-request">${accountEmail(email)}<button>Send email code</button></form>
    <form id="login-verify" hidden><label>One-time code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button>Verify and continue</button></form>
    ${options.password ? `<details class="auth-method"><summary>Sign in with email and password</summary>
    <form id="login-password">${accountEmail(email)}<label>Password<input type="password" name="password" autocomplete="current-password" required></label><button>Sign in</button></form></details>
    <details class="auth-method"><summary>Create or reset a password</summary><form id="password-set">${accountEmail(email)}
      <label>New password<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>
      <button id="password-code" type="button" class="secondary">Send verification code</button>
      <div id="password-verify" hidden><label>One-time code<input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" required disabled></label>
      <button type="submit">Save password and sign in</button></div></form></details>` : ''}</section>`);
  let challenge, setup;
  onForm('#login-request', async data => {
    challenge = (await requestCode(data.get('email'))).challenge_id;
    $('#login-verify').hidden = false;
    $('#login-verify input').focus();
    notice('Verification code sent.');
  });
  onForm('#login-verify', async data => {
    const { user } = await post('/api/auth/verify-otp', { challenge_id: challenge, code: data.get('code') });
    await after(user);
  });
  onForm('#login-password', async data => {
    const {user}=await post('/api/pct/auth/password/login',Object.fromEntries(data)); await after(user);
  });
  onClick('#password-code',async()=>{
    const form=$('#password-set'), code=form.elements.code;
    code.disabled=true;
    if(!form.reportValidity()) { if(setup)code.disabled=false; return; }
    setup=(await requestCode(form.elements.email.value)).challenge_id;
    $('#password-verify').hidden=false;code.disabled=false;code.focus();notice('Verification code sent.');
  });
  onForm('#password-set', async data => {
    if(!setup)throw new Error('Request your email code first.');
    const {user}=await post('/api/pct/auth/password/set',{...Object.fromEntries(data),challenge_id:setup}); await after(user);
  });
}

export function fileForm(category, file, password) {
  const data = new FormData();
  data.append('category', category); data.append('file', file);
  if (password) data.append('password', password);
  return data;
}

export const timeline = events => events?.length ? '<ol reversed>' + events.map(event =>
  `<li${Number.isSafeInteger(event.revision) ? ` value="${event.revision+1}"` : ''}>${esc(event.event_type.replaceAll('_',' '))} · <time>${esc(when(event.created_at))}</time></li>`).join('') + '</ol>' : '<p class="quiet">No events yet.</p>';
