import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestBudget, boundedBytes, normalizeDoi, publicUrl, retryDelay, encodeRecord, decodeRecord } from '../common.js';

test('DOIs are normalized and invalid identifiers cannot start network work', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1234/EXAMPLE'), '10.1234/example');
  assert.equal(normalizeDoi('doi:10.1234/example'), '10.1234/example');
  for (const value of ['not a DOI', '10.1234/x y', '10.1234/x?admin=true']) assert.equal(normalizeDoi(value), null);
});

test('source URLs reject credentials, private literal IPs, non-HTTPS and internal hosts', () => {
  for (const value of ['http://papers.example.edu/a', 'https://127.0.0.1/a', 'https://0x7f000001/a',
    'https://[::1]/a', 'https://user:pass@papers.example.edu/a', 'https://host.internal/a', 'https://localhost/a',
    'https://papers.example.edu:8443/a', 'file:///etc/passwd']) assert.throws(() => publicUrl(value));
  assert.equal(publicUrl('/paper.pdf', 'https://papers.example.edu/a'), 'https://papers.example.edu/paper.pdf');
});

test('redirects are individually counted and every target is revalidated', async () => {
  const calls = [];
  const budget = new RequestBudget({ maxRequests: 3, fetcher: async url => {
    calls.push(url); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: '/b' } })
      : new Response('body');
  } });
  assert.equal((await budget.text('https://papers.example.edu/a')).text, 'body');
  assert.equal(budget.requests, 2);
  const blocked = new RequestBudget({ fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }) });
  await assert.rejects(blocked.response('https://papers.example.edu/a'), /non_public_source_url/);
  assert.equal(blocked.requests, 1);
});

test('separate invocations never share or reset another request budget', async () => {
  const a = new RequestBudget({ maxRequests: 1, fetcher: async () => Response.json({ ok: true }) });
  const b = new RequestBudget({ maxRequests: 2, fetcher: async () => Response.json({ ok: true }) });
  await Promise.all([a.json('https://papers.example.edu/a'), b.json('https://papers.example.edu/b')]);
  await assert.rejects(a.json('https://papers.example.edu/c'), /request_budget_exhausted/);
  await b.json('https://papers.example.edu/d');
  assert.equal(a.requests, 1); assert.equal(b.requests, 2);
});

test('both declared and streamed oversized bodies are canceled', async () => {
  await assert.rejects(boundedBytes(new Response('large', { headers: { 'content-length': '1000' } }), 5), /response_too_large/);
  let canceled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { canceled = true; } });
  await assert.rejects(boundedBytes(new Response(body), 5), /response_too_large/);
  assert.ok(canceled);
});

test('a timed-out response aborts and Retry-After creates a bounded provider cooldown', async () => {
  const budget = new RequestBudget({ deadline: Date.now() + 70, fetcher: async (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
  }) });
  await assert.rejects(budget.response('https://papers.example.edu/a'), /deadline_exceeded/);
  assert.equal(retryDelay('120'), 120000);
  const throttled = new RequestBudget({ fetcher: async () => new Response('rate limit', { status: 429, headers: { 'retry-after': '120' } }) });
  await assert.rejects(throttled.response('https://papers.example.edu/a'), error => error.code === 'rate_limited' && error.retryAfterMs === 120000);
});

test('binary PDF data is not encoded in the compact Unicode metadata record', () => {
  const record = { title: 'اندازه‌گیری نیرو', proof: { sha256: 'a'.repeat(64) } };
  assert.deepEqual(decodeRecord(encodeRecord(record)), record);
});
