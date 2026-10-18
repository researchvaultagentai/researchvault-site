import { WorkerEntrypoint } from 'cloudflare:workers';
import { createPatentNotificationService } from './service.js';
import { privateHttp } from '../shared.js';

export class PatentNotifications extends WorkerEntrypoint {
  async health() { return createPatentNotificationService(this.env).health(); }
  async notify(event) { return createPatentNotificationService(this.env).notify(event); }
}

export default { fetch: privateHttp };
