import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export const WORKER_CONFIGS = [
  new URL('../workers/work/wrangler.jsonc', import.meta.url),
  new URL('../workers/notifications/wrangler.jsonc', import.meta.url),
  new URL('../workers/support/wrangler.jsonc', import.meta.url),
  new URL('../workers/orchestrator/wrangler.jsonc', import.meta.url),
];

export function validateWorkerConfigs(configs = WORKER_CONFIGS.map(url => JSON.parse(readFileSync(url, 'utf8')))) {
  assert.deepEqual(configs.map(c => c.name), [
    'researchvault-patent-work', 'researchvault-patent-notifications', 'researchvault-support', 'researchvault-patent-orchestrator',
  ], 'Only the four dedicated preparation workers may be targeted');
  for (const config of configs) {
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.deepEqual(config.routes, []);
    assert.deepEqual(config.triggers.crons, []);
    for (const key of ['kv_namespaces', 'r2_buckets', 'queues', 'durable_objects', 'env', 'build']) {
      assert.equal(config[key], undefined, `Unexpected resource or build hook: ${key}`);
    }
  }
  assert.equal(configs[0].services, undefined);
  assert.equal(configs[1].services, undefined);
  assert.equal(configs[0].d1_databases, undefined);
  assert.equal(configs[1].d1_databases, undefined);
  assert.equal(configs[2].services, undefined);
  assert.deepEqual(configs[2].ai, { binding: 'AI' });
  assert.deepEqual(configs[2].d1_databases, [{ binding: 'SUPPORT_DB', database_name: 'researchvault-support-db', migrations_dir: 'migrations' }]);
  assert.equal(configs[2].vars.SUPPORT_ENABLED, 'false');
  assert.deepEqual(configs[3].services, [
    { binding: 'PATENT_WORK', service: configs[0].name, entrypoint: 'PatentWork' },
    { binding: 'PATENT_NOTIFY', service: configs[1].name, entrypoint: 'PatentNotifications' },
    { binding: 'SUPPORT_AI', service: configs[2].name, entrypoint: 'SupportAssistant' },
  ]);
  assert.deepEqual(configs[3].d1_databases, [{ binding: 'PATENT_DB', database_name: 'researchvault-patent-db',
    database_id: '89090b29-61fd-4002-bb75-fea8cfda70a5', migrations_dir: '../../migrations' }]);
  assert.equal(configs[3].vars.PATENT_OUTBOX_ENABLED, 'false');
  assert.equal(configs[3].vars.PATENT_ADMIN_IDS, '');
  assert.equal(configs[1].vars.PATENT_TELEGRAM_ENABLED, 'false');
  return configs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateWorkerConfigs();
  console.log(`Validated ${WORKER_CONFIGS.length} isolated Worker configurations.`);
  for (const url of WORKER_CONFIGS) console.log(fileURLToPath(url));
}
