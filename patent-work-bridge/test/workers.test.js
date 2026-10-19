import test from 'node:test';
import assert from 'node:assert/strict';
import { D1WorkStore } from '../src/d1-store.js';
import { createPatentOrchestrator, createPatentClientControl, createPatentAdminControl } from '../workers/orchestrator/service.js';
import { createPatentWorkService } from '../workers/work/service.js';
import { createPatentNotificationService } from '../workers/notifications/service.js';
import { privateHttp } from '../workers/shared.js';
import { validateWorkerConfigs } from '../scripts/worker-configs.js';
import { sqliteD1 } from './sqlite-d1.js';
import { intake, HASH } from './fixtures.js';

async function fixture(t, extra = {}) {
  const db = sqliteD1(); t.after(() => db.raw.close());
  const env = { PATENT_DB: db, PATENT_WORK: createPatentWorkService(),
    PATENT_NOTIFY: createPatentNotificationService({}), PATENT_ADMIN_IDS: 'admin_1',
    PATENT_OUTBOX_ENABLED: 'true', ...extra };
  const orchestrator = createPatentOrchestrator(env, { now: () => 1000000 });
  const prepared = await orchestrator.prepare(await intake());
  const submitted = await createPatentClientControl(env).submit({ caseId: 'case_1', ownerId: 'client_1',
    reportLanguage: 'en', packageHash: prepared.packageHash, commandId: 'submit_1', expectedVersion: 0 });
  return { db, env, orchestrator, prepared, submitted, store: new D1WorkStore(db) };
}

test('worker configs bind only dedicated helpers and their isolated databases', () => {
  const configs = validateWorkerConfigs();
  const modified = structuredClone(configs);
  modified[3].services[0].service = 'researchvault-bot';
  assert.throws(() => validateWorkerConfigs(modified));
  const exposed = structuredClone(configs); exposed[3].workers_dev = true;
  assert.throws(() => validateWorkerConfigs(exposed));
  const caseDatabase = structuredClone(configs);
  caseDatabase[2].d1_databases[0].database_id = configs[3].d1_databases[0].database_id;
  assert.throws(() => validateWorkerConfigs(caseDatabase));
  const articleDatabase = structuredClone(configs);
  articleDatabase[2].d1_databases[0].database_name = 'researchvault-db';
  assert.throws(() => validateWorkerConfigs(articleDatabase));
  const unrecordedDatabase = structuredClone(configs);
  delete unrecordedDatabase[2].d1_databases[0].database_id;
  assert.throws(() => validateWorkerConfigs(unrecordedDatabase));
  assert.equal(privateHttp().status, 404);
});

test('orchestrator reaches both helper services; client submission only queues admin notice', async t => {
  const { orchestrator, prepared, store, env } = await fixture(t);
  const health = await orchestrator.health();
  assert.equal(health.work.package_preparation, true);
  assert.equal(health.work.work_transport_connected, false);
  assert.equal(health.notifications.telegram_configured, false);
  assert.equal(prepared.packet.report_language, 'en');
  assert.deepEqual((await store.pending(10, 1000000)).map(e => e.destination), ['telegram_admin']);
  assert.equal((await store.read('case_1')).run, null);
  const queue = await createPatentAdminControl(env).queue({ adminId: 'admin_1' });
  assert.equal(queue.cases[0].phase, 'awaiting_admin');
  await assert.rejects(createPatentAdminControl(env).queue({ adminId: 'not_admin' }), { code: 'admin_required' });
});

test('client RPC replay does not create extra inputs, notifications or execution', async t => {
  const { env, prepared, submitted, store } = await fixture(t);
  const replay = await createPatentClientControl(env).submit({ caseId: 'case_1', ownerId: 'client_1',
    reportLanguage: 'en', packageHash: prepared.packageHash, commandId: 'submit_1', expectedVersion: 0 });
  assert.deepEqual(replay.state, submitted.state);
  assert.equal((await store.pending()).length, 1);
});

