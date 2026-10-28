import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1.js';
import { D1WorkStore } from '../src/d1-store.js';
import { initialState } from '../src/workflow.js';
import { createPatentAdminControl, createPatentQueueView } from '../workers/orchestrator/service.js';

function fixture(t) {
  const db = sqliteD1(); t.after(() => db.raw.close());
  db.raw.exec(readFileSync(new URL('../../patent-api/migrations/0001_init.sql', import.meta.url), 'utf8'));
  db.raw.exec("INSERT INTO patent_users(id,email,created_at,updated_at) VALUES('owner','test@example.invalid',1,1)");
  const env = { PATENT_DB: db, PATENT_ADMIN_IDS: 'admin_1' };
  function portal(id, stage = 'onboarding') {
    db.raw.prepare(`INSERT INTO patent_cases(id,user_id,public_ref,title,service_type,pricing_market,case_stage,created_at,updated_at)
      VALUES(?,'owner',?,?,'pct','international',?,1,1793174400)`).run(id, 'RV-' + id, 'Test ' + id, stage);
  }
  function bridge(id, overrides = {}) {
    const state = { ...initialState(id, 'owner', 'en'), ...overrides };
    db.raw.prepare('INSERT INTO patent_work_bridge_state(case_id,version,state_json) VALUES(?,?,?)')
      .run(id, state.version, JSON.stringify(state));
  }
  return { db, env, portal, bridge, view: createPatentQueueView(env) };
}

test('both early portal cases from the same owner appear without submission or a bridge record', async t => {
  const f = fixture(t); f.portal('case_1'); f.portal('case_2', 'draft');
  const result = await f.view.queue({ adminId: 'admin_1', limit: 5 });
  assert.equal(result.total_cases, 2);
  assert.equal(result.scope, 'all_cases');
  assert.deepEqual(result.cases.map(c => c.case_id), ['case_1', 'case_2']);
  for (const item of result.cases) {
    assert.equal(item.phase, 'portal_only');
    assert.equal(item.next_action, 'connect_intake');
    assert.equal(item.input_revision, 0);
    assert.equal(item.report_language, null); // Never infer language from market or admin locale.
    assert.equal(item.updated_at, '2026-10-28T08:00:00.000Z');
    assert.ok(item.public_ref.startsWith('RV-'));
    assert.doesNotMatch(JSON.stringify(item), /test@example|owner|packageHash|password|object_key/);
  }
  // Reporting does not manufacture a client submission or authorize any work.
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM patent_work_bridge_state').get().n, 0);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM patent_work_bridge_outbox').get().n, 0);
  assert.equal((await createPatentAdminControl(f.env).queue({ adminId: 'admin_1' })).cases.length, 0);
});

test('all portal stages, finalized work and bridge-only records are paginated once each', async t => {
  const f = fixture(t);
  const stages = ['draft', 'onboarding', 'stage1', 'client_decision', 'stage2', 'filing', 'post_filing', 'completed', 'withdrawn', 'suspended'];
  stages.forEach((stage, i) => f.portal(`case_${String(i).padStart(2, '0')}`, stage));
  f.bridge('case_07', { clientSubmitted: true, inputRevision: 1, run: { phase: 'finalized', stageIndex: 5 } });
  f.bridge('orphan_case', { clientSubmitted: true, inputRevision: 1 });
  const cases = []; let cursor = '';
  do {
    const page = await f.view.queue({ adminId: 'admin_1', afterCaseId: cursor, limit: 2 });
    assert.equal(page.total_cases, 11);
    cases.push(...page.cases); cursor = page.next_after_case_id;
  } while (cursor);
  assert.equal(new Set(cases.map(c => c.case_id)).size, 11);
  assert.equal(cases.length, 11);
  assert.deepEqual(cases.filter(c => c.case_stage).map(c => c.case_stage), stages);
  assert.equal(cases.find(c => c.case_id === 'case_07').phase, 'finalized');
  assert.equal(cases.find(c => c.case_id === 'case_09').next_action, 'review_suspension');
  assert.equal(cases.at(-1).phase, 'awaiting_admin');
});

test('unconfirmed input revisions and inconsistent status are explicit instead of disappearing', async t => {
  const f = fixture(t); f.portal('case_a'); f.bridge('case_a');
  f.portal('case_b', 'withdrawn');
  f.bridge('case_b', { clientSubmitted: true, inputRevision: 1, run: { phase: 'running', stageIndex: 2 } });
  f.portal('case_c');
  f.db.raw.prepare('INSERT INTO patent_work_bridge_state(case_id,version,state_json) VALUES(?,0,?)').run('case_c', 'not JSON');
  const { cases } = await f.view.queue({ adminId: 'admin_1' });
  assert.equal(cases[0].phase, 'awaiting_submission');
  assert.equal(cases[1].stage, 'prior_art_review');
  assert.equal(cases[1].next_action, 'check_status_mismatch');
  assert.equal(cases[2].phase, 'workflow_unknown');
  assert.equal(cases[2].next_action, 'check_workflow');
});

test('the inventory executes SELECTs only and preserves all portal and workflow records', async t => {
  const f = fixture(t); f.portal('case_1');
  await new D1WorkStore(f.db).initialize({ caseId: 'case_1', ownerId: 'owner', reportLanguage: 'fa' });
  const before = f.db.raw.prepare('SELECT * FROM patent_work_bridge_state').all();
  const queries = [];
  const env = { ...f.env, PATENT_DB: { prepare(query) {
    assert.match(query.trim(), /^(SELECT|WITH)\b/);
    queries.push(query); return f.db.prepare(query);
  } } };
  await createPatentQueueView(env).queue({ adminId: 'admin_1' });
  assert.equal(queries.length, 2);
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM patent_work_bridge_state').all(), before);
  assert.equal(f.db.raw.prepare('SELECT case_stage FROM patent_cases').get().case_stage, 'onboarding');
});

test('authorization and input checks happen before reading case data', async t => {
  const f = fixture(t);
  const denied = createPatentQueueView({ PATENT_ADMIN_IDS: 'admin_1', PATENT_DB: { prepare() { throw new Error('must not read'); } } });
  await assert.rejects(denied.queue({ adminId: 'someone_else' }), { code: 'admin_required' });
  for (const input of [{ limit: 0 }, { limit: 51 }, { afterCaseId: "'; DROP TABLE patent_cases; --" }]) {
    await assert.rejects(f.view.queue({ adminId: 'admin_1', ...input }));
  }
});

test('a missing portal schema is an error, never a false empty inventory', async t => {
  const db = sqliteD1(); t.after(() => db.raw.close());
  await assert.rejects(createPatentQueueView({ PATENT_DB: db, PATENT_ADMIN_IDS: 'admin_1' })
    .queue({ adminId: 'admin_1' }), /no such table: patent_cases/);
});
