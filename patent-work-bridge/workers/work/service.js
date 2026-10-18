import { buildWorkPackage } from '../../src/contracts.js';
import { metadata } from '../shared.js';

export function createPatentWorkService() {
  return {
    async health() {
      return { service: 'researchvault-patent-work', package_preparation: true,
        work_transport_connected: false };
    },
    async prepare(input) { return buildWorkPackage(input); },
    async wake(input) {
      const event = metadata(input);
      if (event.destination !== 'work') throw new Error('invalid_destination');
      // No external call or invented success. Native authenticated MCP Events
      // transport must be connected and tested in the dedicated Work account.
      return { status: 'deferred', code: 'work_connection_required' };
    },
  };
}
