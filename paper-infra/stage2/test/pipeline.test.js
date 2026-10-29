import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoiResolver } from '../doi-resolver.js';
import { createPdfFinder } from '../finder.js';
import { createSourceWorker } from '../source-worker.js';
import { inspectDocument } from '../identity.js';
import { decodeRecord, encodeRecord, sha256 } from '../common.js';
import { metadata, makePdf, sqliteD1, crossref } from './fixtures.js';

function setup({ wrongFirst = false, blockedFirst = false, gate } = {}) {
  const db = sqliteD1(), requests = [], bytes = makePdf();
  const fetcher = async (url) => {
    url = String(url); requests.push(url);
    if (url.includes('api.crossref.org/works/')) return Response.json(crossref());
    if (url.includes('api.unpaywall.org/')) {
      if (gate) await gate;
      return Response.json({ doi: metadata.doi, oa_locations: [
        { url_for_pdf: 'https://papers.example.edu/first.pdf', version: 'publishedVersion' },
        { url_for_pdf: 'https://papers.example.edu/good.pdf', version: 'acceptedVersion' },
      ] });
    }
    if (url.endsWith('/first.pdf')) return blockedFirst ? new Response('', { status: 403 }) : new Response(wrongFirst
      ? makePdf(['Completely unrelated observations of distant cosmic structures', 'B Jones', '2025', '10.5555/wrong', 'Abstract', 'Unrelated.']) : bytes);
    if (url.endsWith('/good.pdf')) return new Response(bytes);
    throw new Error('Unexpected external request');
  };
  const source = createSourceWorker(fetcher);
  const finder = createPdfFinder({ fetcher, verifier: inspectDocument });
  const finderEnv = { PAPER_DB: db, SOURCE_01_OA: { fetch: request => source.fetch(request, {
    SOURCE_GROUP: 'OA_DISCOVERY', UNPAYWALL_EMAIL: 'test@example.edu',
  }) } };
  const env = { PAPER_DB: db, PDF_FINDER: { fetch: request => finder.fetch(request, finderEnv) } };
  const resolver = createDoiResolver({ fetcher });
  const resolve = () => resolver.fetch(new Request('https://rv.internal/v2/resolve', {
    method: 'POST', body: JSON.stringify({ doi: metadata.doi }),
  }), env);
  return { db, requests, bytes, resolve, finder, finderEnv };
}

test('coordinator -> finder -> OA source -> exact verified PDF, bounded usage and cache reuse', async () => {
  const x = setup();
  const first = await x.resolve(); assert.equal(first.status, 200);
  const record = decodeRecord(first.headers.get('x-rv-paper'));
  assert.equal(record.proof.verdict, 'verified');
  assert.equal(record.proof.doi, metadata.doi);
  assert.equal(record.proof.sha256, await sha256(x.bytes));
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), x.bytes);
  assert.ok(record.usage.external_requests <= 18);
  assert.ok(record.usage.worker_invocations <= 6);
  const before = x.requests.length;
  const second = await x.resolve(); assert.equal(second.status, 200);
  assert.equal(x.requests.length - before, 1, 'cached URL bytes must still be fetched and hashed');
  assert.equal(decodeRecord(second.headers.get('x-rv-paper')).usage.pdf_conversions, 0);
  x.db.raw.close();
});

for (const kind of ['wrong', 'blocked']) test(`${kind} first candidate falls back to matching PDF`, async () => {
  const x = setup({ wrongFirst: kind === 'wrong', blockedFirst: kind === 'blocked' });
  const response = await x.resolve(); assert.equal(response.status, 200);
  assert.ok(decodeRecord(response.headers.get('x-rv-paper')).candidate.url.endsWith('/good.pdf'));
  assert.equal(x.db.raw.prepare('SELECT count(*) AS n FROM rv_paper_cache').get().n, 1);
  x.db.raw.close();
});

test('simultaneous DOI resolves perform one discovery and defer the duplicate', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const x = setup({ gate });
  const pending = x.resolve();
  for (let i = 0; i < 30 && !x.requests.some(url => url.includes('unpaywall')); i++) await new Promise(r => setTimeout(r, 1));
  const duplicate = await x.resolve(); assert.equal((await duplicate.json()).status, 'deferred');
  release(); assert.equal((await pending).status, 200);
  assert.equal(x.requests.filter(url => url.includes('unpaywall')).length, 1);
  x.db.raw.close();
});

test('changed cached bytes cannot reuse an old identity proof', async () => {
  const x = setup(); assert.equal((await x.resolve()).status, 200);
  const malicious = createPdfFinder({ fetcher: async () => new Response(makePdf([
    'Completely unrelated observations of distant cosmic structures', 'B Jones', '2025', '10.5555/wrong', 'Abstract', 'Unrelated.',
  ])), verifier: inspectDocument });
  const response = await malicious.fetch(new Request('https://rv.internal/v2/find', {
    method: 'POST', body: JSON.stringify({ metadata }),
  }), { PAPER_DB: x.db });
  assert.equal((await response.json()).status, 'not_found');
  assert.equal(x.db.raw.prepare('SELECT count(*) AS n FROM rv_paper_cache').get().n, 0);
  x.db.raw.close();
});

test('private final-byte verification does not need DB or discovery bindings', async () => {
  const x = setup();
  const result = await x.finder.fetch(new Request('https://rv.internal/v2/verify', {
    method: 'POST', headers: { 'x-rv-target': encodeRecord(metadata) }, body: x.bytes,
  }), {});
  assert.equal((await result.json()).proof.verdict, 'verified');
  const invalid = await x.finder.fetch(new Request('https://rv.internal/v2/verify', { method: 'POST', body: x.bytes }), {});
  assert.ok(invalid.status >= 400); x.db.raw.close();
});
