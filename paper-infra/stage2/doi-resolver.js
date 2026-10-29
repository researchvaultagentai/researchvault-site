import { PIPELINE_VERSION, MAX_PDF_BYTES, RequestBudget, ResolutionError, boundedBytes, decodeRecord, encodeRecord,
  json, normalizeDoi, requestInput, sha256, VERIFIER_VERSION, logEvent } from './common.js';
import { resolveMetadata } from './metadata.js';
import { PaperStore } from './store.js';

function checkedUsage(value) {
  if (!Number.isInteger(value?.external_requests) || value.external_requests < 0 || value.external_requests > 16
    || !Number.isInteger(value?.worker_invocations) || value.worker_invocations < 1 || value.worker_invocations > 5) {
    throw new ResolutionError('invalid_finder_usage', 502);
  }
  return value;
}

export function createDoiResolver({ fetcher = fetch, clock = Date.now } = {}) {
  return { async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') {
      let schema = false;
      try { schema = Number((await env.PAPER_DB.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name IN ('rv_paper_jobs','rv_paper_cache','rv_paper_source_stats','rv_paper_metadata')").first()).n) === 4; } catch {}
      return json({ ok: schema && Boolean(env.PDF_FINDER), role: 'doi_resolver', version: PIPELINE_VERSION,
        schema_ready: schema, finder_configured: Boolean(env.PDF_FINDER) });
    }
    if (request.method !== 'POST' || path !== '/v2/resolve') return new Response('Not found', { status: 404 });
    let budget, store, doi, lease, held = false, controller, timer;
    let childUsage = { external_requests: 0, worker_invocations: 0 };
    try {
      const input = await requestInput(request);
      const deadline = Math.min(clock() + 18000, Number(input.deadline) || clock() + 18000);
      budget = new RequestBudget({ fetcher, deadline, maxRequests: 2, clock });
      store = new PaperStore(env.PAPER_DB, clock); doi = normalizeDoi(input.doi);
      let metadata;
      if (doi) {
        lease = crypto.randomUUID(); held = await store.claim(doi, lease);
        if (!held) return json({ status: 'deferred', retryable: true, retry_after_ms: 30000, version: PIPELINE_VERSION,
          usage: { external_requests: 0, worker_invocations: 1 } });
        metadata = await store.metadata(doi);
      }
      if (!metadata) {
        metadata = await resolveMetadata(input, budget); doi = metadata.doi;
        if (!held) {
          lease = crypto.randomUUID(); held = await store.claim(doi, lease);
          if (!held) return json({ status: 'deferred', retryable: true, retry_after_ms: 30000, version: PIPELINE_VERSION,
            usage: { external_requests: budget.requests, worker_invocations: 1 } });
        }
        await store.saveMetadata(metadata);
      }
      if (!env.PDF_FINDER?.fetch) throw new ResolutionError('finder_binding_unavailable', 503);
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), Math.max(1, deadline - clock()));
      const response = await env.PDF_FINDER.fetch(new Request('https://rv.internal/v2/find', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ metadata, deadline }),
      }));
      const bytes = await boundedBytes(response, /application\/pdf/.test(response.headers.get('content-type') || '') ? MAX_PDF_BYTES : 100000);
      if (response.ok && /application\/pdf/.test(response.headers.get('content-type') || '')) {
        const record = decodeRecord(response.headers.get('x-rv-paper'));
        if (record.proof?.verdict !== 'verified' || record.proof?.verifier !== VERIFIER_VERSION || record.proof.doi !== doi
          || record.metadata?.doi !== doi || record.proof.sha256 !== await sha256(bytes)) throw new ResolutionError('invalid_finder_proof', 502);
        childUsage = checkedUsage(record.usage);
        record.usage = { ...childUsage, external_requests: budget.requests + childUsage.external_requests, worker_invocations: 1 + childUsage.worker_invocations };
        await store.finish(doi, lease, 'verified'); held = false;
        return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-rv-paper': encodeRecord(record) } });
      }
      const result = JSON.parse(new TextDecoder().decode(bytes)); childUsage = checkedUsage(result.usage);
      const retry = Math.max(30000, Math.min(300000, Number(result.retry_after_ms) || 180000));
      await store.finish(doi, lease, result.status || 'not_found', retry); held = false;
      return json({ ...result, metadata, retryable: true, retry_after_ms: retry,
        usage: { external_requests: budget.requests + Number(childUsage.external_requests || 0),
          worker_invocations: 1 + Number(childUsage.worker_invocations || 1) }, version: PIPELINE_VERSION }, response.ok ? 200 : 503);
    } catch (error) {
      const code = error instanceof ResolutionError ? error.code : 'resolution_unavailable';
      logEvent('resolution_deferred', { reason: code });
      return json({ status: 'error', error: code, retryable: true, retry_after_ms: error.retryAfterMs || 60000,
        usage: { external_requests: (budget?.requests || 0) + Math.max(16, Number(childUsage.external_requests || 0)),
          worker_invocations: 6 }, version: PIPELINE_VERSION }, error.status >= 400 && error.status <= 599 ? error.status : 503);
    } finally {
      clearTimeout(timer); controller?.abort(); budget?.cancel();
      if (held) await store.finish(doi, lease, 'interrupted', 30000).catch(() => {});
    }
  } };
}
export default createDoiResolver();