test('disconnected Work/Telegram keeps events queued instead of inventing delivery success', async t => {
  const { env, orchestrator, prepared, store } = await fixture(t);
  await createPatentAdminControl(env).authorizeRun({ adminId: 'admin_1', caseId: 'case_1',
    commandId: 'authorize', expectedVersion: 2, runId: 'run_1', inputRevision: 1, packageHash: prepared.packageHash });
  const result = await orchestrator.drain();
  assert.deepEqual(result, { enabled: true, sent: 0, dropped: 0, deferred: 2 });
  assert.equal((await store.pending(10, 1000000)).length, 0);
  assert.equal((await store.pending(10, 1300000)).length, 2);
  const codes = env.PATENT_DB.raw.prepare('SELECT last_error FROM patent_work_bridge_outbox ORDER BY last_error').all();
  assert.deepEqual(codes.map(row => row.last_error), ['telegram_not_configured', 'work_connection_required']);
});

test('concurrent drains acquire one delivery lease and call the notification helper once', async t => {
  let calls = 0;
  const notifier = { async health() { return {}; }, async notify() { calls++; return { status: 'sent' }; } };
  const { env, store } = await fixture(t, { PATENT_NOTIFY: notifier });
  const [a, b] = await Promise.all([
    createPatentOrchestrator(env, { now: () => 1000000 }).drain(),
    createPatentOrchestrator(env, { now: () => 1000000 }).drain(),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.sent + b.sent, 1);
  assert.equal((await store.pending()).length, 0);
});

test('failure in one helper does not prevent another destination from delivering', async t => {
  const { env, prepared, store } = await fixture(t, {
    PATENT_NOTIFY: { async notify() { return { status: 'sent' }; } },
  });
  await createPatentAdminControl(env).authorizeRun({ adminId: 'admin_1', caseId: 'case_1',
    commandId: 'authorize', expectedVersion: 2, runId: 'run_1', inputRevision: 1, packageHash: prepared.packageHash });
  env.PATENT_WORK = { async wake() { throw new Error('provider URL WITH SECRET'); } };
  const result = await createPatentOrchestrator(env, { now: () => 1000000 }).drain();
  assert.equal(result.sent, 1); assert.equal(result.deferred, 1);
  const row = env.PATENT_DB.raw.prepare("SELECT last_error FROM patent_work_bridge_outbox WHERE destination='work'").get();
  assert.equal(row.last_error, 'delivery_failed');
  assert.equal((await store.pending(10, 1300000)).length, 1);
});

test('disabled outbox sends nothing and does not require any database', async () => {
  const result = await createPatentOrchestrator({}).drain();
  assert.equal(result.enabled, false);
  assert.equal(result.sent, 0);
});

test('Telegram uses fixed private admin destination and whitelisted metadata only', async () => {
  const requests = [];
  const env = { PATENT_TELEGRAM_ENABLED: 'true', PATENT_TELEGRAM_BOT_TOKEN: '123:TESTTOKEN000000000000000',
    PATENT_ADMIN_CHAT_ID: '12345' };
  const service = createPatentNotificationService(env, async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({ ok: true, result: { message_id: 17 } });
  });
  const event = { id: 'event_1', name: 'patent.intake_submitted', destination: 'telegram_admin',
    case_id: 'case_1', run_id: null, input_revision: 1, stage: null, package_sha256: HASH,
    document: 'PRIVATE FILE', master_prompt: 'PRIVATE PROMPT', password: 'PRIVATE PASSWORD', chat_id: 'attacker' };
  assert.equal((await service.notify(event)).status, 'sent');
  const body = JSON.parse(requests[0].body);
  assert.equal(body.chat_id, '12345');
  assert.equal(body.protect_content, true);
  assert.doesNotMatch(requests[0].body, /PRIVATE|attacker|TESTTOKEN/);
  assert.match(requests[0].url, /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/);
  await assert.rejects(createPatentNotificationService({ ...env, PATENT_ADMIN_CHAT_ID: '-12345' })
    .notify(event), { code: 'private_admin_chat_required' });
});

test('expired lease can be recovered; an older lease cannot acknowledge newer work', async t => {
  const { store } = await fixture(t);
  const event = (await store.pending(10, 1000000))[0];
  assert.equal(await store.claimDelivery(event.id, 'lease_1', 1000000, 1000), true);
  assert.equal(await store.claimDelivery(event.id, 'lease_2', 1000000, 1000), false);
  assert.equal(await store.claimDelivery(event.id, 'lease_2', 1001001, 1000), true);
  assert.equal(await store.finishDelivery(event.id, 'lease_1', 'sent'), false);
  assert.equal(await store.finishDelivery(event.id, 'lease_2', 'sent'), true);
});
