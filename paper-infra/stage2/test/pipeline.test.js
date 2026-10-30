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

test('a PLOS publisher candidate resolves under the existing three-request source limit without DOI redirects', async () => {
  const doi = '10.1371/journal.pmed.0020124', db = sqliteD1();
  const target = { ...metadata, doi };
  const bytes = makePdf([target.title, 'A Smith', '2026', doi, 'Abstract', 'Independent software fixture.']);
  const source = createSourceWorker(async () => { throw Error('publisher discovery must not use resolver hops'); });
  const finder = createPdfFinder({ fetcher: async url => {
    const parsed = new URL(url); assert.equal(parsed.hostname, 'journals.plos.org');
    assert.equal(parsed.searchParams.get('id'), doi); assert.equal(parsed.searchParams.get('type'), 'printable');
    return new Response(bytes);
  }, verifier: inspectDocument });
  const resolver = createDoiResolver({ fetcher: async () => Response.json({ message: { ...crossref().message,
    DOI: doi, publisher: 'Public Library of Science (PLoS)', URL: 'https://doi.org/' + doi } }) });
  const response = await resolver.fetch(new Request('https://rv.internal/v2/resolve', { method: 'POST', body: JSON.stringify({ doi }) }), {
    PAPER_DB: db, PDF_FINDER: { fetch: request => finder.fetch(request, { PAPER_DB: db,
      SOURCE_04_PUBLISHERS_A: { fetch: req => source.fetch(req, { SOURCE_GROUP: 'MAJOR_PUBLISHERS_A' }) } }) },
  });
  assert.equal(response.status, 200);
  const record = decodeRecord(response.headers.get('x-rv-paper'));
  assert.equal(record.proof.verdict, 'verified'); assert.equal(record.candidate.source, 'plos-publisher');
  assert.equal(record.usage.external_requests, 2); db.raw.close();
});

test('failed identity diagnostics expose bounded comparison fields and byte fingerprint without converted text', async () => {
  const db = sqliteD1(), bytes = makePdf();
  const finder = createPdfFinder({ fetcher: async () => new Response(bytes), verifier: async () => ({
    verdict: 'rejected', reason: 'first_page_doi_mismatch', sha256: await sha256(bytes), byte_length: bytes.length,
    evidence: { title_score: 0.5, doi_match: false, observed_doi_count: 1, doi_target_prefix_only: true,
      text: 'private converted text', observed_doi: '10.9999/private', secret: 'hidden' },
  }) });
  const response = await finder.fetch(new Request('https://rv.internal/v2/find', {
    method: 'POST', body: JSON.stringify({ metadata }),
  }), { PAPER_DB: db, SOURCE_01_OA: { fetch: async () => Response.json({
    candidates: [{ url: 'https://papers.example.edu/a.pdf', source: 'oa' }], usage: { external_requests: 0 },
  }) } });
  const data = await response.json(), identity = data.diagnostics.find(item => item.stage === 'identity');
  assert.equal(data.status, 'not_found'); assert.equal(identity.sha256, await sha256(bytes));
  assert.equal(identity.byte_length, bytes.length);
  assert.deepEqual(identity.evidence, { doi_match: false, doi_target_prefix_only: true, title_score: 0.5, observed_doi_count: 1 });
  assert.ok(!JSON.stringify(data.diagnostics).includes('private'));
  assert.ok(!JSON.stringify(data.diagnostics).includes('hidden')); db.raw.close();
});
