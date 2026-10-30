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
const connectionLoss = value => /^(?:Error:\s*)?(?:Network connection lost\b|daemonDown\b)/i.test(String(value || '').trim());
function safeDetail(value) {
  return String(value || '').replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[credential]')
    .replace(/\b(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*["']?[^"'&,\s]+/gi, '$1=[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]').replace(/\s+/g, ' ').slice(0, 220);
}
class SmokeCallError extends Error {
  constructor(reason, { status, contentType, detail, retryable = false, connectionLost = false, ray } = {}) {
    super(reason); this.details = { reason, http_status: status, content_type: contentType,
      detail: safeDetail(detail), retryable, cf_ray: ray };
    this.retryable = retryable; this.connectionLost = connectionLost;
  }
}
function fixedBodyOptions(options) {
  if (options.body == null) return options;
  let body = options.body, length;
  if (typeof body === 'string') length = new TextEncoder().encode(body).length;
  else if (ArrayBuffer.isView(body)) {
    body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice().buffer; length = body.byteLength;
  } else if (body instanceof ArrayBuffer) { body = body.slice(0); length = body.byteLength; }
  else throw Error('unsupported_smoke_body');
  return { ...options, body, headers: { ...options.headers, 'content-length': String(length) } };
}
async function call(binding, path, options = {}) {
  if (!binding?.fetch) throw Error('smoke_binding_missing');
  options = fixedBodyOptions(options);
  const controller = new AbortController(); let timer, phase = 'waiting_for_headers';
  try {
    return await Promise.race([(async () => {
      const response = await binding.fetch('https://rv.internal' + path, { ...options, signal: controller.signal });
      phase = 'reading_response_body';
      const pdf = /application\/pdf/i.test(response.headers.get('content-type') || '');
      const bytes = await boundedBytes(response, pdf ? MAX_PDF_BYTES : 100000);
      phase = 'decoding_response';
      let data;
      if (!pdf) {
        const text = new TextDecoder().decode(bytes);
        try { data = JSON.parse(text); }
        catch {
          throw new SmokeCallError('non_json_response', { status: response.status,
            contentType: safeDetail(response.headers.get('content-type') || 'unspecified'), detail: text,
            ray: safeDetail(response.headers.get('cf-ray') || '') || undefined,
            retryable: TRANSIENT_HTTP.has(response.status),
            connectionLost: TRANSIENT_HTTP.has(response.status) && connectionLoss(text) });
        }
      }
      return { ok: response.ok, status: response.status, bytes,
        record: pdf ? decodeRecord(response.headers.get('x-rv-paper')) : undefined, data };
    })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SmokeCallError('smoke_call_timeout', { retryable: true })); }, 30000); })]);
  } catch (error) {
    const failure = error instanceof SmokeCallError ? error : new SmokeCallError('binding_call_failed', { detail: error.message,
      retryable: /network|connection|fetch failed|timeout|temporar|ECONN|socket/i.test(error.message || ''),
      connectionLost: connectionLoss(error.message) });
    failure.details.request_path = path; failure.details.phase = phase;
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
  let verificationRetries = 0;
  // This private endpoint only checks supplied bytes: no D1, publishing or bot
  // effects. Replay only a recognized broken connection, never a verifier result,
  // timeout, auth failure, generic 5xx or the stateful DOI resolution request.
  const verifyCall = async (label, options) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await call(env.PDF, '/v2/verify', options); }
      catch (error) {
        if (!error.connectionLost || attempt === 3) throw error;
        const delay = attempt * 1000; verificationRetries++;
        report({ check: 'verification_transport_retry', service: 'rv-pdf-finder', probe: label,
          attempt, retry_in_ms: delay, ...error.details });
        await pause(delay);
      }
    }
  };
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
  report({ check: 'upload_json', phase: 'start' });
  const uploadJson = await verifyCall('upload_json', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-rv-target': encodeRecord(fixtureTarget) }, body: '{}' });
  const jsonOk = uploadJson.ok && uploadJson.data?.proof?.verdict === 'rejected'
    && uploadJson.data?.proof?.reason === 'not_pdf_or_size_limit';
  report({ check: 'upload_json', ok: jsonOk });
  if (!jsonOk) throw Error('json_upload_probe_failed');
  report({ check: 'upload_pdf', phase: 'start' });
  const uploadPdf = await verifyCall('upload_pdf', { method: 'POST',
    headers: { 'content-type': 'application/pdf', 'x-rv-target': encodeRecord(fixtureTarget) },
    body: new TextEncoder().encode('not a PDF') });
  const pdfOk = uploadPdf.ok && uploadPdf.data?.proof?.verdict === 'rejected'
    && uploadPdf.data?.proof?.reason === 'not_pdf_or_size_limit';
  report({ check: 'upload_pdf', ok: pdfOk, verdict: uploadPdf.data?.proof?.verdict });
  if (!pdfOk) throw Error('binary_upload_probe_failed');
  const correct = makePdf();
  const wrong = makePdf(['Unrelated observations of remote cosmic structures', 'B Jones', '2025', '10.5555/other',
    'Abstract', 'Synthetic document that must never match the requested robotics article.']);
  for (const [label, bytes, shouldVerify] of [['matching_pdf', correct, true], ['wrong_pdf', wrong, false]]) {
    report({ check: label, phase: 'start', request_bytes: bytes.length });
    const result = await verifyCall(label, { method: 'POST',
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
      reason: result.record?.proof?.reason || result.data?.error, usage: result.record?.usage || result.data?.usage, diagnostics: result.data?.diagnostics });
    if (valid) found++;
  }
  if (found !== dois.length) throw Error('real_article_smoke_incomplete');
  report({ check: 'complete', ok: true, real_pdfs_verified: found, verification_transport_retries: verificationRetries, bot_rollout_changed: false,
    note: 'Representative smoke only; inspect live CPU/errors and broader publishers before promotion.' });
}
async function main() {
  const { getPlatformProxy } = await import('wrangler');
  const { startSmokeTail } = await import('./smoke-tail.mjs');
  const report = value => console.log('[LIVE]', JSON.stringify(value));
  let platform, trace;
  try {
    console.log('Testing deployed private paper services using the existing Wrangler login. No bot deployment or database import.');
    platform = await getPlatformProxy({ configPath: fileURLToPath(new URL('../stage2/wrangler.smoke.jsonc', import.meta.url)),
      persist: false, remoteBindings: true });
    trace = await startSmokeTail(report);
    await runSmoke(platform.env, { dois: process.argv.slice(2).length ? process.argv.slice(2) : SAMPLE_DOIS, report });
  } finally {
    if (trace) await new Promise(resolve => setTimeout(resolve, 1200));
    await trace?.stop(); await platform?.dispose();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Remote smoke stopped:', error.details ? JSON.stringify(error.details) : safeDetail(error.message)); process.exitCode = 1; });
}
