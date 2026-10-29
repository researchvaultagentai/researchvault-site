import { PIPELINE_VERSION, RequestBudget, ResolutionError, json, normalizeDoi, requestInput } from './common.js';
import { probeSource } from './sources.js';

export function createSourceWorker(fetcher = fetch) {
  return { async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') return json({ ok: true, version: PIPELINE_VERSION, role: 'source', group: env.SOURCE_GROUP });
    if (request.method !== 'POST' || path !== '/v2/probe') return new Response('Not found', { status: 404 });
    let budget;
    try {
      const input = await requestInput(request), metadata = input.metadata;
      if (!metadata || normalizeDoi(metadata.doi) !== metadata.doi || typeof metadata.title !== 'string' || metadata.title.length > 2000) throw new ResolutionError('invalid_source_request', 400);
      const deadline = Math.min(Date.now() + 5000, Number(input.deadline) || Date.now() + 5000);
      const maxRequests = Number.isInteger(input.max_requests) ? Math.max(1, Math.min(3, input.max_requests)) : 3;
      budget = new RequestBudget({ fetcher, maxRequests, deadline });
      const candidates = await probeSource(env.SOURCE_GROUP, metadata, budget, env);
      return json({ status: candidates.length ? 'candidate' : 'not_found', candidates, retryable: !candidates.length,
        usage: { external_requests: budget.requests }, version: PIPELINE_VERSION });
    } catch (error) {
      return json({ status: error.status === 429 ? 'rate_limited' : error.status === 403 ? 'blocked' : 'error',
        candidates: [], error: error instanceof ResolutionError ? error.code : 'source_unavailable', retryable: true,
        retry_after_ms: error.retryAfterMs || 0, http_status: Number(error.status) || 502,
        usage: { external_requests: budget?.requests || 0 }, version: PIPELINE_VERSION }, error.status >= 400 && error.status <= 599 ? error.status : 502);
    } finally { budget?.cancel(); }
  } };
}
export default createSourceWorker();
