import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WORKER_CONFIGS, validateWorkerConfigs } from './worker-configs.js';

const options = process.argv.slice(2);
if (options.some(arg => arg !== '--dry-run') || options.length > 1) {
  throw new Error('Only --dry-run is accepted; Worker names/configs cannot be overridden.');
}
validateWorkerConfigs();
for (const config of WORKER_CONFIGS) {
  // Targets are deployed before the orchestrator so its named bindings resolve.
  const result = spawnSync(process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
    ['deploy', '--config', fileURLToPath(config), ...options], { stdio: 'inherit', shell: false });
  if (result.error) throw new Error('Wrangler unavailable. Install the documented development dependency first.');
  if (result.status !== 0) process.exit(result.status || 1);
}
