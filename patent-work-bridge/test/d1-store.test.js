import test from 'node:test';
import assert from 'node:assert/strict';
import { D1WorkStore } from '../src/d1-store.js';
import { sqliteD1 } from './sqlite-d1.js';
import { HASH, client, admin } from './fixtures.js';

async function fixture(t) {
  const db = sqliteD1(); t.after(() => db.raw.close());
  const store = new D1WorkStore(db);
  await store.initialize({ caseId: 'case_1', ownerId: 'client_1', reportLanguage: 'en' });
  await store.execute({ caseId: 'case_1', commandId: 'input_1', expectedVersion: 0, actor: client,
    event: { type: 'inputs_changed', packageHash: HASH, reportLanguage: 'en' } });
  const submission = { caseId: 'case_1', commandId: 'submit_1', expectedVersion: 1, actor: client,
    event: { type: 'client_submitted', inputRevision: 1 } };
  return { db, store, submission };
}

test('duplicate webhook commands persist once and survive a new store instance', async t => {
  const { db, store, submission } = await fixture(t);
  const first = await store.execute(submission);
  const replay = await new D1WorkStore(db).execute(submission);
  assert.deepEqual(first.state, replay.state);
  assert.equal(replay.replayed, true);
  assert.equal((await store.read('case_1')).version, 2);
  assert.equal((await store.pending()).length, 1);
  await assert.rejects(store.execute({ ...submission, actor: admin }), { code: 'command_id_conflict' });
});

test('two commands at the same state version cannot both advance or emit', async t => {
  const { store, submission } = await fixture(t);
  const results = await Promise.allSettled([
    store.execute(submission), store.execute({ ...submission, commandId: 'submit_2' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'state_version_conflict');
  assert.equal((await store.read('case_1')).version, 2);
  assert.equal((await store.pending()).length, 1);
});

test('same concurrent command is idempotent without duplicate outbox records', async t => {
  const { store, submission } = await fixture(t);
  const results = await Promise.all([store.execute(submission), store.execute(submission)]);
  assert.deepEqual(results[0].state, results[1].state);
  assert.equal((await store.pending()).length, 1);
});

test('failed outbox insert rolls back command receipt and state as one transaction', async t => {
  const { db, store, submission } = await fixture(t);
  db.raw.exec(`CREATE TRIGGER fail_outbox BEFORE INSERT ON patent_work_bridge_outbox
    BEGIN SELECT RAISE(ABORT, 'simulated outbox failure'); END`);
  await assert.rejects(store.execute(submission), /simulated outbox failure/);
  assert.equal((await store.read('case_1')).version, 1);
  assert.equal((await store.pending()).length, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM patent_work_bridge_commands').get().n, 1);
  db.raw.exec('DROP TRIGGER fail_outbox');
  assert.equal((await store.execute(submission)).state.version, 2);
});

test('a revoked authorization stays revoked after restart and cannot dispatch Work', async t => {
  const { db, store, submission } = await fixture(t);
  await store.execute(submission);
  await store.execute({ caseId: 'case_1', commandId: 'authorize_1', expectedVersion: 2, actor: admin,
    event: { type: 'authorize_run', inputRevision: 1, packageHash: HASH, runId: 'run_1' } });
  const event = (await store.pending()).find(e => e.destination === 'work');
  assert.equal(await store.eligible(event), true);
  await store.execute({ caseId: 'case_1', commandId: 'new_language', expectedVersion: 3, actor: client,
    event: { type: 'inputs_changed', packageHash: 'b'.repeat(64), reportLanguage: 'fa' } });
  const restarted = new D1WorkStore(db);
  assert.equal(await restarted.eligible(event), false);
  await restarted.acknowledge(event.id, 'dropped');
  assert.equal((await restarted.pending()).filter(e => e.destination === 'work').length, 0);
});

test('initialization cannot reassign ownership or overwrite stored state', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.initialize({ caseId: 'case_1', ownerId: 'other', reportLanguage: 'en' }), { code: 'case_owner_conflict' });
  assert.equal((await store.initialize({ caseId: 'case_1', ownerId: 'client_1', reportLanguage: 'fa' })).reportLanguage, 'en');
});
