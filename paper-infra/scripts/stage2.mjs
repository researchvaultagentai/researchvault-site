import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const account = '36c3a32f4feac9d764c4f82b66c3a9d5';
const names = [...Array.from({ length: 7 }, (_, i) => 'source-0' + (i + 1)), 'pdf-finder', 'doi-resolver'];
const configs = names.map(name => `stage2/wrangler.${name}.jsonc`);
for (const filename of configs) {
  const cfg = JSON.parse(readFileSync(filename, 'utf8'));
  assert.ok(cfg.name.startsWith('rv-source-') || ['rv-doi-resolver', 'rv-pdf-finder'].includes(cfg.name));
  assert.equal(cfg.account_id, account);
  assert.equal(cfg.workers_dev, false); assert.equal(cfg.preview_urls, false); assert.equal(cfg.keep_vars, true);
  assert.equal(cfg.routes, undefined); assert.equal(cfg.route, undefined); assert.equal(cfg.triggers, undefined);
  if (cfg.d1_databases) {
    assert.equal(cfg.d1_databases.length, 1);
    assert.equal(cfg.d1_databases[0].database_id, '5a85c8e3-99c3-441b-8c07-94d41a1a5f2a');
    assert.equal(cfg.d1_databases[0].binding, 'PAPER_DB');
  }
}
const migration = readFileSync('migrations/stage2/0001_paper_pipeline.sql', 'utf8');
assert.ok(!/\b(?:DROP|ALTER|DELETE|UPDATE|INSERT|REPLACE)\b/i.test(migration));
assert.equal([...migration.matchAll(/CREATE TABLE IF NOT EXISTS (rv_paper_\w+)/g)].length, 4);
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: account } });
  if (result.status !== 0) process.exit(result.status || 1);
}
const mode = process.argv[2] || 'validate';
if (!['validate', 'bundle', 'deploy'].includes(mode)) throw Error('Use validate, bundle, or deploy');
if (mode === 'validate') { console.log('Stage 2 configuration and additive schema checks passed.'); process.exit(); }
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
if (mode === 'deploy') {
  // Existing signed-in operator account only. Never create a temporary account.
  run([wrangler, 'whoami']);
  run([wrangler, 'd1', 'execute', 'PAPER_DB', '--remote', '--config', 'stage2/wrangler.doi-resolver.jsonc',
    '--file', 'migrations/stage2/0001_paper_pipeline.sql']);
}
for (const filename of configs) run([wrangler, 'deploy', '--config', filename,
  ...(mode === 'bundle' ? ['--dry-run', '--outdir', `.wrangler/stage2/${filename.split('/').pop()}`] : [])]);
console.log(mode === 'deploy'
  ? 'Nine private Workers deployed. Bot rollout was not changed. Complete remote verification before enabling a cohort.'
  : 'All nine Stage 2 Worker bundles compiled without deployment.');
