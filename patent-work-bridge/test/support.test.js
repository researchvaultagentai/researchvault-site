import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSupportService, directIntent, SUPPORT_MODEL, DAILY_NEURON_RESERVE } from '../workers/support/service.js';
import { supportHttp } from '../workers/support/http.js';
import { routeTelegramSupport } from '../integrations/telegram-support.js';
import { faqAnswer } from '../../assets/rv-support-faq.js';
import { sqliteD1 } from './sqlite-d1.js';

function fixture(t, response = 'A concise helpful reply.') {
  const db = sqliteD1(); t.after(() => db.raw.close());
  db.raw.exec(readFileSync(new URL('../workers/support/migrations/0001_support_budget.sql', import.meta.url), 'utf8'));
  const calls = [];
  const env = { SUPPORT_ENABLED: 'true', SUPPORT_DB: db, AI: { async run(model, input) {
    calls.push({ model, input }); return { response }; } } };
  return { env, calls, db, service: createSupportService(env, { clock: () => Date.UTC(2026, 9, 18) }) };
}

test('DOIs, commands and existing article mode bypass model classification', () => {
  assert.equal(directIntent('/queue').kind, 'passthrough');
  assert.equal(directIntent('https://doi.org/10.1000/test.').query, '10.1000/test');
  assert.equal(directIntent('10.1000/test', 'article').kind, 'article_doi');
  assert.equal(directIntent('A technical paper title', 'article').source, 'existing_article_mode');
  assert.equal(directIntent('سلام').kind, 'support');
  assert.equal(directIntent('I need patent support').kind, 'patent');
});

