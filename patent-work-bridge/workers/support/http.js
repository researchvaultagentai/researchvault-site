import { createSupportService } from './service.js';
import { supportScopeForPage } from '../../../assets/rv-support-context.js';

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_body');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 16384) { await reader.cancel(); throw new Error('body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function supportHttp(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!['/v1/chat', '/v1/config'].includes(url.pathname)) return new Response('Not found', { status: 404 });
  const origin = request.headers.get('origin');
  const allowed = String(env.SUPPORT_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
  const scope = supportScopeForPage(origin, request.headers.get('x-rv-support-page') || '/');
  const stampedScope = request.headers.get('x-rv-support-scope');
  if (!scope || (stampedScope && stampedScope !== scope)) return new Response('Forbidden', { status: 403 });
  const headers = { 'access-control-allow-origin': origin, vary: 'Origin', 'cache-control': 'no-store' };
  if (url.pathname === '/v1/config') {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
    const siteKey = String(env.TURNSTILE_SITE_KEY || '');
    const issues = [];
    if (env.SUPPORT_ENABLED !== 'true') issues.push('support_disabled');
    if (!env.TURNSTILE_SECRET) issues.push('turnstile_secret_missing');
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(siteKey)) issues.push('turnstile_site_key_missing');
    if (typeof env.AI?.run !== 'function') issues.push('ai_binding_missing');
    if (typeof env.SUPPORT_DB?.prepare !== 'function') issues.push('support_database_binding_missing');
    return Response.json(issues.length
      ? { configured: false, issues }
      : { configured: true, turnstileSiteKey: siteKey }, { headers });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
    'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
  if (env.SUPPORT_ENABLED !== 'true' || !env.TURNSTILE_SECRET) {
    return Response.json({ error: 'support_unavailable' }, { status: 503, headers });
  }
  try {
    const body = await readJson(request);
    if (typeof body.turnstileToken !== 'string' || body.turnstileToken.length > 2048) throw new Error('challenge_required');
    const verification = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: body.turnstileToken,
        ...(request.headers.get('cf-connecting-ip') ? { remoteip: request.headers.get('cf-connecting-ip') } : {}) }),
    });
    const challenge = await verification.json();
    if (!verification.ok || !challenge.success || challenge.action !== 'support_chat' ||
      challenge.hostname !== new URL(origin).hostname) return Response.json({ error: 'challenge_failed' }, { status: 403, headers });
    const result = await createSupportService(env).chat({ message: body.message, language: body.language, history: body.historyScope === scope ? body.history : [], scope });
    return Response.json({ ...result, serviceScope: scope }, { headers });
  } catch { return Response.json({ error: 'support_unavailable' }, { status: 400, headers }); }
}
