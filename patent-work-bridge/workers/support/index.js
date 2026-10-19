import { WorkerEntrypoint } from 'cloudflare:workers';
import { createSupportService } from './service.js';
import { supportHttp } from './http.js';

export class SupportAssistant extends WorkerEntrypoint {
  async health() { return createSupportService(this.env).health(); }
  async chat(input) { return createSupportService(this.env).chat(input); }
  async classify(input) { return createSupportService(this.env).classify(input); }
}

export default { fetch(request, env) { return supportHttp(request, env); } };
