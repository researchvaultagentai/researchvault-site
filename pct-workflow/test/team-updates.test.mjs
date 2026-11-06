import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTeamUpdateExtension, clientTeamUpdates, pendingTeamUpdates, UPDATE_WINDOW } from '../src/team-updates.js';

test('a stage handoff, an official wait, and private follow-up retain independent deadlines',()=>{
  const t=10000;
  const state={stage:'pct_start_pending',start_requested_at:t};
  const [original]=pendingTeamUpdates(state);
  assert.equal(original.due_at,t+UPDATE_WINDOW);
  state.stage='pct_drafting';state.preparation_started_at=t+2000;
  assert.deepEqual(pendingTeamUpdates(state),[original]);
  state.stage='isa_wait';
  assert.deepEqual(pendingTeamUpdates(state),[]);
  state.messages=[{actor:'client',at:t+3600},{actor:'client',at:t+3800}];
  const [message]=pendingTeamUpdates(state);
  assert.equal(message.kind,'message');
  assert.equal(message.due_at,t+3600+UPDATE_WINDOW);
  state.messages.push({actor:'team',at:t+4000});
  assert.deepEqual(pendingTeamUpdates(state),[]);
  state.stage='pct_response';state.isa={received_at:t+4500};
  assert.equal(pendingTeamUpdates(state)[0].due_at,t+4500+UPDATE_WINDOW);
  state.team_update_at=t+4800;
  assert.equal(pendingTeamUpdates(state)[0].due_at,t+4800+UPDATE_WINDOW);
});

test('extending a single deadline restarts it from the server time without answering a customer message',()=>{
  const s={stage:'report_work',report_started_at:100,
    messages:[{actor:'client',at:200,body:'Please update me.'}]};
  const [report,message]=pendingTeamUpdates(s);
  assert.equal(applyTeamUpdateExtension(s,report,10000),10000+UPDATE_WINDOW);
  const [unchanged,next]=pendingTeamUpdates(s);
  assert.deepEqual(unchanged,message);
  assert.equal(next.due_at,10000+UPDATE_WINDOW);
  assert.notEqual(next.key,report.key);
  assert.equal(clientTeamUpdates(s)[1].task_key,undefined);
  assert.equal(s.messages.length,1);
  s.stage='isa_wait';
  assert.deepEqual(pendingTeamUpdates(s),[message]);
});
