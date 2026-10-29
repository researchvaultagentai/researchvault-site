import { PIPELINE_VERSION, MAX_PDF_BYTES, RequestBudget, ResolutionError, boundedBytes, decodeRecord, encodeRecord,
  json, normalizeDoi, publicUrl, requestInput, sha256, VERIFIER_VERSION, logEvent } from './common.js';
import { inspectProductionPdf } from './verifier.js';
import { PaperStore, sourcePriority } from './store.js';

export const SOURCE_ROUTES = [
  ['SOURCE_01_OA', 'oa', 90], ['SOURCE_02_BIOMED', 'biomed', 65], ['SOURCE_03_PREPRINTS', 'preprints', 35],
  ['SOURCE_04_PUBLISHERS_A', 'publishers-a', 70], ['SOURCE_05_PUBLISHERS_B', 'publishers-b', 70],
  ['SOURCE_06_SOCIETY_TECH', 'society-tech', 70], ['SOURCE_07_LONGTAIL', 'longtail', 45],
];

export function routeSources(metadata, health = new Map(), now = Date.now()) {
  const biomedical = /(?:medic|biolog|biomed|oncolog|clinical|health|cell\b|neuro|pharma|immun|surg)/i.test(`${metadata.journal} ${metadata.title}`);
  const repository = /^(?:10\.48550\/arxiv\.|10\.1101\/)/.test(metadata.doi);
  return SOURCE_ROUTES.filter(([, group]) => ['oa', 'longtail'].includes(group)
    || group === metadata.family || (group === 'biomed' && biomedical) || (group === 'preprints' && repository))
    .map(([binding, group, base]) => ({ binding, group, priority: sourcePriority(base + (group === metadata.family ? 15 : 0)
      + (group === 'preprints' && repository ? 70 : 0), health.get(group), now) }))
    .filter(route => Number.isFinite(route.priority)).sort((a, b) => b.priority - a.priority).slice(0, 4);
}

function slimMetadata(metadata) {
  return { ...metadata, title: metadata.title.slice(0, 800), authors: (metadata.authors || []).slice(0, 12),
    links: (metadata.links || []).slice(0, 6) };
}

function pdfResponse(result, usage) {
  const metadata = slimMetadata(result.metadata);
  delete metadata.links;
  const candidate = { url: result.candidate.url, source: result.candidate.source, group: result.candidate.group,
    version: result.candidate.version || 'unknown', license: result.candidate.license || null };
  return new Response(result.bytes, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store',
    'x-rv-paper': encodeRecord({ metadata, candidate, proof: result.proof, usage, version: PIPELINE_VERSION }) } });
}