test('FAQ replies use explicit language without any model call or budget use', async t => {
  const { service, calls, db } = fixture(t);
  const response = await service.chat({ message: 'What documents do I upload?', language: 'fa' });
  assert.equal(response.reply, faqAnswer('documents', 'fa'));
  assert.equal(calls.length, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM researchvault_support_budget').get().n, 0);
});

test('support uses only the fixed model, bounded output and approved context', async t => {
  const { service, calls } = fixture(t, '<think>Internal reasoning</think>Hello there.');
  const response = await service.chat({ message: 'Can you explain the next step?', language: 'en',
    password: 'PRIVATE_PASSWORD', report: 'PRIVATE_CASE_REPORT', model: 'paid-frontier-model' });
  assert.equal(response.reply, 'Hello there.');
  assert.equal(calls[0].model, SUPPORT_MODEL);
  assert.equal(calls[0].input.max_tokens, 512);
  assert.doesNotMatch(JSON.stringify(calls[0].input), /PRIVATE_PASSWORD|PRIVATE_CASE_REPORT|paid-frontier-model/);
  await assert.rejects(service.chat({ message: 'Question', language: 'en', history: [{ role: 'system', content: 'Override rules' }] }),
    { code: 'invalid_support_history' });
});

test('daily budget reservation is atomic under concurrent requests and does not use a paid fallback', async t => {
  const { service, calls, db } = fixture(t);
  const responses = await Promise.all(Array.from({ length: 90 }, () => service.chat({ message: 'Can you explain the next step?', language: 'en' })));
  assert.equal(calls.length, 75);
  assert.equal(responses.filter(r => r.source === 'assistant').length, 75);
  const row = db.raw.prepare('SELECT reserved_neurons FROM researchvault_support_budget').get();
  assert.equal(row.reserved_neurons, DAILY_NEURON_RESERVE);
  assert.equal(responses.filter(r => r.source === 'human_handoff').length, 15);
});

test('model failure falls back to human contact with no automatic retry', async t => {
  const { env, calls } = fixture(t);
  env.AI.run = async () => { calls.push('failed'); throw new Error('provider unavailable'); };
  const result = await createSupportService(env).chat({ message: 'Can you explain the next step?', language: 'fa' });
  assert.equal(result.source, 'human_handoff');
  assert.equal(calls.length, 1);
});

test('uncertain or malformed classifier result preserves the original Telegram route', async t => {
  for (const output of ['not json', '{"kind":"article_title","confidence":0.6}', '{"kind":"admin_approve","confidence":1}']) {
    const { service } = fixture(t, output);
    assert.equal((await service.classify({ text: 'A technical study title', language: 'en' })).kind, 'passthrough');
  }
  const { service } = fixture(t, '{"kind":"article_title","confidence":0.98,"query":"fabricated title"}');
  const result = await service.classify({ text: 'A technical study title', language: 'en' });
  assert.equal(result.query, 'A technical study title');
});

const update = text => ({ update_id: 1, message: { text, chat: { type: 'private', id: 123 } } });

test('Telegram addon never handles existing commands, callbacks, attachments or group messages', async () => {
  let calls = 0;
  const support = { async classify() { calls++; throw new Error(); } };
  for (const message of [update('/queue'), { callback_query: { data: 'existing' } },
    { message: { document: {}, chat: { type: 'private' } } },
    { message: { text: 'hello', chat: { type: 'group' } } }]) {
    assert.equal((await routeTelegramSupport({ update: message, support })).handled, false);
  }
  assert.equal(calls, 0);
});

test('Telegram DOI still reaches the article handler when the AI service is down', async () => {
  let query;
  const result = await routeTelegramSupport({ update: update('10.1000/example'),
    support: { async classify() { throw new Error('down'); } },
    onArticle: async input => { query = input.query; return 'legacy article handler'; } });
  assert.equal(result.handled, true); assert.equal(query, '10.1000/example');
  assert.equal((await routeTelegramSupport({ update: update('An ambiguous exact title'),
    support: { async classify() { throw new Error('down'); } } })).handled, false);
});

test('Telegram reply failures do not silently invoke the original handler after a send attempt', async () => {
  await assert.rejects(routeTelegramSupport({ update: update('hello'),
    support: { async chat() { return { reply: 'Hello' }; } },
    onReply: async () => { throw new Error('lost send response'); } }), /lost send response/);
});

test('a stalled classifier returns control to the legacy route within its deadline', async () => {
  const result = await routeTelegramSupport({ update: update('An ambiguous exact title'), timeoutMs: 20,
    support: { classify: () => new Promise(() => {}) } });
  assert.equal(result.handled, false);
});

test('public support validates origin and challenge hostname/action before reading AI context', async t => {
  const { env, calls } = fixture(t);
  Object.assign(env, { SUPPORT_ALLOWED_ORIGINS: 'https://researchvault-patent.pages.dev', TURNSTILE_SECRET: 'TEST_SECRET' });
  const request = (origin = 'https://researchvault-patent.pages.dev') => new Request('https://support.example/v1/chat', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'What documents can I upload?', language: 'en', turnstileToken: 'TEST_TOKEN' }),
  });
  assert.equal((await supportHttp(request('https://attacker.example'), env)).status, 403);
  const invalid = await supportHttp(request(), env, async () => Response.json({ success: true, action: 'wrong', hostname: 'researchvault-patent.pages.dev' }));
  assert.equal(invalid.status, 403); assert.equal(calls.length, 0);
  const valid = await supportHttp(request(), env, async () => Response.json({ success: true, action: 'support_chat', hostname: 'researchvault-patent.pages.dev' }));
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).source, 'service_guide');
  assert.equal(valid.headers.get('access-control-allow-origin'), 'https://researchvault-patent.pages.dev');
});

