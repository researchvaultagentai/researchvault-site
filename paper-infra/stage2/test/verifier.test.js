import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProductionPdf } from '../verifier.js';
import { inspectDocument } from '../identity.js';
import { metadata, makePdf } from './fixtures.js';

const page = `${metadata.title}\nA Smith\nRobotics Research 2026\n${metadata.doi}\nAbstract:\nSynthetic experiment.`;

test('production extracts only PDF text with a constant filename and no echoed metadata or LLM', async () => {
  let calls = 0;
  const bytes = makePdf();
  const result = await inspectProductionPdf(bytes, metadata, { converter: async (file, options) => {
    calls++; assert.equal(file.name, 'article.pdf'); assert.equal(file.blob.type, 'application/pdf');
    assert.deepEqual(options, { conversionOptions: { pdf: { metadata: false }, output: { format: 'text' } } });
    assert.deepEqual(new Uint8Array(await file.blob.arrayBuffer()), bytes);
    return { format: 'text', mimeType: 'application/pdf', data: page };
  } });
  assert.equal(calls, 1); assert.equal(result.verdict, 'verified');
  assert.equal(result.sha256, (await inspectDocument(bytes, metadata)).sha256);
});

test('missing/failed conversion remains uncertain and never invokes a paid fallback model', async () => {
  const bytes = makePdf();
  assert.equal((await inspectProductionPdf(bytes, metadata)).verdict, 'uncertain');
  for (const converter of [async () => { throw new Error('quota'); },
    async () => ({ format: 'error', error: 'failed' }),
    async () => ({ format: 'text', mimeType: 'text/html', data: page }),
    async () => ({ format: 'text', data: '' })]) {
    assert.notEqual((await inspectProductionPdf(bytes, metadata, { converter })).verdict, 'verified');
  }
});

test('a target DOI present only after a References heading cannot validate converted content', async () => {
  const result = await inspectProductionPdf(makePdf(), metadata, { converter: async () => ({ format: 'text', data:
    `A different study of ocean temperature\nB Jones 2025\n## References\n${page}` }) });
  assert.notEqual(result.verdict, 'verified');
});

test('HTML and damaged PDF containers never reach conversion', async () => {
  let calls = 0; const converter = async () => { calls++; return { format: 'text', data: page }; };
  await inspectProductionPdf(new TextEncoder().encode('<html>captcha</html>'), metadata, { converter });
  await inspectProductionPdf(makePdf().slice(0, -20), metadata, { converter });
  assert.equal(calls, 0);
});

test('native converter separator loss can verify only a strict publisher frontmatter identity', async () => {
  const target = { ...metadata, doi: '10.1371/journal.pone.0000308' };
  const text = `${target.title.replace('sensors improve', 'sensorsimprove')}\nA Smith 2026\n${target.doi}INTRODUCTIONSharing results.`;
  const bytes = makePdf();
  const result = await inspectProductionPdf(bytes, target, { converter: async () => ({ format: 'text', data: text }) });
  assert.equal(result.verdict, 'verified');
  assert.equal(result.reason, 'serialized_frontmatter_doi_title_author_year');
  assert.equal(result.sha256, (await inspectDocument(bytes, metadata)).sha256);
  const wrong = await inspectProductionPdf(bytes, target, { converter: async () => ({ format: 'text',
    data: text.replace('0000308', '0000309') }) });
  assert.equal(wrong.verdict, 'rejected'); assert.equal(wrong.reason, 'first_page_doi_mismatch');
});
