import { healthPayload, json, notImplemented, safeLog, traceIdFor } from './common.js';

const SOURCE_BINDINGS = [
  ['SOURCE_01_OA', 'rv-source-01-oa'],
  ['SOURCE_02_BIOMED', 'rv-source-02-biomed'],
  ['SOURCE_03_PREPRINTS', 'rv-source-03-preprints'],
  ['SOURCE_04_PUBLISHERS_A', 'rv-source-04-publishers-a'],
  ['SOURCE_05_PUBLISHERS_B', 'rv-source-05-publishers-b'],
  ['SOURCE_06_SOCIETY_TECH', 'rv-source-06-society-tech'],
  ['SOURCE_07_LONGTAIL', 'rv-source-07-longtail'],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const traceId = traceIdFor(request);
    const service = env.WORKER_ID || 'rv-pdf-finder';

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(healthPayload(env, 'pdf_finder'));
    }

    if (request.method === 'GET' && url.pathname === '/internal/topology') {
      return json({
        ok: true,
        service,
        sources: SOURCE_BINDINGS.map(([binding, target]) => ({
          binding,
          target,
          present: Boolean(env[binding]),
        })),
        production_traffic_connected: false,
      });
    }

    if (request.method === 'GET' && url.pathname === '/internal/check-sources') {
      const checks = await Promise.all(SOURCE_BINDINGS.map(async ([binding, target]) => {
        const started = Date.now();
        try {
          const response = await env[binding].fetch(new Request('https://rv.internal/health', {
            headers: { 'x-rv-trace-id': traceId },
          }));
          const body = await response.json().catch(() => null);
          const result = { binding, target, ok: response.ok, status: response.status, latency_ms: Date.now() - started, body };
          safeLog({ event: 'binding_healthcheck', trace_id: traceId, service, target, status: response.status, latency_ms: result.latency_ms });
          return result;
        } catch (error) {
          const result = { binding, target, ok: false, status: null, latency_ms: Date.now() - started, error: 'SOURCE_UNAVAILABLE' };
          safeLog({ event: 'binding_healthcheck_error', trace_id: traceId, service, target, error_name: error?.name || 'Error', latency_ms: result.latency_ms });
          return result;
        }
      }));

      const allHealthy = checks.every((item) => item.ok);
      return json({ ok: allHealthy, trace_id: traceId, checks }, allHealthy ? 200 : 502, { 'x-rv-trace-id': traceId });
    }

    if (request.method === 'POST' && url.pathname === '/v1/find') {
      safeLog({ event: 'stage1_blocked_operation', trace_id: traceId, service, operation: 'find_pdf' });
      return notImplemented(traceId, service, 'find_pdf');
    }

    return json({ ok: false, error: 'NOT_FOUND', service }, 404);
  },
};
