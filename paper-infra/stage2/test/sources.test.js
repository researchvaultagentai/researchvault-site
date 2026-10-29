import test from 'node:test';
import assert from 'node:assert/strict';
import { metadata, crossref } from './fixtures.js';
import { RequestBudget } from '../common.js';
import { crossrefMetadata, publisherFamily, resolveMetadata } from '../metadata.js';
import { landingCandidates, unpaywallCandidates, openalexCandidates, probeSource } from '../sources.js';
import { routeSources } from '../finder.js';
import { createSourceWorker } from '../source-worker.js';

test('publisher families select the right specialist without contacting all seven sources', () => {
  for (const [publisher, family] of [['Springer Nature', 'publishers-a'], ['Elsevier BV', 'publishers-a'], ['Wiley', 'publishers-a'],
    ['Public Library of Science', 'publishers-a'], ['Taylor & Francis', 'publishers-b'], ['SAGE', 'publishers-b'],
    ['IEEE', 'society-tech'], ['American Chemical Society ACS', 'society-tech']]) {
    assert.equal(publisherFamily({ publisher }), family);
  }
  const routes = routeSources(metadata);
  assert.ok(routes.some(route => route.group === 'publishers-a'));
  assert.ok(!routes.some(route => route.group === 'publishers-b'));
  assert.ok(routes.length <= 4);
  assert.ok(routeSources({ ...metadata, doi: '10.48550/arxiv.2601.01234' }).some(route => route.group === 'preprints'));
});

test('Crossref target metadata is independent, DOI-matched and does not invent author/title evidence', () => {
  const item = crossref().message;
  assert.equal(crossrefMetadata(item, metadata.doi).authors[0].family, 'Smith');
  assert.throws(() => crossrefMetadata({ ...item, DOI: '10.1234/other' }, metadata.doi), /metadata_doi_mismatch/);
  assert.throws(() => crossrefMetadata({ ...item, title: [] }, metadata.doi), /metadata_title_missing/);
});

test('title lookup refuses ambiguous near-identical articles rather than guessing a DOI', async () => {
  const item = crossref().message;
  const budget = new RequestBudget({ fetcher: async () => Response.json({ message: { items: [item, { ...item, DOI: '10.1234/other' }] } }) });
  await assert.rejects(resolveMetadata({ title: metadata.title }, budget), /ambiguous_title/);
});

test('DataCite is a bounded fallback for a DOI absent from Crossref', async () => {
  const urls = [];
  const budget = new RequestBudget({ maxRequests: 2, fetcher: async url => {
    urls.push(url); return url.includes('crossref') ? new Response('missing', { status: 404 }) : Response.json({ data: { attributes: {
      doi: metadata.doi, titles: [{ title: metadata.title }], creators: [{ familyName: 'Smith' }], publicationYear: 2026,
      publisher: 'Repository', url: metadata.landing_url } } });
  } });
  const result = await resolveMetadata({ doi: metadata.doi }, budget);
  assert.equal(result.metadata_source, 'datacite'); assert.equal(urls.length, 2);
});

test('all alternate open-access PDF locations are retained and article versions are explicit', () => {
  const data = { doi: metadata.doi, title: metadata.title,
    best_oa_location: { url_for_pdf: 'https://publisher.example.edu/a.pdf', version: 'publishedVersion' },
    oa_locations: [{ url_for_pdf: 'https://publisher.example.edu/a.pdf', version: 'publishedVersion' },
      { url_for_pdf: 'https://repository.example.edu/b.pdf', version: 'acceptedVersion', license: 'cc-by' }] };
  const candidates = unpaywallCandidates(data, metadata);
  assert.equal(candidates.length, 2); assert.equal(candidates[1].version, 'acceptedVersion');
  assert.throws(() => unpaywallCandidates({ ...data, doi: '10.1234/other' }, metadata), /source_doi_mismatch/);
  assert.equal(openalexCandidates({ doi: 'https://doi.org/' + metadata.doi, locations: [{ is_oa: true, pdf_url: data.best_oa_location.url_for_pdf }] }, metadata).length, 1);
});

test('landing-page metadata discovers a candidate but never marks its PDF identity verified', () => {
  const html = `<meta name="citation_doi" content="${metadata.doi}"><meta name="citation_title" content="${metadata.title}">
    <meta name="citation_pdf_url" content="/download/paper.pdf">`;
  const [candidate] = landingCandidates(html, metadata.landing_url, metadata);
  assert.equal(candidate.url, 'https://papers.example.edu/download/paper.pdf');
  assert.equal(candidate.identity_verified, undefined);
  assert.deepEqual(landingCandidates(html.replace(metadata.doi, '10.1234/other'), metadata.landing_url, metadata), []);
});

test('unconfigured optional API credentials never trigger paid or unauthorized provider calls', async () => {
  const budget = new RequestBudget({ fetcher: async () => { throw new Error('must not call'); } });
  assert.deepEqual(await probeSource('OA_DISCOVERY', metadata, budget, {}), []);
  assert.equal(budget.requests, 0);
});

test('a known arXiv DOI uses its direct PDF and does not call a throttled search API', async () => {
  const budget = new RequestBudget({ fetcher: async () => { throw new Error('no search'); } });
  const [candidate] = await probeSource('PREPRINT_REPOSITORY', { ...metadata, doi: '10.48550/arxiv.2601.01234' }, budget);
  assert.equal(candidate.url, 'https://arxiv.org/pdf/2601.01234');
  assert.equal(candidate.version, 'submittedVersion'); assert.equal(budget.requests, 0);
});

test('source worker honors its assigned request budget and returns a retryable rate-limit result', async () => {
  const worker = createSourceWorker(async () => new Response('busy', { status: 429, headers: { 'retry-after': '120' } }));
  const response = await worker.fetch(new Request('https://rv.internal/v2/probe', { method: 'POST', body: JSON.stringify({ metadata, max_requests: 1 }) }),
    { SOURCE_GROUP: 'OA_DISCOVERY', UNPAYWALL_EMAIL: 'test@example.invalid' });
  const data = await response.json();
  assert.equal(response.status, 429); assert.equal(data.retry_after_ms, 120000); assert.equal(data.usage.external_requests, 1);
});

test('PLOS DOI-addressed PDFs are discovered without a four-request resolver redirect chain', async () => {
  for (const [suffix, journal] of [['pmed.0020124','plosmedicine'], ['pone.0000308','plosone'], ['pbio.1000001','plosbiology']]) {
    const target = { ...metadata, doi: '10.1371/journal.' + suffix };
    const budget = new RequestBudget({ maxRequests: 3, fetcher: async () => { throw Error('resolver must not be fetched'); } });
    const candidates = await probeSource('MAJOR_PUBLISHERS_A', target, budget);
    assert.equal(candidates.length, 1); const url = new URL(candidates[0].url);
    assert.equal(url.hostname, 'journals.plos.org'); assert.equal(url.pathname, '/' + journal + '/article/file');
    assert.equal(url.searchParams.get('id'), target.doi); assert.equal(url.searchParams.get('type'), 'printable');
    assert.equal(candidates[0].identity_verified, undefined); assert.equal(budget.requests, 0);
  }
});
