import { WorkerEntrypoint } from 'cloudflare:workers';
import { createPatentOrchestrator, createPatentClientControl, createPatentAdminControl } from './service.js';
import { privateHttp } from '../shared.js';

export class PatentOrchestrator extends WorkerEntrypoint {
  async health() { return createPatentOrchestrator(this.env).health(); }
  async prepare(input) { return createPatentOrchestrator(this.env).prepare(input); }
  async drain(options) { return createPatentOrchestrator(this.env).drain(options); }
}

// Separate RPC entrypoints prevent a Work caller from gaining an admin method
// merely by choosing a different tool argument. Bind only the intended role.
export class PatentClientControl extends WorkerEntrypoint {
  async submit(input) { return createPatentClientControl(this.env).submit(input); }
}

export class PatentAdminControl extends WorkerEntrypoint {
  async queue(input) { return createPatentAdminControl(this.env).queue(input); }
  async authorizeRun(input) { return createPatentAdminControl(this.env).authorizeRun(input); }
  async approveStage(input) { return createPatentAdminControl(this.env).approveStage(input); }
}

export default { fetch: privateHttp };
