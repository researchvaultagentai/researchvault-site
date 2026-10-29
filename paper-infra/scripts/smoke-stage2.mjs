import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { boundedBytes, decodeRecord, encodeRecord, MAX_PDF_BYTES, normalizeDoi, PIPELINE_VERSION,
  sha256, VERIFIER_VERSION } from '../stage2/common.js';
import { makePdf, metadata as fixtureTarget } from '../stage2/test/fixtures.js';

export const HEALTH_SERVICES = [
  ['DOI', 'rv-doi-resolver'], ['PDF', 'rv-pdf-finder'],
  ['SOURCE_01_OA', 'rv-source-01-oa'], ['SOURCE_02_BIOMED', 'rv-source-02-biomed'],
  ['SOURCE_03_PREPRINTS', 'rv-source-03-preprints'], ['SOURCE_04_PUBLISHERS_A', 'rv-source-04-publishers-a'],
  ['SOURCE_05_PUBLISHERS_B', 'rv-source-05-publishers-b'], ['SOURCE_06_SOCIETY_TECH', 'rv-source-06-society-tech'],
  ['SOURCE_07_LONGTAIL', 'rv-source-07-longtail'],
];
export const SAMPLE_DOIS = ['10.1371/journal.pmed.0020124', '10.1371/journal.pone.0000308'];
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);
function safeDetail(value) {
  return String(value || '').replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[credential]')
    .replace(/\b(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*["']?[^"'&,\s]+/gi, '$1=[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]').replace(/\s+/g, ' ').slice(0, 220);
}
class SmokeCallError extends Error {
  constructor(reason, { status, contentType, detail, retryable = false, ray } = {}) {
    super(reason); this.details = { reason, http_status: status, content_type: contentType,
      detail: safeDetail(detail), retryable, cf_ray: ray };
    this.retryable = retryable;
  }
}
async function call(binding, path, options = {}) {
  if (!binding?.fetch) throw Error('smoke_binding_missing');
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([(async () => {
      const response = await binding.fetch('https://rv.internal' + path, { ...options, signal: controller.signal });
      const pdf = /application\/pdf/i.test(response.headers.get('content-type') || '');
      const bytes = await boundedBytes(response, pdf ? MAX_PDF_BYTES : 100000);
      let data;
      if (!pdf) {
        const text = new TextDecoder().decode(bytes);
        try { data = JSON.parse(text); }
        catch {
          throw new SmokeCallError('non_json_response', { status: response.status,
            contentType: safeDetail(response.headers.get('content-type') || 'unspecified'), detail: text,
            ray: safeDetail(response.headers.get('cf-ray') || '') || undefined,
            retryable: TRANSIENT_HTTP.has(response.status) || /^(?:Error:\s*)?(?:Network connection lost|daemonDown)/i.test(text.trim()) });
        }
      }
      return { ok: response.ok, status: response.status, bytes,
        record: pdf ? decodeRecord(response.headers.get('x-rv-paper')) : undefined, data };
    })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SmokeCallError('smoke_call_timeout', { retryable: true })); }, 30000); })]);
  } catch (error) {
    const failure = error instanceof SmokeCallError ? error : new SmokeCallError('binding_call_failed', { detail: error.message,
      retryable: /network|connection|fetch failed|timeout|temporar|ECONN|socket/i.test(error.message || '') });
    failure.details.request_path = path;
    throw failure;
  } finally { clearTimeout(timer); }
}
async function proofMatches(bytes, proof, doi) {
  return proof?.verdict === 'verified' && proof.verifier === VERIFIER_VERSION && proof.doi === doi
    && proof.byte_length === bytes.length && proof.sha256 === await sha256(bytes);
}
export async function runSmoke(env, { dois = SAMPLE_DOIS, report = value => console.log('[LIVE]', JSON.stringify(value)),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!Array.isArray(dois) || !dois.length || dois.length > 5 || dois.some(doi => normalizeDoi(doi) !== doi)) {
    throw Error('provide_one_to_five_normalized_dois');
  }
  for (const [binding, service] of HEALTH_SERVICES) {
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await call(env[binding], '/health');
        if (TRANSIENT_HTTP.has(result.status)) throw new SmokeCallError('health_http_error', {
          status: result.status, detail: result.data?.error || result.data?.message, retryable: true });
        break;
      } catch (error) {
        report({ check: 'health_attempt', service, attempt, ok: false,
          ...(error.details || { reason: 'health_call_failed' }) });
        if (!error.retryable || attempt === 3) {
          report({ check: 'health', service, ok: false });
          throw Error('remote_health_failed:' + service + ':' + error.message);
        }
        await pause(attempt * 500);
      }
    }
    const data = result.data;
    const ok = result.ok && data?.ok === true && data.version === PIPELINE_VERSION
      && (binding !== 'DOI' || data.schema_ready === true && data.finder_configured === true)
      && (binding !== 'PDF' || data.database_configured === true && data.pdf_text_configured === true && data.source_bindings === 7);
    report({ check: 'health', service, ok });
    if (!ok) throw Error('remote_health_failed:' + service);
  }
  const correct = makePdf();
  const wrong = makePdf(['Unrelated observations of remote cosmic structures', 'B Jones', '2025', '10.5555/other',
    'Abstract', 'Synthetic document that must never match the requested robotics article.']);
  for (const [label, bytes, shouldVerify] of [['matching_pdf', correct, true], ['wrong_pdf', wrong, false]]) {
    const result = await call(env.PDF, '/v2/verify', { method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-rv-target': encodeRecord(fixtureTarget) }, body: bytes });
    const proof = result.data?.proof;
    const ok = result.ok && (shouldVerify ? await proofMatches(bytes, proof, fixtureTarget.doi) : proof?.verdict === 'rejected' || proof?.verdict === 'uncertain');
    report({ check: label, ok, verdict: proof?.verdict || 'error', reason: proof?.reason || result.data?.error || 'unknown' });
    if (!ok) throw Error('remote_conversion_or_identity_failed:' + label);
  }
  let found = 0;
  for (const doi of dois) {
    const started = Date.now();
    const result = await call(env.DOI, '/v2/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doi }) });
    const valid = result.ok && result.record?.metadata?.doi === doi
      && await proofMatches(result.bytes, result.record?.proof, doi);
    report({ check: 'real_article', doi, ok: Boolean(valid), elapsed_ms: Date.now() - started,
      status: result.record ? 'pdf' : result.data?.status || 'error', source: result.record?.candidate?.source,
      reason: result.record?.proof?.reason || result.data?.error, usage: result.record?.usage || result.data?.usage });
    if (valid) found++;
  }
  if (found !== dois.length) throw Error('real_article_smoke_incomplete');
  report({ check: 'complete', ok: true, real_pdfs_verified: found, bot_rollout_changed: false,
    note: 'Representative smoke only; inspect live CPU/errors and broader publishers before promotion.' });
}
async function main() {
  const { getPlatformProxy } = await import('wrangler');
  let platform;
  try {
    console.log('Testing deployed private paper services using the existing Wrangler login. No bot deployment or database import.');
    platform = await getPlatformProxy({ configPath: fileURLToPath(new URL('../stage2/wrangler.smoke.jsonc', import.meta.url)),
      persist: false, remoteBindings: true });
    await runSmoke(platform.env, { dois: process.argv.slice(2).length ? process.argv.slice(2) : SAMPLE_DOIS });
  } finally { await platform?.dispose(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Remote smoke stopped:', error.details ? JSON.stringify(error.details) : safeDetail(error.message)); process.exitCode = 1; });
}
