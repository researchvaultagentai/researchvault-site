import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { runSmoke, HEALTH_SERVICES, SAMPLE_DOIS } from '../../scripts/smoke-stage2.mjs';
import { makePdf } from './fixtures.js';
import { decodeRecord, encodeRecord, sha256 } from '../common.js';

function setup({ unhealthy = false, uncertain = false, wrongRealHash = false } = {}) {
  const calls = [], reports = [];
  const env = Object.fromEntries(HEALTH_SERVICES.map(([binding]) => [binding, { async fetch(url, init = {}) {
    const path = new URL(url).pathname; calls.push({ binding, path });
    if (path === '/health') return Response.json({ ok: !(unhealthy && binding === 'DOI'), version: 'paper-v2.0',
      schema_ready: true, finder_configured: true, database_configured: true, pdf_text_configured: true, source_bindings: 7 });
    if (path === '/v2/probe') return Response.json({ error: 'invalid_source_request' }, { status: 400 });
    if (path === '/v2/verify') {
      const target = decodeRecord(init.headers['x-rv-target']), bytes = typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(init.body);
      assert.equal(Number(init.headers['content-length']), bytes.length);
      if (bytes.length < 64) return Response.json({ proof: { verdict: 'rejected', reason: 'not_pdf_or_size_limit' } });
      const isWrong = new TextDecoder().decode(bytes).includes('cosmic structures');
      return Response.json({ proof: { verdict: uncertain ? 'uncertain' : isWrong ? 'rejected' : 'verified',
        verifier: 'identity-v1', doi: target.doi, byte_length: bytes.length, sha256: await sha256(bytes), reason: 'fixture_only' } });
    }
    assert.equal(path, '/v2/resolve');
    const { doi } = JSON.parse(init.body), bytes = makePdf();
    return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'x-rv-paper': encodeRecord({
      metadata: { doi }, candidate: { source: 'mock_oa' }, proof: { verdict: 'verified', verifier: 'identity-v1',
        doi, byte_length: bytes.length, sha256: wrongRealHash ? '0'.repeat(64) : await sha256(bytes) },
    }) } });
  } }]));
  return { env, calls, reports, options: { report: value => reports.push(value) } };
}
test('remote smoke checks all nine health endpoints and both identity outcomes before real DOI work', async () => {
  const x = setup(); await runSmoke(x.env, x.options);
  assert.equal(x.calls.filter(c => c.path === '/health').length, 9);
  assert.equal(x.calls.filter(c => c.path === '/v2/verify').length, 4);
  assert.equal(x.calls.filter(c => c.path === '/v2/resolve').length, SAMPLE_DOIS.length);
  assert.equal(x.reports.at(-1).bot_rollout_changed, false);
  assert.equal(x.reports.at(-1).real_pdfs_verified, 2);
});
test('failed health or unreadable positive fixture stops remote work without reporting completion', async () => {
  for (const options of [{ unhealthy: true }, { uncertain: true }]) {
    const x = setup(options); await assert.rejects(runSmoke(x.env, x.options));
    assert.equal(x.calls.filter(c => c.path === '/v2/resolve').length, 0);
    assert.ok(!x.reports.some(r => r.check === 'complete'));
  }
});
test('a real-article proof for changed bytes cannot pass the smoke report', async () => {
  const x = setup({ wrongRealHash: true }); await assert.rejects(runSmoke(x.env, x.options), /incomplete/);
  assert.equal(x.reports.filter(r => r.check === 'real_article' && r.ok).length, 0);
});
test('the local smoke config exposes only nine remote services and initializes Wrangler proxies without credentials', { timeout: 30000 }, async () => {
  const configPath = fileURLToPath(new URL('../wrangler.smoke.jsonc', import.meta.url));
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.services.map(s => [s.binding, s.service]), HEALTH_SERVICES);
  assert.ok(config.services.every(s => s.remote === true));
  assert.equal(config.main, undefined); assert.equal(config.routes, undefined); assert.equal(config.triggers, undefined);
  assert.equal(config.d1_databases, undefined); assert.equal(config.ai, undefined);
  const platform = await getPlatformProxy({ configPath, persist: false, remoteBindings: false });
  try { for (const [binding] of HEALTH_SERVICES) assert.ok(platform.env[binding]?.fetch); }
  finally { await platform.dispose(); }
});

