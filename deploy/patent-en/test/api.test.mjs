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

test('PCT health checks the private Worker without forwarding credentials or exposing its response', async () => {
  const request = make('/api/pct/status?case=example', {
    headers: { cookie: 'patent_session=example-session', authorization: 'Bearer example' },
  });
  const response = await onRequest({ request, env: { PCT_WORKFLOW: { fetch: async value => {
    assert.equal(value.url, ORIGIN + '/api/pct/status');
    assert.equal(value.method, 'GET');
    assert.equal(value.redirect, 'manual');
    assert.equal(value.headers.get('cookie'), null);
    assert.equal(value.headers.get('authorization'), null);
    return Response.json({ enabled: false, internal_detail: 'example' }, {
      headers: { 'set-cookie': 'internal=example', 'cache-control': 'public' },
    });
  } } } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { connected: true, enabled: false });
});

test('PCT health distinguishes a disabled production Worker from an unavailable or test Worker', async () => {
  const request = make('/api/pct/status');
  for (const binding of [
    undefined,
    { fetch: async () => { throw new Error('internal test detail'); } },
    { fetch: async () => Response.json({ enabled: false }, { status: 403 }) },
    { fetch: async () => Response.redirect('https://example.test/',302) },
    { fetch: async () => new Response('not JSON') },
    { fetch: async () => Response.json({ enabled: 'false' }) },
    { fetch: async () => Response.json({ enabled: true, test_mode: true }) },
  ]) {
    const response = await onRequest({ request, env: { PCT_WORKFLOW: binding } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { connected: false, enabled: false });
  }
});

test('only a production, same-origin GET can reach the PCT binding', async () => {
  let calls = 0;
  const env = { PCT_WORKFLOW: { fetch: async () => { calls++; return new Response(); } } };
  for (const [request, status] of [
    [new Request('https://preview.researchvault-patent.pages.dev/api/pct/status'), 403],
    [make('/api/pct/status', { headers: { origin: 'https://other.example' } }), 403],
    [make('/api/pct/status', { method: 'POST', headers: { origin: ORIGIN } }), 405],
    [make('/api/pct/cases', { method: 'POST', headers: { origin: ORIGIN } }), 503],
  ]) assert.equal((await onRequest({ request, env })).status, status);
  assert.equal(calls, 0);
});
