import { WorkerEntrypoint } from 'cloudflare:workers';
import { createPatentWorkService } from './service.js';
import { privateHttp } from '../shared.js';

export class PatentWork extends WorkerEntrypoint {
  async health() { return createPatentWorkService().health(); }
  async prepare(input) { return createPatentWorkService().prepare(input); }
  async wake(event) { return createPatentWorkService().wake(event); }
}

export default { fetch: privateHttp };