test('plain-text connection loss on the ninth binding is reported and a bounded health retry can recover', async () => {
  const x = setup(), original = x.env.SOURCE_07_LONGTAIL.fetch; let attempts = 0;
  x.env.SOURCE_07_LONGTAIL.fetch = async (...args) => new URL(args[0]).pathname === '/health' && ++attempts === 1
    ? new Response('Error: Network connection lost.', { status: 500, headers: { 'content-type': 'text/plain' } }) : original(...args);
  await runSmoke(x.env, { ...x.options, pause: async () => {} });
  assert.equal(attempts, 2);
  const failure = x.reports.find(r => r.check === 'health_attempt');
  assert.equal(failure.service, 'rv-source-07-longtail'); assert.equal(failure.http_status, 500);
  assert.equal(failure.reason, 'non_json_response'); assert.match(failure.detail, /Network connection lost/);
  assert.equal(x.reports.at(-1).check, 'complete');
});
test('persistent plain-text health failures stop after three attempts and preserve a sanitized diagnostic', async () => {
  const x = setup(); let attempts = 0;
  x.env.SOURCE_07_LONGTAIL.fetch = async () => {
    attempts++; return new Response('Error: Network connection lost. https://private.example/path?token=unsafe token=unsafe', {
      status: 502, headers: { 'content-type': 'text/plain', 'cf-ray': '1234567890abcdef-FRA' },
    });
  };
  await assert.rejects(runSmoke(x.env, { ...x.options, pause: async () => {} }), /rv-source-07-longtail/);
  assert.equal(attempts, 3); assert.equal(x.calls.filter(c => c.path === '/v2/verify').length, 0);
  assert.equal(x.reports.at(-1).ok, false);
  assert.ok(!JSON.stringify(x.reports).includes('unsafe'));
  assert.ok(!JSON.stringify(x.reports).includes('private.example'));
});
test('authentication errors stop immediately and persistent verification connection loss stops after three calls', async () => {
  const a = setup(); let authCalls = 0;
  a.env.DOI.fetch = async () => { authCalls++; return new Response('Access denied', { status: 403 }); };
  await assert.rejects(runSmoke(a.env, { ...a.options, pause: async () => {} })); assert.equal(authCalls, 1);
  const b = setup(), original = b.env.PDF.fetch; let postCalls = 0;
  b.env.PDF.fetch = async (url, init) => init?.method === 'POST'
    ? (postCalls++, new Response('Error: Network connection lost.', { status: 500 })) : original(url, init);
  await assert.rejects(runSmoke(b.env, { ...b.options, pause: async () => {} }), /non_json_response/);
  assert.equal(postCalls, 3); assert.ok(!b.reports.some(r => r.check === 'complete'));
  assert.equal(b.reports.filter(r => r.check === 'verification_transport_retry').length, 2);
  assert.equal(b.calls.filter(c => c.path === '/v2/resolve').length, 0);
});

test('verification connection recovery replays identical fresh bytes and still requires both real article proofs', async () => {
  const x = setup(), original = x.env.PDF.fetch, pauses = [], snapshots = [];
  let attempts = 0;
  x.env.PDF.fetch = async (url, init) => {
    if (init?.method !== 'POST' || typeof init.body === 'string') return original(url, init);
    const bytes = new Uint8Array(init.body);
    if (bytes.length < 64 || new TextDecoder().decode(bytes).includes('cosmic structures')) return original(url, init);
    attempts++; snapshots.push(bytes.slice());
    const response = await original(url, init); // The remote verifier may already have finished.
    if (attempts < 3) {
      structuredClone(init.body, { transfer: [init.body] }); // Simulate consumed request transport.
      return new Response('Error: Network connection lost. token=unsafe', { status: 500 });
    }
    return response;
  };
  await runSmoke(x.env, { ...x.options, pause: async ms => { pauses.push(ms); } });
  assert.equal(attempts, 3); assert.deepEqual(pauses, [1000, 2000]);
  for (const bytes of snapshots) assert.deepEqual(bytes, makePdf());
  assert.equal(x.reports.at(-1).verification_transport_retries, 2);
  assert.equal(x.reports.filter(r => r.check === 'real_article' && r.ok).length, 2);
  assert.equal(x.calls.filter(c => c.path === '/v2/resolve').length, 2);
  assert.ok(!JSON.stringify(x.reports).includes('unsafe'));
});

test('verification retries exclude auth, arbitrary HTTP errors, unreadable results and incorrect identity verdicts', async () => {
  for (const failure of [
    () => new Response('Access denied', { status: 403 }),
    () => new Response('Network connection lost.', { status: 401 }),
    () => new Response('Worker threw exception', { status: 500 }),
    () => Response.json({ error: 'converter_failed' }, { status: 503 }),
    () => new Response('malformed result', { status: 200 }),
    () => Response.json({ proof: { verdict: 'uncertain', reason: 'pdf_text_service_failed' } }),
  ]) {
    const x = setup(), original = x.env.PDF.fetch; let calls = 0;
    x.env.PDF.fetch = async (url, init) => init?.method === 'POST' ? (calls++, failure()) : original(url, init);
    await assert.rejects(runSmoke(x.env, { ...x.options, pause: async () => {} }));
    assert.equal(calls, 1); assert.ok(!x.reports.some(r => r.check === 'verification_transport_retry' || r.check === 'complete'));
  }
  const x = setup({ uncertain: true });
  await assert.rejects(runSmoke(x.env, { ...x.options, pause: async () => {} }), /remote_conversion_or_identity_failed/);
  assert.equal(x.calls.filter(c => c.path === '/v2/verify').length, 3);
  assert.equal(x.calls.filter(c => c.path === '/v2/resolve').length, 0);
});

test('stateful DOI resolution requests are not replayed after a lost connection', async () => {
  const x = setup(); let calls = 0;
  x.env.DOI.fetch = async url => {
    if (new URL(url).pathname === '/health') return Response.json({ ok: true, version: 'paper-v2.0', schema_ready: true, finder_configured: true });
    calls++; throw Error('Network connection lost.');
  };
  await assert.rejects(runSmoke(x.env, { ...x.options, pause: async () => {} }), /binding_call_failed/);
  assert.equal(calls, 1); assert.ok(!x.reports.some(r => r.check === 'complete'));
});

test('a thrown verification connection error can recover without changing verdict requirements', async () => {
  const x = setup(), original = x.env.PDF.fetch; let failures = 0;
  x.env.PDF.fetch = async (url, init) => {
    if (init?.method === 'POST' && failures++ === 0) throw Error('Network connection lost.');
    return original(url, init);
  };
  await runSmoke(x.env, { ...x.options, pause: async () => {} });
  assert.equal(x.reports.at(-1).verification_transport_retries, 1);
  assert.equal(x.reports.at(-1).real_pdfs_verified, 2);
});
