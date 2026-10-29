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
    if (path === '/v2/verify') {
      const target = decodeRecord(init.headers['x-rv-target']), bytes = init.body;
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
  assert.equal(x.calls.filter(c => c.path === '/v2/verify').length, 2);
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
