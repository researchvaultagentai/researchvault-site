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
