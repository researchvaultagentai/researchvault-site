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
async function call(binding, path, options = {}) {
  if (!binding?.fetch) throw Error('smoke_binding_missing');
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([(async () => {
      const response = await binding.fetch('https://rv.internal' + path, { ...options, signal: controller.signal });
      const pdf = /application\/pdf/i.test(response.headers.get('content-type') || '');
      const bytes = await boundedBytes(response, pdf ? MAX_PDF_BYTES : 100000);
      return { ok: response.ok, status: response.status, bytes,
        record: pdf ? decodeRecord(response.headers.get('x-rv-paper')) : undefined,
        data: pdf ? undefined : JSON.parse(new TextDecoder().decode(bytes)) };
    })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('smoke_call_timeout')); }, 30000); })]);
  } finally { clearTimeout(timer); controller.abort(); }
}
async function proofMatches(bytes, proof, doi) {
  return proof?.verdict === 'verified' && proof.verifier === VERIFIER_VERSION && proof.doi === doi
    && proof.byte_length === bytes.length && proof.sha256 === await sha256(bytes);
}
export async function runSmoke(env, { dois = SAMPLE_DOIS, report = value => console.log('[LIVE]', JSON.stringify(value)) } = {}) {
  if (!Array.isArray(dois) || !dois.length || dois.length > 5 || dois.some(doi => normalizeDoi(doi) !== doi)) {
    throw Error('provide_one_to_five_normalized_dois');
  }
  for (const [binding, service] of HEALTH_SERVICES) {
    const result = await call(env[binding], '/health');
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
  main().catch(error => { console.error('Remote smoke stopped:', error.message); process.exitCode = 1; });
}
