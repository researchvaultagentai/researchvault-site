import { requireValue, identifier, sha256 } from './contracts.js';
import { STAGES } from './workflow.js';

// Transport-independent handlers for a future authenticated MCP server.
// principal comes from OAuth + server-side case/run mapping, never tool arguments.
// loadPackage and verifyCheckpoint must read private, immutable server records.
export function createWorkTools({ store, loadPackage, verifyCheckpoint }) {
  async function context(principal) {
    requireValue(principal?.role === 'agent', 'agent_required');
    identifier(principal.caseId); identifier(principal.runId); identifier(principal.executionId);
    const state = await store.read(principal.caseId);
    requireValue(state.run?.id === principal.runId && state.run.phase !== 'finalized', 'case_run_scope_required');
    requireValue(!state.run.executionId || state.run.executionId === principal.executionId, 'execution_already_claimed');
    return state;
  }

  return {
    async getPacket(principal) {
      const state = await context(principal);
      const packet = await loadPackage({ caseId: state.caseId, packageHash: state.packageHash });
      requireValue(packet.case_id === state.caseId && await sha256(packet) === state.packageHash, 'package_integrity_failure');
      return { packet, state_version: state.version, input_revision: state.inputRevision,
        stage: STAGES[state.run.stageIndex], phase: state.run.phase };
    },

    async claimStage(principal, { commandId, expectedVersion, stage, packageHash }) {
      const state = await context(principal);
      return store.execute({ caseId: state.caseId, commandId, expectedVersion, actor: principal,
        event: { type: 'claim_stage', stage, packageHash } });
    },

    async submitCheckpoint(principal, { commandId, expectedVersion, stage, artifactId }) {
      const state = await context(principal);
      // Allow an identical command to be replayed if its response was lost while
      // waiting for the human. New commands still fail the store's state gate.
      requireValue(['running', 'awaiting_approval'].includes(state.run.phase) &&
        stage === STAGES[state.run.stageIndex], 'execution_not_active');
      identifier(artifactId);
      // Return a digest only after the trusted adapter verifies case/run binding,
      // immutable artifact bytes and stage-specific checks. A model's QC claim
      // or claimed hash is not an attestation.
      const resultHash = await verifyCheckpoint({ caseId: state.caseId, runId: state.run.id,
        packageHash: state.packageHash, stage, artifactId });
      return store.execute({ caseId: state.caseId, commandId, expectedVersion, actor: principal,
        event: { type: 'stage_result', stage, resultHash } });
    },
  };
}
