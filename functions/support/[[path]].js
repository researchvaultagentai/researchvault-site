import { supportScopeForPage } from '../../assets/rv-support-context.js';
import { clientIp } from '../../patent-api/src/security.js';

const ORIGINS = new Set([
  'https://researchvaultagent.ir',
  'https://www.researchvaultagent.ir',
  'https://researchvault-patent.pages.dev',
]);
const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const WORKER_ISSUES = new Set([
  'support_disabled', 'turnstile_secret_missing', 'turnstile_site_key_missing',
  'ai_binding_missing', 'support_database_binding_missing',
]);
function unavailable(...issues) {
  return Response.json({ configured: false, issues }, { headers: BASE_HEADERS });
}
function failure(status) {
  return Response.json({ error: 'support_unavailable' }, { status, headers: BASE_HEADERS });
}
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  let publicOrigin = url.origin;
  let serviceOrigin = url.origin;
  if (url.origin === 'https://cf-origin.researchvaultagent.ir') {
    if (request.headers.get('cf-connecting-ip') !== '89.44.241.208') return failure(403);
    const publicHost = request.headers.get('x-rv-public-host');
    if (!['researchvaultagent.ir', 'www.researchvaultagent.ir', 'iran-preview.researchvaultagent.ir'].includes(publicHost)) return failure(403);
    publicOrigin = 'https://' + publicHost;
    serviceOrigin = 'https://www.researchvaultagent.ir';
  } else if (!ORIGINS.has(url.origin)) return failure(403);
  if (!['/support/config', '/support/chat'].includes(url.pathname)) return failure(404);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== publicOrigin) || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) return failure(403);
  const configuration = url.pathname === '/support/config';
  if (request.method !== (configuration ? 'GET' : 'POST')) return failure(405);
  if (!configuration && origin !== publicOrigin) return failure(403);
  if (!configuration && !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return failure(415);
  if (!configuration && Number(request.headers.get('content-length') || 0) > 16384) return failure(413);
  const page = request.headers.get('x-rv-support-page') || '/';
  const scope = supportScopeForPage(serviceOrigin, page);
  if (!scope) return failure(400);
  if (typeof env.SUPPORT_SERVICE?.fetch !== 'function') {
    return configuration
      ? unavailable('support_service_binding_missing')
      : failure(503);
  }
  try {
    const forward = new Request('https://support.internal/v1/' + (configuration ? 'config' : 'chat'), request);
    for (const name of [...forward.headers.keys()]) forward.headers.delete(name);
    forward.headers.set('origin', serviceOrigin);
    forward.headers.set('x-rv-support-page', page);
    forward.headers.set('x-rv-support-scope', scope);
    if (!configuration) forward.headers.set('content-type', 'application/json');
    const ip = clientIp(request);
    if (ip !== 'unknown') forward.headers.set('cf-connecting-ip', ip);
    const upstream = await env.SUPPORT_SERVICE.fetch(forward);
    if (configuration) {
      if (!upstream.ok) return unavailable(upstream.status === 403 ? 'support_origin_rejected'
        : upstream.status === 404 ? 'support_worker_route_missing' : 'support_service_unavailable');
      const result = await upstream.json();
      const ready = result.configured === true && typeof result.turnstileSiteKey === 'string' &&
        /^[a-zA-Z0-9_-]{10,100}$/.test(result.turnstileSiteKey);
      return Response.json(ready
        ? { configured: true, endpoint: '/support/chat', turnstileSiteKey: result.turnstileSiteKey }
        : { configured: false, issues: Array.isArray(result.issues) && result.issues.some(code => WORKER_ISSUES.has(code))
          ? [...new Set(result.issues.filter(code => WORKER_ISSUES.has(code)))] : ['support_worker_not_ready'] }, { headers: BASE_HEADERS });
    }
    return new Response(upstream.body, { status: upstream.status, headers: {
      ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8',
    } });
  } catch { return configuration
    ? unavailable('support_service_unreachable')
    : failure(503); }
}
