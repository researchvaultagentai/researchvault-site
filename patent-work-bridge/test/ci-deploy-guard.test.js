import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_ACTION, DEPLOY_REQUEST_PATH, validateDeploymentRequest } from '../scripts/ci-deploy-guard.js';

const sourceCommit = 'a'.repeat(40);
function valid() {
  return {
    request: { schemaVersion: 1, action: DEPLOY_ACTION, sourceCommit },
    repository: 'researchvaultagentai/researchvault-site',
    ref: 'refs/heads/feature/patent-work-connection-prep',
    parentCommit: sourceCommit,
    changedFiles: [DEPLOY_REQUEST_PATH],
  };
}

test('CI preparation never grants deployment', () => {
  const input = valid();
  input.request = { schemaVersion: 1, action: 'none', sourceCommit: null };
  assert.equal(validateDeploymentRequest(input), false);
});

test('CI accepts an activation-only commit for the reviewed source', () => {
  assert.equal(validateDeploymentRequest(valid()), true);
});

test('CI rejects other repositories and branches', () => {
  for (const change of [{ repository: 'someone/another-repo' }, { ref: 'refs/heads/main' }, { ref: 'refs/pull/4/merge' }]) {
    assert.throws(() => validateDeploymentRequest({ ...valid(), ...change }));
  }
});

test('CI cannot bundle a source or protected bot change with activation', () => {
  for (const path of ['patent-work-bridge/workers/work/index.js', 'article-bot/index.js', '.github/workflows/patent-private-workers.yml']) {
    assert.throws(() => validateDeploymentRequest({ ...valid(), changedFiles: [DEPLOY_REQUEST_PATH, path] }));
  }
});

test('CI rejects stale and malformed source approvals', () => {
  assert.throws(() => validateDeploymentRequest({ ...valid(), parentCommit: 'b'.repeat(40) }));
  const input = valid();
  input.request.sourceCommit = 'HEAD';
  assert.throws(() => validateDeploymentRequest(input));
});

test('CI rejects extra target fields and unknown actions', () => {
  const withTarget = valid();
  withTarget.request.worker = 'researchvault-bot';
  assert.throws(() => validateDeploymentRequest(withTarget));
  const unknown = valid();
  unknown.request.action = 'deploy-all-workers';
  assert.throws(() => validateDeploymentRequest(unknown));
});

test('CI rejects a hidden source approval in an inactive request', () => {
  const input = valid();
  input.request.action = 'none';
  assert.throws(() => validateDeploymentRequest(input));
});
