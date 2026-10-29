import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { crossref, metadata, makePdf } from './fixtures.js';
import { decodeRecord } from '../common.js';

test('nine real workerd Workers share D1, service bindings and the PDF text RPC contract', { timeout: 30000 }, async () => {
  const bytes = makePdf(); let external = 0, conversions = 0;
  const outbound = async request => {
    external++;
    if (request.url.includes('api.crossref.org/works/')) return Response.json(crossref());
    if (request.url.includes('api.unpaywall.org/')) return Response.json({ doi: metadata.doi,
      oa_locations: [{ url_for_pdf: 'https://papers.example.edu/good.pdf', version: 'publishedVersion' }] });
    if (request.url.endsWith('/good.pdf')) return new Response(bytes);
    // Other specialist sources can fail independently without taking down OA resolution.
    return new Response('provider unavailable', { status: 503 });
  };
  const configs = ['doi-resolver', 'pdf-finder', ...Array.from({ length: 7 }, (_, i) => 'source-0' + (i + 1))];
  const workers = [];
  for (const name of configs) {
    const cfg = JSON.parse(readFileSync(new URL(`../wrangler.${name}.jsonc`, import.meta.url), 'utf8'));
    const compiled = await build({ entryPoints: [new URL('../' + cfg.main, import.meta.url).pathname],
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false });
    workers.push({ name: cfg.name, modules: true, script: compiled.outputFiles[0].text,
      compatibilityDate: cfg.compatibility_date, bindings: cfg.vars, outboundService: outbound,
      d1Databases: cfg.d1_databases ? { PAPER_DB: 'isolated-test-db' } : undefined,
      serviceBindings: Object.fromEntries([...(cfg.services || []).map(x => [x.binding, x.service]),
        ...(name === 'pdf-finder' ? [['AI', 'test-pdf-converter']] : [])]),
    });
  }
  const front = [metadata.title, 'A Smith', 'Robotics Research 2026', metadata.doi, 'Abstract', 'Synthetic software fixture.'].join('\n');
  workers.push({ name: 'test-pdf-converter', modules: true,
    script: `import { WorkerEntrypoint } from 'cloudflare:workers';
      export default class extends WorkerEntrypoint {
        async toMarkdown(file, options) {
          if (file.name !== 'article.pdf' || options.conversionOptions.pdf.metadata !== false) throw Error('wrong conversion contract');
          await this.env.TRACK.fetch('https://test/count');
          return { data: ${JSON.stringify(front)}, mimeType: 'application/pdf', format: 'text' };
        }
      }`, serviceBindings: { TRACK: async () => { conversions++; return new Response('OK'); } },
  });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers }));
  try {
    const db = await mf.getD1Database('PAPER_DB', 'rv-doi-resolver');
    const sql = readFileSync(new URL('../../migrations/stage2/0001_paper_pipeline.sql', import.meta.url), 'utf8');
    for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
    const resolver = await mf.getWorker('rv-doi-resolver');
    assert.equal((await (await resolver.fetch('https://rv.internal/health')).json()).schema_ready, true);
    for (const cfg of workers.slice(0, 9)) {
      const worker = await mf.getWorker(cfg.name);
      assert.equal((await (await worker.fetch('https://rv.internal/health')).json()).version, 'paper-v2.0');
    }
    const response = await resolver.fetch('https://rv.internal/v2/resolve', {
      method: 'POST', body: JSON.stringify({ doi: metadata.doi }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/pdf/);
    const record = decodeRecord(response.headers.get('x-rv-paper'));
    assert.equal(record.proof.verdict, 'verified'); assert.equal(record.proof.doi, metadata.doi);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(conversions, 1); assert.ok(external <= 18); assert.ok(record.usage.worker_invocations <= 6);
  } finally { await mf.dispose(); }
});
