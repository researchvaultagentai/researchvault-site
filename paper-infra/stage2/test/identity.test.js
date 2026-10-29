import test from 'node:test';
import assert from 'node:assert/strict';
import { assessIdentity, inspectDocument } from '../identity.js';
import { sha256 } from '../common.js';
import { makePdf, metadata } from './fixtures.js';

test('real PDF parsing verifies page-one identity and binds approval to exact bytes and DOI', async () => {
  const bytes = makePdf(); const result = await inspectDocument(bytes, metadata);
  assert.equal(result.verdict, 'verified', JSON.stringify(result));
  assert.equal(result.reason, 'first_page_doi_and_title');
  assert.equal(result.sha256, await sha256(bytes)); assert.equal(result.doi, metadata.doi);
  assert.equal(result.byte_length, bytes.length);
});

test('a different real article is rejected even when the URL/metadata claims the requested DOI', async () => {
  const bytes = makePdf(['A completely different study of ocean temperature trends', 'B Jones', 'Ocean Research 2025', '10.9999/ocean', 'Abstract', 'Unrelated study.'], metadata.title);
  const result = await inspectDocument(bytes, metadata);
  assert.equal(result.verdict, 'rejected'); assert.equal(result.reason, 'first_page_doi_mismatch');
});

test('the target DOI in the references of another PDF cannot approve that article', async () => {
  const result = await inspectDocument(makePdf(['A completely different study of ocean temperature trends', 'B Jones',
    'Ocean Research 2025', 'Abstract', 'Other work.', 'References', metadata.title, 'A Smith 2026 ' + metadata.doi]), metadata);
  assert.notEqual(result.verdict, 'verified');
});

test('supplementary information carrying the correct title and DOI is rejected', async () => {
  const result = await inspectDocument(makePdf(['Supplementary Information', metadata.title, 'A Smith 2026', metadata.doi]), metadata);
  assert.equal(result.verdict, 'rejected'); assert.equal(result.reason, 'not_main_article');
});

test('readable accepted manuscripts need independent title, author and year evidence', async () => {
  const bytes = makePdf([metadata.title, 'A Smith', 'Robotics Research 2026', 'Abstract', 'A manuscript copy.']);
  assert.equal((await inspectDocument(bytes, metadata)).verdict, 'verified');
  assert.notEqual((await inspectDocument(bytes, { ...metadata, authors: [{ family: 'Jones' }] })).verdict, 'verified');
});

test('HTML, truncated files, parser errors and image-only first pages never pass', async () => {
  assert.equal((await inspectDocument(new TextEncoder().encode('<html>captcha</html>'), metadata)).verdict, 'rejected');
  const bytes = makePdf();
  assert.notEqual((await inspectDocument(bytes.slice(0, -20), metadata)).verdict, 'verified');
  assert.equal((await inspectDocument(bytes, metadata, { parser: async () => { throw new Error('bad'); } })).verdict, 'uncertain');
  assert.equal(assessIdentity(metadata, { firstPageText: '', pdfTitle: metadata.title }).verdict, 'uncertain');
});

test('missing candidate evidence never substitutes the target title for the observed title', () => {
  const result = assessIdentity(metadata, { firstPageText: 'A Smith 2026. We study a broad unrelated research problem. '.repeat(4), pdfTitle: '' });
  assert.notEqual(result.verdict, 'verified');
});

test('short generic titles require DOI, author and year together', () => {
  const target = { ...metadata, title: 'Robotic force sensing' };
  const result = assessIdentity(target, { firstPageText: `${target.title}\nB Jones\n2026\n${target.doi}\nAbstract:\nOther details.` });
  assert.notEqual(result.verdict, 'verified');
});

test('column-order page-one metadata beyond the early window needs exact DOI, title, author and year', () => {
  const lead = 'Column body text about an unrelated statistical method. '.repeat(90);
  const front = lead + '\n' + metadata.title + '\nA Smith\n2026\n' + metadata.doi;
  const result = assessIdentity(metadata, { firstPageText: front });
  assert.equal(result.verdict, 'verified'); assert.equal(result.reason, 'leading_page_doi_title_author_year');
  for (const altered of [front.replace('A Smith','B Jones'), front.replace('2026','2010'), front.replace(metadata.doi,'10.9999/other')]) {
    assert.notEqual(assessIdentity(metadata,{ firstPageText: altered }).verdict,'verified');
  }
  assert.notEqual(assessIdentity(metadata, { firstPageText: 'Another paper\n10.9999/other\n' + front }).verdict, 'verified');
});
test('numbered reference or introduction headings cannot expose a later citation as article identity', () => {
  for (const heading of ['2. References', '1 Introduction', 'Bibliography']) {
    const text = 'An unrelated article\nB Jones\n' + heading + '\n' + 'Body text '.repeat(500) + metadata.title + '\nA Smith 2026\n' + metadata.doi;
    assert.notEqual(assessIdentity(metadata, { firstPageText: text }).verdict, 'verified');
  }
});
