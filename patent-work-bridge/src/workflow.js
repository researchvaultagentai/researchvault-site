import { ControlError, digest, identifier, language, requireValue } from './contracts.js';

export const STAGES = Object.freeze([
  'intake_analysis', 'search_strategy', 'prior_art_review',
  'development_review', 'docx_review', 'pdf_qc',
]);

export function initialState(caseId, ownerId, reportLanguage) {
  return { schemaVersion: 1, caseId: identifier(caseId), ownerId: identifier(ownerId),
    version: 0, inputRevision: 0, reportLanguage: language(reportLanguage),
    packageHash: null, clientSubmitted: false, run: null };
}

function owner(state, actor) {
  requireValue(actor.role === 'client' && actor.id === state.ownerId, 'case_owner_required');
}
function admin(actor) { requireValue(actor.role === 'admin' && actor.id, 'admin_required'); }
function scopedAgent(state, actor) {
  requireValue(state.run && actor.role === 'agent' && actor.caseId === state.caseId &&
    actor.runId === state.run.id && typeof actor.executionId === 'string' && actor.executionId,
  'case_run_scope_required');
}

// Actor identity is supplied only by a verified server-side auth adapter.
// Model text, upload fields and MCP arguments must never construct this actor.
export function transition(state, event, actor) {
  const next = structuredClone(state);
  const effects = [];
  const emit = (name, destination) => effects.push({ name, destination, case_id: next.caseId,
    run_id: next.run?.id || null, input_revision: next.inputRevision,
    stage: next.run ? STAGES[next.run.stageIndex] : null,
    package_sha256: next.packageHash });
  switch (event.type) {
    case 'inputs_changed': {
      if (actor.role === 'client') owner(state, actor); else admin(actor);
      requireValue(!state.run?.executionId, 'revision_workflow_required');
      next.packageHash = digest(event.packageHash);
      next.reportLanguage = language(event.reportLanguage);
      next.inputRevision++;
      if (actor.role === 'client') next.clientSubmitted = false;
      next.run = null;
      break;
    }
    case 'client_submitted':
      owner(state, actor);
      requireValue(state.inputRevision > 0 && event.inputRevision === state.inputRevision, 'stale_input_revision');
      next.clientSubmitted = true;
      emit('patent.intake_submitted', 'telegram_admin');
      break;
    case 'authorize_run':
      admin(actor);
      requireValue(state.clientSubmitted && state.packageHash, 'client_submission_required');
      requireValue(!state.run, 'run_already_exists');
      requireValue(event.inputRevision === state.inputRevision && event.packageHash === state.packageHash, 'stale_approval');
      next.run = { id: identifier(event.runId), phase: 'authorized', stageIndex: 0,
        authorizedBy: actor.id, executionId: null, checkpointHash: null, approvedCheckpoints: [] };
      emit('patent.analysis_authorized', 'work');
      break;
    case 'claim_stage':
      scopedAgent(state, actor);
      requireValue(state.run.phase === 'authorized', 'stage_not_authorized');
      requireValue(!state.run.executionId || state.run.executionId === actor.executionId, 'execution_already_claimed');
      requireValue(event.packageHash === state.packageHash && event.stage === STAGES[state.run.stageIndex], 'stale_execution');
      next.run.phase = 'running';
      next.run.executionId = actor.executionId;
      break;
    case 'stage_result':
      scopedAgent(state, actor);
      requireValue(state.run.phase === 'running' && state.run.executionId === actor.executionId, 'execution_not_active');
      requireValue(event.stage === STAGES[state.run.stageIndex], 'wrong_stage');
      next.run.checkpointHash = digest(event.resultHash);
      next.run.phase = 'awaiting_approval';
      emit('patent.checkpoint_ready', 'telegram_admin');
      break;
    case 'approve_stage':
      admin(actor);
      requireValue(state.run?.phase === 'awaiting_approval', 'no_checkpoint_to_approve');
      requireValue(event.runId === state.run.id && event.resultHash === state.run.checkpointHash &&
        event.inputRevision === state.inputRevision, 'stale_approval');
      next.run.approvedCheckpoints.push({ stage: STAGES[state.run.stageIndex], resultHash: state.run.checkpointHash, by: actor.id });
      next.run.checkpointHash = null;
      if (state.run.stageIndex === STAGES.length - 1) {
        next.run.phase = 'finalized';
        emit('patent.pdf_finalized', 'telegram_admin');
      } else {
        next.run.stageIndex++;
        next.run.phase = 'authorized';
        emit('patent.stage_authorized', 'work');
      }
      break;
    default:
      throw new ControlError('unsupported_command');
  }
  next.version++;
  return { state: next, effects };
}

export function canDeliverWorkEvent(event, state) {
  return event.destination === 'work' && state.run?.phase === 'authorized' &&
    event.case_id === state.caseId && event.run_id === state.run.id &&
    event.input_revision === state.inputRevision && event.package_sha256 === state.packageHash &&
    event.stage === STAGES[state.run.stageIndex];
}