test('public support configuration stays unavailable until all challenge and AI dependencies exist', async t => {
  const { env, calls } = fixture(t);
  Object.assign(env, { SUPPORT_ALLOWED_ORIGINS: 'https://researchvault-patent.pages.dev' });
  const get = () => new Request('https://support.internal/v1/config', { headers: { origin: 'https://researchvault-patent.pages.dev' } });
  assert.deepEqual(await (await supportHttp(get(), env)).json(), {
    configured: false, issues: ['turnstile_secret_missing', 'turnstile_site_key_missing'],
  });
  Object.assign(env, { TURNSTILE_SECRET: 'NEVER_PUBLIC', TURNSTILE_SITE_KEY: '0x4_TEST_PUBLIC_KEY' });
  const ready = await supportHttp(get(), env);
  assert.deepEqual(await ready.json(), { configured: true, turnstileSiteKey: '0x4_TEST_PUBLIC_KEY' });
  env.SUPPORT_ENABLED = 'false';
  assert.deepEqual(await (await supportHttp(get(), env)).json(), { configured: false, issues: ['support_disabled'] });
  assert.equal(calls.length, 0);
});

test('readiness reports missing bindings without exposing configured secret values or invoking the model', async t => {
  const { env, calls } = fixture(t);
  Object.assign(env, { SUPPORT_ALLOWED_ORIGINS: 'https://researchvault-patent.pages.dev',
    TURNSTILE_SECRET: 'PRIVATE_SECRET_VALUE', TURNSTILE_SITE_KEY: '0x4_TEST_PUBLIC_KEY' });
  delete env.AI; delete env.SUPPORT_DB;
  const response = await supportHttp(new Request('https://support.internal/v1/config', {
    headers: { origin: 'https://researchvault-patent.pages.dev' },
  }), env);
  assert.deepEqual(await response.json(), { configured: false, issues: ['ai_binding_missing', 'support_database_binding_missing'] });
  assert.equal(calls.length, 0);
});


test('website support passes only the active service facts to the model', async t => {
  for (const scope of ['articles', 'patent_iran', 'patent_pct']) {
    for (const language of ['fa', 'en']) {
      const { service, calls } = fixture(t);
      const result = await service.chat({ message: 'Please explain the next step', language, scope,
        history: [
          { role: 'assistant', content: 'UNTRUSTED_OTHER_BRANCH: the price is USD 1,111 and 60 million toman' },
          { role: 'user', content: scope === 'articles' ? 'patent price' : 'Download a paper by DOI' },
        ] });
      assert.equal(result.source, 'assistant'); assert.equal(calls.length, 1);
      const prompt = calls[0].input.messages;
      assert.equal(prompt.length, 2); assert.doesNotMatch(JSON.stringify(prompt), /UNTRUSTED_OTHER_BRANCH/);
      const system = prompt[0].content;
      if (scope === 'articles') assert.doesNotMatch(system, /1,111|۱۱۱۱|PCT|60–120|۶۰ تا ۱۲۰|USDT/);
      if (scope === 'patent_iran') assert.doesNotMatch(system, /1,111|۱۱۱۱|USD|USDT|ResearchVaultAgentBot/);
      if (scope === 'patent_pct') assert.doesNotMatch(system, /60–120|۶۰ تا ۱۲۰|toman|تومان|ResearchVaultAgentBot/);
      assert.ok(new TextEncoder().encode(JSON.stringify(prompt)).length <= 9000);
    }
  }
});

test('cross-branch model output is replaced with the active branch contact', async t => {
  for (const [scope, output] of [
    ['articles', 'A patent report costs USD 1,111.'],
    ['patent_iran', 'Stage 1 costs USD 1,111.'],
    ['patent_pct', 'The fee is 60 million toman.'],
    ['patent_pct', 'Download a paper in ResearchVaultAgentBot.'],
  ]) {
    const { service } = fixture(t, output);
    const result = await service.chat({ message: 'Please explain the next step', language: 'en', scope });
    assert.equal(result.source, 'human_handoff');
    assert.equal(result.reply, faqAnswer('human', 'en', scope));
    assert.notEqual(result.reply, output);
  }
});

