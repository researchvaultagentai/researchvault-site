import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkPackage } from '../src/contracts.js';
import { D1WorkStore } from '../src/d1-store.js';
import { createWorkTools } from '../src/work-tools.js';
import { sqliteD1 } from './sqlite-d1.js';
import { intake, admin, client, agent, HASH } from './fixtures.js';

test('scoped Work handlers require authorization and verify package/checkpoint server records', async t => {
  const db = sqliteD1(); t.after(() => db.raw.close());
  const store = new D1WorkStore(db);
  const { packet, packageHash } = await buildWorkPackage(await intake());
  await store.initialize({ caseId: 'case_1', ownerId: 'client_1', reportLanguage: 'en' });
  let loaded = packet;
  const verified = [];
  const tools = createWorkTools({ store, loadPackage: async () => loaded,
    verifyCheckpoint: async info => { verified.push(info); return HASH; } });
  await assert.rejects(tools.getPacket(agent), { code: 'case_run_scope_required' });
  await store.execute({ caseId: 'case_1', commandId: 'input', expectedVersion: 0, actor: client,
    event: { type: 'inputs_changed', packageHash, reportLanguage: 'en' } });
  await store.execute({ caseId: 'case_1', commandId: 'submit', expectedVersion: 1, actor: client,
    event: { type: 'client_submitted', inputRevision: 1 } });
  await store.execute({ caseId: 'case_1', commandId: 'approve', expectedVersion: 2, actor: admin,
    event: { type: 'authorize_run', inputRevision: 1, packageHash, runId: 'run_1' } });
  await assert.rejects(tools.getPacket({ ...agent, runId: 'other' }), { code: 'case_run_scope_required' });
  loaded = { ...packet, technical_title: 'tampered' };
  await assert.rejects(tools.getPacket(agent), { code: 'package_integrity_failure' });
  loaded = packet;
  const context = await tools.getPacket(agent);
  assert.equal(context.state_version, 3);
  assert.equal(context.packet.report_language, 'en');
  await tools.claimStage(agent, { commandId: 'claim', expectedVersion: 3, stage: 'intake_analysis', packageHash });
  await assert.rejects(tools.getPacket({ ...agent, executionId: 'chat_2' }), { code: 'execution_already_claimed' });
  const checkpoint = { commandId: 'checkpoint', expectedVersion: 4,
    stage: 'intake_analysis', artifactId: 'artifact_1', resultHash: 'untrusted-model-value' };
  await tools.submitCheckpoint(agent, checkpoint);
  assert.equal((await tools.submitCheckpoint(agent, checkpoint)).replayed, true);
  assert.equal(verified[0].packageHash, packageHash);
  assert.equal((await store.read('case_1')).run.checkpointHash, HASH);
  assert.equal((await store.pending()).filter(e => e.name === 'patent.checkpoint_ready').length, 1);
  assert.deepEqual(Object.keys(tools).sort(), ['claimStage', 'getPacket', 'submitCheckpoint']);
});
