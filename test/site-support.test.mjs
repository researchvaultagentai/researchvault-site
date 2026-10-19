import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { faqAnswer } from '../assets/rv-support-faq.js';
const root = path.resolve(import.meta.dirname, '..');
const handlerPath = existsSync(path.join(root, 'functions/support/[[path]].js'))
  ? 'functions/support/[[path]].js' : 'deploy/patent-en/functions/support/[[path]].js';
const { onRequest } = await import(pathToFileURL(path.join(root, handlerPath)));
const host = 'https://researchvault-patent.pages.dev';
const key = '0x4_TEST_PUBLIC_KEY';
function request(route, options = {}) {
  const init = { ...options, headers: { ...(options.method === 'POST' ? { origin: host, 'content-type': 'application/json' } : {}), ...options.headers } };
  return new Request(host + route, init);
}
test('a missing support binding leaves a safe local guide rather than an invented AI connection', async () => {
  const response = await onRequest({ request: request('/support/config'), env: {} });
  assert.deepEqual(await response.json(), { configured: false, issues: ['support_service_binding_missing'] });
  assert.equal((await onRequest({ request: request('/support/chat', { method: 'POST', body: '{}' }), env: {} })).status, 503);
});
test('preview and cross-origin requests never reach the private support service', async () => {
  let calls = 0; const env = { SUPPORT_SERVICE: { async fetch() { calls++; throw Error(); } } };
  for (const req of [
    new Request('https://preview.researchvault-patent.pages.dev/support/config'),
    request('/support/chat', { method: 'POST', body: '{}', headers: { origin: 'https://other.example' } }),
    request('/support/config', { headers: { 'sec-fetch-site': 'cross-site' } }),
  ]) assert.equal((await onRequest({ request: req, env })).status, 403);
  assert.equal(calls, 0);
});
test('configuration exposes only the public challenge key and a same-origin endpoint', async () => {
  const env = { SUPPORT_SERVICE: { async fetch(req) {
    assert.equal(req.url, 'https://support.internal/v1/config');
    assert.equal(req.headers.get('origin'), host);
    return Response.json({ configured: true, turnstileSiteKey: key, TURNSTILE_SECRET: 'NEVER_PUBLIC', password: 'PRIVATE' });
  } } };
  const response = await onRequest({ request: request('/support/config'), env });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { configured: true, endpoint: '/support/chat', turnstileSiteKey: key });
});
test('chat forwards the bounded public body without account cookies or credentials', async () => {
  let calls = 0;
  const payload = { message: 'Explain this service', language: 'en', turnstileToken: 'TEST_TOKEN' };
  const env = { SUPPORT_SERVICE: { async fetch(req) {
    calls++; assert.equal(req.url, 'https://support.internal/v1/chat');
    assert.equal(req.headers.get('cookie'), null); assert.equal(req.headers.get('authorization'), null);
    assert.deepEqual(await req.json(), payload);
    return Response.json({ reply: 'Helpful reply', source: 'assistant' }, { headers: { 'set-cookie': 'DO_NOT_FORWARD' } });
  } } };
  const response = await onRequest({ request: request('/support/chat', { method: 'POST', body: JSON.stringify(payload),
    headers: { cookie: 'session=PRIVATE', authorization: 'Bearer PRIVATE' } }), env });
  assert.equal(calls, 1); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await response.json()).reply, 'Helpful reply');
});

test('configuration distinguishes connection failures and filters all provider details to fixed issue codes', async () => {
  for (const [status, issue] of [[403, 'support_origin_rejected'], [404, 'support_worker_route_missing'], [503, 'support_service_unavailable']]) {
    const env = { SUPPORT_SERVICE: { fetch: async () => new Response('PRIVATE_PROVIDER_DETAIL', { status }) } };
    assert.deepEqual(await (await onRequest({ request: request('/support/config'), env })).json(), { configured: false, issues: [issue] });
  }
  const env = { SUPPORT_SERVICE: { fetch: async () => Response.json({ configured: false,
    issues: ['ai_binding_missing', 'PRIVATE_SECRET', 'ai_binding_missing'], TURNSTILE_SECRET: 'PRIVATE_SECRET' }) } };
  assert.deepEqual(await (await onRequest({ request: request('/support/config'), env })).json(), { configured: false, issues: ['ai_binding_missing'] });
  env.SUPPORT_SERVICE.fetch = async () => { throw new Error('PRIVATE_PROVIDER_DETAIL'); };
  assert.deepEqual(await (await onRequest({ request: request('/support/config'), env })).json(), { configured: false, issues: ['support_service_unreachable'] });
});
test('unexpected methods, routes, bodies and unavailable providers fail without leaking details', async () => {
  const env = { SUPPORT_SERVICE: { async fetch() { throw Error('PRIVATE_PROVIDER_DETAIL'); } } };
  assert.equal((await onRequest({ request: request('/support/admin'), env })).status, 404);
  assert.equal((await onRequest({ request: request('/support/chat'), env })).status, 405);
  assert.equal((await onRequest({ request: request('/support/chat', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }), env })).status, 415);
  assert.equal((await onRequest({ request: request('/support/chat', { method: 'POST', body: '{}', headers: { 'content-length': '17000' } }), env })).status, 413);
  const response = await onRequest({ request: request('/support/chat', { method: 'POST', body: '{}' }), env });
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE_PROVIDER/);
});
test('service facts agree on the standalone report, revision rule, video and human contact', () => {
  assert.match(faqAnswer('pricing', 'en'), /USD 1,111/);
  assert.match(faqAnswer('pricing', 'en'), /USD 111 per revision package/);
  assert.match(faqAnswer('pricing', 'fa'), /۱۱۱۱/);
  assert.match(faqAnswer('documents', 'en'), /20 MB and 7 minutes/);
  assert.match(faqAnswer('documents', 'en'), /must be in English/);
  assert.match(faqAnswer('human', 'en'), /@Ata_Mahmoudinezhad/);
});
test('shared runtime loads the isolated widget without changing the patent API origin', () => {
  const runtime = readFileSync(path.join(root, 'patent/assets/patent.js'), 'utf8');
  assert.match(runtime, /script.src = '\/assets\/rv-support-widget.js'/);
  assert.match(runtime, /https:\/\/patent-api.researchvaultagent.ir/);
  const widget = readFileSync(path.join(root, 'assets/rv-support-widget.js'), 'utf8');
  assert.match(widget, /fetch\('\/support\/config'/);
  assert.match(widget, /endpoint.origin !== window.location.origin/);
  assert.match(widget, /bubble.textContent = text/);
});
