import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateWorkerConfigs } from './worker-configs.js';

export const DEPLOY_REQUEST_PATH = 'patent-work-bridge/deploy-request.json';
export const DEPLOY_ACTION = 'deploy-four-private-patent-workers';
const REPOSITORY = 'researchvaultagentai/researchvault-site';
const REF = 'refs/heads/feature/patent-work-connection-prep';

export function validateDeploymentRequest({ request, repository, ref, parentCommit, changedFiles }) {
  assert.equal(repository, REPOSITORY, 'Unexpected deployment repository');
  assert.equal(ref, REF, 'Unexpected deployment branch');
  assert.deepEqual(Object.keys(request).sort(), ['action', 'schemaVersion', 'sourceCommit']);
  assert.equal(request.schemaVersion, 1, 'Unknown request schema');
  if (request.action === 'none') {
    assert.equal(request.sourceCommit, null, 'Inactive requests cannot select a source commit');
    return false;
  }
  assert.equal(request.action, DEPLOY_ACTION, 'Unknown deployment action');
  assert.match(request.sourceCommit, /^[a-f0-9]{40}$/, 'A reviewed source commit is required');
  assert.equal(parentCommit, request.sourceCommit, 'The deployment request must directly follow its reviewed source commit');
  assert.deepEqual(changedFiles, [DEPLOY_REQUEST_PATH], 'Activation must change only the deployment request');
  return true;
}

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) throw new Error('Cannot verify the checked-out deployment commit.');
  return result.stdout.trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  assert(args.length <= 1 && args.every(arg => arg === '--require-deploy'), 'Unknown guard option');
  validateWorkerConfigs();
  const request = JSON.parse(readFileSync(new URL('../deploy-request.json', import.meta.url), 'utf8'));
  const active = validateDeploymentRequest({
    request,
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
    parentCommit: request.action === 'none' ? null : git('rev-parse', 'HEAD^'),
    changedFiles: request.action === 'none' ? [] : git('diff', '--name-only', 'HEAD^', 'HEAD').split('\n'),
  });
  if (args.includes('--require-deploy')) assert(active, 'Deployment has not been explicitly requested');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `deploy_enabled=${active}\n`);
  console.log(active ? 'Reviewed request: deploy the four private patent Workers.' : 'Preparation only: Cloudflare deployment is disabled.');
}
