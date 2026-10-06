import { healthPayload, json, notImplemented, safeLog, traceIdFor } from './common.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const traceId = traceIdFor(request);
    const service = env.WORKER_ID || 'rv-source-worker';

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(healthPayload(env, 'source_worker'));
    }

    if (request.method === 'GET' && url.pathname === '/internal/capabilities') {
      return json({
        ok: true,
        service,
        source_group: env.SOURCE_GROUP || 'UNASSIGNED',
        stage: 'infrastructure_only',
        operations: ['health', 'capabilities'],
        production_traffic_connected: false,
      });
    }

    if (request.method === 'POST' && url.pathname === '/v1/probe') {
      safeLog({ event: 'stage1_blocked_operation', trace_id: traceId, service, source_group: env.SOURCE_GROUP || null, operation: 'probe_source' });
      return notImplemented(traceId, service, 'probe_source');
    }

    return json({ ok: false, error: 'NOT_FOUND', service }, 404);
  },
};
