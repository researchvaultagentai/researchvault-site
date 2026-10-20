import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { faqAnswer, scopedGuideAnswer, supportFacts, supportLinks } from '../assets/rv-support-faq.js';
import { supportScopeForPage, supportReplyInScope } from '../assets/rv-support-context.js';
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
    assert.equal(req.headers.get('x-rv-support-scope'), 'patent_pct');
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

test('hostname and route choose the service independently of display language', () => {
  for (const origin of ['https://researchvaultagent.ir', 'https://www.researchvaultagent.ir']) {
    for (const pathname of ['/', '/index.html', '/pricing.html']) assert.equal(supportScopeForPage(origin, pathname), 'articles');
    for (const pathname of ['/patent', '/patent/', '/patent/en/', '/patent/en/account/']) {
      assert.equal(supportScopeForPage(origin, pathname), 'patent_iran');
    }
  }
  for (const pathname of ['/', '/patent/en/', '/patent/en/payments/']) {
    assert.equal(supportScopeForPage(host, pathname), 'patent_pct');
  }
  for (const pathname of ['//attacker.example/', '/patent?scope=patent_pct', '/patent#x', '/patent%2fen/']) {
    assert.equal(supportScopeForPage(host, pathname), null);
  }
  assert.equal(supportScopeForPage('https://preview.researchvault-patent.pages.dev', '/'), null);
});

test('each language has its own branch facts, contacts and FAQ choices', () => {
  for (const language of ['en', 'fa']) {
    const articles = supportFacts(language, 'articles');
    const iran = supportFacts(language, 'patent_iran');
    const pct = supportFacts(language, 'patent_pct');
    assert.doesNotMatch(articles, /patent|اختراع|PCT|1,111|۱۱۱۱|USD 111|۱۱۱ دلار/iu);
    assert.doesNotMatch(iran, /1,111|۱۱۱۱|USD|دلار|USDT|PayPal|ResearchVaultAgentBot/iu);
    assert.doesNotMatch(pct, /toman|تومان|ResearchVaultAgentBot|۶۰ تا ۱۲۰/iu);
    for (const scope of ['articles', 'patent_iran', 'patent_pct']) {
      for (const topic of ['start', 'pricing', 'human', 'documents']) {
        assert.equal(supportReplyInScope(faqAnswer(topic, language, scope), scope), true);
      }
    }
    assert.match(faqAnswer('pricing', language, 'patent_iran'), language === 'fa' ? /۶۰ تا ۱۲۰ میلیون تومان/ : /60–120 million toman/);
    assert.match(faqAnswer('pricing', language, 'patent_pct'), language === 'fa' ? /۱۱۱۱ دلار/ : /USD 1,111/);
  }
  assert.equal(faqAnswer('articles', 'en', 'patent_iran'), null);
  assert.equal(faqAnswer('articles', 'en', 'patent_pct'), null);
  assert.equal(supportLinks('articles').portal, undefined);
  assert.equal(supportLinks('patent_pct').articles, undefined);
  assert.equal(supportLinks('patent_iran').payments, undefined);
});

test('out-of-branch questions stay in the active guide without quoting another tariff', () => {
  for (const [scope, message] of [
    ['articles', 'What is the patent filing price?'],
    ['patent_iran', 'What is the USD fee for foreign clients?'],
    ['patent_pct', 'قیمت ثبت برای مشتری ایرانی به تومان چقدر است؟'],
    ['patent_pct', 'Find a paper by DOI'],
  ]) {
    assert.equal(scopedGuideAnswer(message, 'en', scope), faqAnswer('start', 'en', scope));
  }
  assert.match(scopedGuideAnswer('DOI', 'en', 'articles'), /DOI/);
  assert.equal(supportReplyInScope('Patent report is USD 1,111', 'articles'), false);
  assert.equal(supportReplyInScope('International Stage 1 is USD 1,111', 'patent_iran'), false);
  assert.equal(supportReplyInScope('The fee is 60 million toman.', 'patent_pct'), false);
  assert.equal(supportReplyInScope('Send a DOI to ResearchVaultAgentBot', 'patent_pct'), false);
});

test('Pages overwrites claimed scope and strips credentials before calling the Worker', async () => {
  for (const [origin, pathname, scope] of [
    ['https://researchvaultagent.ir', '/', 'articles'],
    ['https://www.researchvaultagent.ir', '/patent/', 'patent_iran'],
    ['https://www.researchvaultagent.ir', '/patent/en/', 'patent_iran'],
    [host, '/', 'patent_pct'],
  ]) {
    let called = false;
    const req = new Request(origin + '/support/chat', { method: 'POST', headers: {
      origin, 'content-type': 'application/json', 'x-rv-support-page': pathname,
      'x-rv-support-scope': 'client-cannot-select-a-different-market', cookie: 'private',
    }, body: '{"message":"Explain my next step"}' });
    const response = await onRequest({ request: req, env: { SUPPORT_SERVICE: { async fetch(forward) {
      called = true;
      assert.equal(forward.headers.get('x-rv-support-scope'), scope);
      assert.equal(forward.headers.get('x-rv-support-page'), pathname);
      assert.equal(forward.headers.get('cookie'), null);
      return Response.json({ reply: 'Scoped' });
    } } } });
    assert.equal(response.status, 200); assert.equal(called, true);
  }
});
