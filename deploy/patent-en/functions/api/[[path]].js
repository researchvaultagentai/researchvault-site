import { submitInternationalReceipt } from '../_lib/international-payments.js';

const PRODUCTION_ORIGIN = 'https://researchvault-patent.pages.dev';
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);

function failure(status, message) {
  return Response.json({ ok: false, message }, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  // A preview build must never read or mutate production patent cases.
  if (url.origin !== PRODUCTION_ORIGIN) return failure(403, 'Production portal only');
  if (!url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/admin/')) {
    return failure(404, 'Not found');
  }
  if (!METHODS.has(request.method)) return failure(405, 'Method not allowed');
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== PRODUCTION_ORIGIN) ||
      (fetchSite && !['same-origin', 'none'].includes(fetchSite)) ||
      (!SAFE_METHODS.has(request.method) && origin !== PRODUCTION_ORIGIN)) {
    return failure(403, 'Same-origin request required');
  }
  if (!env.PATENT_API?.fetch) return failure(503, 'Patent portal is not connected yet');

  try {
    if (url.pathname === '/api/international-payments/receipts') {
      return await submitInternationalReceipt(request, env);
    }
    if (url.pathname.startsWith('/api/international-payments/')) return failure(404, 'Not found');
    // Service binding calls the existing dedicated Patent Worker. Authentication,
    // authorization, cookies, contract evidence, storage and billing stay there.
    // Forward the original Request so its body and client context are preserved.
    const upstream = await env.PATENT_API.fetch(request);
    const headers = new Headers(upstream.headers);
    headers.delete('access-control-allow-origin');
    headers.delete('access-control-allow-credentials');
    headers.set('cache-control', 'no-store');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(upstream.body, {
      status: upstream.status, statusText: upstream.statusText, headers,
    });
  } catch {
    return failure(503, 'Patent portal is temporarily unavailable');
  }
}
