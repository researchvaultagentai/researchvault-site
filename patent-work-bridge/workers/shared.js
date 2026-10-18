import { identifier, digest, requireValue } from '../src/contracts.js';
import { STAGES } from '../src/workflow.js';

export function metadata(event) {
  requireValue(event && typeof event === 'object', 'invalid_event');
  requireValue(['work', 'telegram_admin'].includes(event.destination), 'invalid_destination');
  requireValue(['patent.intake_submitted', 'patent.analysis_authorized', 'patent.checkpoint_ready',
    'patent.stage_authorized', 'patent.pdf_finalized'].includes(event.name), 'invalid_event_name');
  requireValue(Number.isSafeInteger(event.input_revision) && event.input_revision > 0, 'invalid_input_revision');
  requireValue(event.stage === null || STAGES.includes(event.stage), 'invalid_stage');
  return { id: identifier(event.id), name: event.name, destination: event.destination,
    case_id: identifier(event.case_id), run_id: event.run_id === null ? null : identifier(event.run_id),
    input_revision: event.input_revision, stage: event.stage, package_sha256: digest(event.package_sha256) };
}

export function privateHttp() {
  return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
}