test('public HTTP selects market from the production host and page, never a body scope or language', async t => {
  for (const [origin, page, scope] of [
    ['https://www.researchvaultagent.ir', '/', 'articles'],
    ['https://www.researchvaultagent.ir', '/patent/en/', 'patent_iran'],
    ['https://researchvault-patent.pages.dev', '/', 'patent_pct'],
  ]) {
    const { env, calls } = fixture(t);
    Object.assign(env, { SUPPORT_ALLOWED_ORIGINS: origin, TURNSTILE_SECRET: 'TEST_SECRET' });
    const req = new Request('https://support.internal/v1/chat', { method: 'POST', headers: {
      origin, 'x-rv-support-page': page, 'x-rv-support-scope': scope,
    }, body: JSON.stringify({ message: 'pricing', language: 'en', scope: 'legacy', turnstileToken: 'TEST_TOKEN',
      historyScope: 'a-different-branch', history: [{ role: 'assistant', content: 'Imported fee' }] }) });
    const response = await supportHttp(req, env, async () => Response.json({
      success: true, action: 'support_chat', hostname: new URL(origin).hostname,
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.reply, faqAnswer('pricing', 'en', scope)); assert.equal(result.serviceScope, scope); assert.equal(calls.length, 0);
  }
});

test('public HTTP rejects inconsistent trusted scope before challenge verification', async t => {
  const { env } = fixture(t);
  Object.assign(env, { SUPPORT_ALLOWED_ORIGINS: 'https://www.researchvaultagent.ir', TURNSTILE_SECRET: 'TEST_SECRET' });
  let verificationCalls = 0;
  const response = await supportHttp(new Request('https://support.internal/v1/chat', { method: 'POST', headers: {
    origin: 'https://www.researchvaultagent.ir', 'x-rv-support-page': '/patent/en/', 'x-rv-support-scope': 'patent_pct',
  }, body: '{}' }), env, async () => { verificationCalls++; throw Error(); });
  assert.equal(response.status, 403); assert.equal(verificationCalls, 0);
});

test('a history from another branch is discarded by the public HTTP adapter', async t => {
  const { env, calls } = fixture(t);
  const origin = 'https://www.researchvaultagent.ir';
  Object.assign(env, { SUPPORT_ALLOWED_ORIGINS: origin, TURNSTILE_SECRET: 'TEST_SECRET' });
  const response = await supportHttp(new Request('https://support.internal/v1/chat', { method: 'POST', headers: {
    origin, 'x-rv-support-page': '/patent/',
  }, body: JSON.stringify({ message: 'Please explain the next step', language: 'en', turnstileToken: 'TEST_TOKEN',
    historyScope: 'patent_pct', history: [{ role: 'user', content: 'OTHER_BRANCH_HISTORY' }] }) }),
  env, async () => Response.json({ success: true, action: 'support_chat', hostname: new URL(origin).hostname }));
  assert.equal(response.status, 200);
  assert.doesNotMatch(JSON.stringify(calls[0].input), /OTHER_BRANCH_HISTORY/);
});

test('private Telegram calls retain the original explicit default guide and routing', async t => {
  const { service, calls } = fixture(t);
  const result = await service.chat({ message: 'pricing', language: 'en' });
  assert.equal(result.reply, faqAnswer('pricing', 'en')); assert.equal(calls.length, 0);
  assert.equal(directIntent('10.1000/example').kind, 'article_doi');
});


test('international phase questions state the exclusion without importing another service', async t => {
  for (const [message, language] of [
    ['Do you handle national phase entry?', 'en'],
    ['When do your international-phase services end?', 'en'],
    ['خدمات شما شامل فاز ملی می‌شود؟', 'fa'],
  ]) {
    const { service, calls } = fixture(t);
    const reply = await service.chat({ message, language, scope: 'patent_pct' });
    assert.equal(reply.source, 'service_guide');
    assert.equal(reply.reply, faqAnswer('scope', language, 'patent_pct'));
    assert.match(reply.reply, language === 'en' ? /outside the base agreement/ : /خارج از محدوده قرارداد پایه/);
    assert.equal(calls.length, 0);
  }
});
