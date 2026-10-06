import { healthPayload, json, notImplemented, safeLog, traceIdFor } from './common.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const traceId = traceIdFor(request);
    const service = env.WORKER_ID || 'rv-doi-resolver';

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(healthPayload(env, 'doi_resolver'));
    }

    if (request.method === 'GET' && url.pathname === '/internal/topology') {
      return json({
        ok: true,
        service,
        downstream: {
          pdf_finder_binding_present: Boolean(env.PDF_FINDER),
        },
        production_traffic_connected: false,
      });
    }

    if (request.method === 'GET' && url.pathname === '/internal/check-downstream') {
      const started = Date.now();
      try {
        const response = await env.PDF_FINDER.fetch(new Request('https://rv.internal/health', {
          headers: { 'x-rv-trace-id': traceId },
        }));
        const body = await response.json().catch(() => null);
        safeLog({ event: 'binding_healthcheck', trace_id: traceId, service, target: 'rv-pdf-finder', status: response.status, latency_ms: Date.now() - started });
        return json({ ok: response.ok, trace_id: traceId, target_status: response.status, target: body }, response.ok ? 200 : 502, { 'x-rv-trace-id': traceId });
      } catch (error) {
        safeLog({ event: 'binding_healthcheck_error', trace_id: traceId, service, target: 'rv-pdf-finder', error_name: error?.name || 'Error', latency_ms: Date.now() - started });
        return json({ ok: false, trace_id: traceId, error: 'DOWNSTREAM_UNAVAILABLE' }, 502, { 'x-rv-trace-id': traceId });
      }
    }

    if (request.method === 'POST' && url.pathname === '/v1/resolve') {
      safeLog({ event: 'stage1_blocked_operation', trace_id: traceId, service, operation: 'resolve_doi' });
      return notImplemented(traceId, service, 'resolve_doi');
    }

    return json({ ok: false, error: 'NOT_FOUND', service }, 404);
  },
};