export function createPdfFinder({ fetcher = fetch, verifier, clock = Date.now } = {}) {
  return { async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') return json({ ok: true, role: 'pdf_finder', version: PIPELINE_VERSION,
      database_configured: Boolean(env.PAPER_DB), pdf_text_configured: Boolean(env.AI?.toMarkdown),
      source_bindings: SOURCE_ROUTES.filter(([binding]) => env[binding]).length });
    if (request.method === 'POST' && path === '/v2/verify') {
      try {
        const target = decodeRecord(request.headers.get('x-rv-target'));
        if (normalizeDoi(target.doi) !== target.doi || typeof target.title !== 'string'
          || target.title.length < 8 || target.title.length > 2000) throw new ResolutionError('invalid_target', 400);
        const bytes = await boundedBytes(request, MAX_PDF_BYTES);
        const proof = await (verifier || inspectProductionPdf)(bytes, target, {
          converter: typeof env.AI?.toMarkdown === 'function' ? (...args) => env.AI.toMarkdown(...args) : undefined,
          deadline: clock() + 4000,
        });
        return json({ proof, version: PIPELINE_VERSION });
      } catch (error) { return json({ error: error.code || 'verification_unavailable' }, error.status || 503); }
    }
    if (request.method !== 'POST' || path !== '/v2/find') return new Response('Not found', { status: 404 });
    let budget, store;
    let external = 0, invocations = 1;
    try {
      const input = await requestInput(request), metadata = input.metadata;
      if (!metadata || normalizeDoi(metadata.doi) !== metadata.doi || typeof metadata.title !== 'string'
        || metadata.title.length < 8 || metadata.title.length > 2000) throw new ResolutionError('invalid_finder_request', 400);
      const deadline = Math.min(clock() + 13000, Number(input.deadline) || clock() + 13000);
      budget = new RequestBudget({ fetcher, deadline, maxRequests: 8, clock });
      store = new PaperStore(env.PAPER_DB, clock);
      let conversions = 0;
      const actualVerifier = verifier || ((bytes, target, options) => inspectProductionPdf(bytes, target, {
        ...options, converter: typeof env.AI?.toMarkdown === 'function' ? (...args) => env.AI.toMarkdown(...args) : undefined,
      }));
      const verify = async (...args) => {
        if (conversions >= 3) return { verdict: 'uncertain', reason: 'verification_budget_exhausted' };
        conversions++; return actualVerifier(...args);
      };
      const usage = () => ({ external_requests: external + budget.requests, worker_invocations: invocations, pdf_conversions: conversions });
      const seenUrls = new Set(), seenHashes = new Set();
      const cached = await store.cached(metadata.doi);
      if (cached) {
        try {
          const download = await budget.response(cached.candidate.url, { accept: 'application/pdf', maxBytes: MAX_PDF_BYTES, redirects: 2 });
          const hash = await sha256(download.bytes);
          // Never trust a cached URL after its bytes change. Reparse the changed file.
          const proof = hash === cached.proof.sha256 && cached.proof.verifier === VERIFIER_VERSION
            && cached.proof.doi === metadata.doi && cached.metadata.title === metadata.title
            ? cached.proof : await verify(download.bytes, metadata, { deadline });
          if (proof.verdict === 'verified') {
            const candidate = { ...cached.candidate, url: download.url };
            await store.cache(metadata.doi, metadata, candidate, proof);
            return pdfResponse({ metadata, candidate, proof, bytes: download.bytes }, usage());
          }
          seenHashes.add(hash); seenUrls.add(cached.candidate.url);
        } catch { seenUrls.add(cached.candidate.url); }
        await store.invalidate(metadata.doi);
      }
      const health = await store.health(metadata.family || 'longtail');
      const routes = routeSources(metadata, health, clock()).filter(route => env[route.binding]?.fetch);
      for (let offset = 0; offset < routes.length && budget.remaining() > 300; offset += 2) {
        // At most two discovery sources run together. Fetch/verify candidates sequentially.
        const wave = routes.slice(offset, offset + 2);
        const sourceQuota = Math.min(3, Math.floor((16 - external - budget.requests - 3) / wave.length));
        if (sourceQuota < 1) break;
        const replies = await Promise.all(wave.map(async route => {
          const started = clock(); invocations++;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(5200, deadline - clock())));
          try {
            const response = await env[route.binding].fetch(new Request('https://rv.internal/v2/probe', {
              method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
              body: JSON.stringify({ metadata: slimMetadata(metadata), deadline: Math.min(deadline, clock() + 4800), max_requests: sourceQuota }),
            }));
            const data = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 80000)));
            const count = Number(data.usage?.external_requests);
            if (!Number.isInteger(count) || count < 0 || count > sourceQuota || !Array.isArray(data.candidates) || data.candidates.length > 15) throw new Error('invalid_source_contract');
            external += count;
            if (!response.ok || !data.candidates.length) await store.record(route.group, metadata.family || 'longtail', {
              latencyMs: clock() - started, retryAfterMs: Math.min(86400000, Number(data.retry_after_ms) || 0), httpStatus: data.http_status || response.status,
            });
            return data.candidates.map(item => ({ ...item, group: route.group }));
          } catch {
            // Unknown source consumption is charged conservatively against the total budget.
            external += sourceQuota;
            await store.record(route.group, metadata.family || 'longtail', { latencyMs: clock() - started, retryAfterMs: 60000 });
            return [];
          } finally { clearTimeout(timer); }
        }));
        budget.maxRequests = Math.min(8, 16 - external);
        const candidates = replies.flat().filter(item => {
          try { item.url = publicUrl(item.url); } catch { return false; }
          if (seenUrls.has(item.url)) return false;
          seenUrls.add(item.url); return true;
        }).sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
        for (const candidate of candidates) {
          if (budget.requests >= 8 || external + budget.requests >= 16 || budget.remaining() < 300) break;
          const started = clock();
          try {
            const download = await budget.response(candidate.url, { accept: 'application/pdf', maxBytes: MAX_PDF_BYTES, redirects: 2 });
            const hash = await sha256(download.bytes);
            if (seenHashes.has(hash)) continue;
            seenHashes.add(hash);
            const proof = await verify(download.bytes, metadata, { deadline });
            const success = proof.verdict === 'verified';
            await store.record(candidate.group, metadata.family || 'longtail', { success, latencyMs: clock() - started, httpStatus: 200 });
            if (success) {
              const resolved = { ...candidate, url: download.url };
              await store.cache(metadata.doi, metadata, resolved, proof);
              logEvent('pdf_verified', { source: candidate.group, reason: proof.reason, external_requests: usage().external_requests });
              return pdfResponse({ metadata, candidate: resolved, proof, bytes: download.bytes }, usage());
            }
          } catch (error) {
            await store.record(candidate.group, metadata.family || 'longtail', { latencyMs: clock() - started,
              httpStatus: Number(error.status) || 0, retryAfterMs: error.status === 429 ? error.retryAfterMs : error.status === 403 ? 300000 : 0 });
          }
        }
        if (external + budget.requests >= 16 || budget.requests >= 8) break;
      }
      return json({ status: budget.remaining() < 100 ? 'timeout' : 'not_found', metadata, retryable: true,
        retry_after_ms: 180000, usage: usage(), version: PIPELINE_VERSION });
    } catch (error) {
      return json({ status: 'error', error: error instanceof ResolutionError ? error.code : 'finder_unavailable', retryable: true,
        usage: { external_requests: external + (budget?.requests || 0), worker_invocations: invocations }, version: PIPELINE_VERSION }, 503);
    } finally { budget?.cancel(); }
  } };
}
export default createPdfFinder();
