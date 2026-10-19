import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, canDeliverWorkEvent, STAGES } from '../src/workflow.js';
import { submitted, authorized, client, admin, agent, HASH } from './fixtures.js';

test('customer completion never starts Work and cannot be impersonated by admin or model', () => {
  const draft = transition(initialState('case_1', 'client_1', 'en'),
    { type: 'inputs_changed', packageHash: HASH, reportLanguage: 'en' }, client).state;
  const event = { type: 'client_submitted', inputRevision: 1 };
  for (const actor of [admin, agent, { role: 'client', id: 'other' }]) {
    assert.throws(() => transition(draft, event, actor), { code: 'case_owner_required' });
  }
  const result = transition(draft, event, client);
  assert.equal(result.state.run, null);
  assert.deepEqual(result.effects.map(e => e.destination), ['telegram_admin']);
  assert.throws(() => transition(result.state,
    { type: 'authorize_run', runId: 'run_1', inputRevision: 1, packageHash: HASH }, agent), { code: 'admin_required' });
});

test('new package or language revokes unused approval and drops stale Work wake-ups', () => {
  const result = transition(submitted(),
    { type: 'authorize_run', runId: 'run_1', inputRevision: 1, packageHash: HASH }, admin);
  assert.equal(canDeliverWorkEvent(result.effects[0], result.state), true);
  const changed = transition(result.state,
    { type: 'inputs_changed', packageHash: 'b'.repeat(64), reportLanguage: 'fa' }, client).state;
  assert.equal(changed.run, null);
  assert.equal(changed.clientSubmitted, false);
  assert.equal(canDeliverWorkEvent(result.effects[0], changed), false);
  assert.throws(() => transition(changed,
    { type: 'authorize_run', runId: 'run_2', inputRevision: 1, packageHash: HASH }, admin), { code: 'client_submission_required' });
});

test('all stages wait for exact human approval; final PDF stops Work interaction', () => {
  let state = authorized();
  for (const stage of STAGES) {
    assert.throws(() => transition(state, { type: 'claim_stage', stage, packageHash: HASH },
      { ...agent, caseId: 'case_2' }), { code: 'case_run_scope_required' });
    state = transition(state, { type: 'claim_stage', stage, packageHash: HASH }, agent).state;
    const resultHash = String(STAGES.indexOf(stage) + 1).repeat(64);
    const result = transition(state, { type: 'stage_result', stage, resultHash }, agent);
    state = result.state;
    assert.equal(state.run.phase, 'awaiting_approval');
    assert.deepEqual(result.effects.map(e => e.destination), ['telegram_admin']);
    assert.throws(() => transition(state, { type: 'claim_stage', stage, packageHash: HASH }, agent), { code: 'stage_not_authorized' });
    assert.throws(() => transition(state,
      { type: 'approve_stage', runId: 'run_1', inputRevision: 1, resultHash }, agent), { code: 'admin_required' });
    assert.throws(() => transition(state,
      { type: 'approve_stage', runId: 'run_1', inputRevision: 1, resultHash: HASH }, admin), { code: 'stale_approval' });
    const approved = transition(state,
      { type: 'approve_stage', runId: 'run_1', inputRevision: 1, resultHash }, admin);
    state = approved.state;
    assert.equal(approved.effects[0].destination, stage === 'pdf_qc' ? 'telegram_admin' : 'work');
    assert.throws(() => transition(state,
      { type: 'inputs_changed', packageHash: HASH, reportLanguage: 'en' }, client), { code: 'revision_workflow_required' });
  }
  assert.equal(state.run.phase, 'finalized');
  assert.equal(state.run.approvedCheckpoints.length, STAGES.length);
  assert.equal(canDeliverWorkEvent({ destination: 'work' }, state), false);
});

test('scopeless model calls fail closed before a run exists', () => {
  assert.throws(() => transition(submitted(), { type: 'claim_stage' },
    { role: 'agent', caseId: 'case_1', executionId: 'chat_1' }), { code: 'case_run_scope_required' });
});
