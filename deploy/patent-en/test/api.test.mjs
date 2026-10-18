import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/[[path]].js';

const ORIGIN = 'https://researchvault-patent.pages.dev';
const make = (path = '/api/me', options = {}) => new Request(ORIGIN + path, options);

test('first-party session cookies and the original request reach only the Patent binding', async () => {
  const request = make('/api/me?case=example', { headers: { cookie: 'patent_session=example-session' } });
  let received;
  const cookie = 'patent_session=example-session; Path=/; HttpOnly; Secure; SameSite=Strict';
  const response = await onRequest({ request, env: { PATENT_API: { fetch: async value => {
    received = value;
    return Response.json({ ok: true }, { headers: { 'set-cookie': cookie, 'cache-control': 'public' } });
  } } } });
  assert.equal(received, request);
  assert.equal(received.headers.get('cookie'), 'patent_session=example-session');
  assert.equal(response.headers.get('set-cookie'), cookie);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true });
});

test('cross-origin requests, missing mutation origins and preview hosts never invoke production', async () => {
  let calls = 0;
  const env = { PATENT_API: { fetch: async () => { calls++; return new Response(); } } };
  for (const request of [
    make('/api/auth/verify-otp', { method: 'POST', headers: { origin: 'https://other.example' } }),
    make('/api/auth/verify-otp', { method: 'POST' }),
    make('/api/me', { headers: { 'sec-fetch-site': 'cross-site' } }),
    new Request('https://preview.researchvault-patent.pages.dev/api/me'),
  ]) assert.equal((await onRequest({ request, env })).status, 403);
  assert.equal(calls, 0);
});

test('uploads keep multipart data, authenticated cookie and actual caller origin intact', async () => {
  const form = new FormData();
  form.append('category', 'disclosure');
  form.append('file', new Blob(['synthetic test only']), 'test.txt');
  const request = make('/api/cases/example/documents', {
    method: 'POST', body: form,
    headers: { origin: ORIGIN, cookie: 'patent_session=test', 'sec-fetch-site': 'same-origin' },
  });
  const response = await onRequest({ request, env: { PATENT_API: { fetch: async value => {
    assert.equal(value.headers.get('origin'), ORIGIN);
    assert.equal(value.headers.get('cookie'), 'patent_session=test');
    const data = await value.formData();
    assert.equal(data.get('category'), 'disclosure');
    assert.equal(await data.get('file').text(), 'synthetic test only');
    return new Response(null, { status: 201 });
  } } } });
  assert.equal(response.status, 201);
});

test('the English connector does not expose admin routes or unsupported methods', async () => {
  let calls = 0;
  const env = { PATENT_API: { fetch: async () => { calls++; return new Response(); } } };
  assert.equal((await onRequest({ request: make('/api/admin/cases'), env })).status, 404);
  assert.equal((await onRequest({ request: make('/api/me', { method: 'PUT', headers: { origin: ORIGIN } }), env })).status, 405);
  assert.equal(calls, 0);
});

test('unconfigured and unavailable bindings fail without leaking internal details', async () => {
  assert.equal((await onRequest({ request: make(), env: {} })).status, 503);
  const response = await onRequest({ request: make(), env: { PATENT_API: { fetch: async () => {
    throw new Error('internal test detail');
  } } } });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('internal test detail'));
});
