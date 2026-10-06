import { json, traceIdFor } from './common.js';

async function callJson(binding, path, traceId) {
  const started = Date.now();
  try {
    const response = await binding.fetch(new Request(`https://rv.internal${path}`, {
      headers: { 'x-rv-trace-id': traceId },
    }));
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - started,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latency_ms: Date.now() - started,
      error: error?.name || 'Error',
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const traceId = traceIdFor(request);

    if (request.method !== 'GET' || url.pathname !== '/smoke') {
      return json({ ok: false, error: 'NOT_FOUND' }, 404);
    }

    const doi = await callJson(env.DOI_RESOLVER, '/internal/check-downstream', traceId);
    const pdf = await callJson(env.PDF_FINDER, '/internal/check-sources', traceId);
    const ok = Boolean(doi.ok && pdf.ok);

    return json({
      ok,
      trace_id: traceId,
      doi_chain: doi,
      pdf_chain: pdf,
      note: 'Temporary Stage 1 smoke gateway. No production Telegram traffic is connected.',
    }, ok ? 200 : 502, { 'x-rv-trace-id': traceId });
  },
};
