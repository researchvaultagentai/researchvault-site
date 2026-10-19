const ORIGINS = new Set([
  'https://researchvaultagent.ir',
  'https://www.researchvaultagent.ir',
  'https://researchvault-patent.pages.dev',
]);
const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
function failure(status) {
  return Response.json({ error: 'support_unavailable' }, { status, headers: BASE_HEADERS });
}
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!ORIGINS.has(url.origin)) return failure(403);
  if (!['/support/config', '/support/chat'].includes(url.pathname)) return failure(404);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== url.origin) || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) return failure(403);
  const configuration = url.pathname === '/support/config';
  if (request.method !== (configuration ? 'GET' : 'POST')) return failure(405);
  if (!configuration && origin !== url.origin) return failure(403);
  if (!configuration && !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return failure(415);
  if (!configuration && Number(request.headers.get('content-length') || 0) > 16384) return failure(413);
  if (typeof env.SUPPORT_SERVICE?.fetch !== 'function') {
    return configuration
      ? Response.json({ configured: false }, { headers: BASE_HEADERS })
      : failure(503);
  }
  try {
    const forward = new Request('https://support.internal/v1/' + (configuration ? 'config' : 'chat'), request);
    for (const name of [...forward.headers.keys()]) forward.headers.delete(name);
    forward.headers.set('origin', url.origin);
    if (!configuration) forward.headers.set('content-type', 'application/json');
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) forward.headers.set('cf-connecting-ip', ip);
    const upstream = await env.SUPPORT_SERVICE.fetch(forward);
    if (configuration) {
      if (!upstream.ok) return Response.json({ configured: false }, { headers: BASE_HEADERS });
      const result = await upstream.json();
      const ready = result.configured === true && typeof result.turnstileSiteKey === 'string' &&
        /^[a-zA-Z0-9_-]{10,100}$/.test(result.turnstileSiteKey);
      return Response.json(ready
        ? { configured: true, endpoint: '/support/chat', turnstileSiteKey: result.turnstileSiteKey }
        : { configured: false }, { headers: BASE_HEADERS });
    }
    return new Response(upstream.body, { status: upstream.status, headers: {
      ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8',
    } });
  } catch { return configuration
    ? Response.json({ configured: false }, { headers: BASE_HEADERS })
    : failure(503); }
}
