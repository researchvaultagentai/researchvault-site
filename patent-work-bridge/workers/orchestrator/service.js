import { D1WorkStore } from '../../src/d1-store.js';
import { identifier, requireValue, sha256 } from '../../src/contracts.js';
import { STAGES } from '../../src/workflow.js';

function storeFor(env) {
  requireValue(env.PATENT_DB?.prepare, 'patent_database_required');
  return new D1WorkStore(env.PATENT_DB);
}

function adminActor(env, adminId) {
  identifier(adminId);
  const allowed = String(env.PATENT_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  requireValue(allowed.includes(adminId), 'admin_required');
  // A trusted authenticated bot/portal adapter supplies the subject. This
  // entrypoint must never be bound directly to model tools or a public route.
  return { role: 'admin', id: adminId };
}

export function createPatentOrchestrator(env, { now = Date.now, leaseId = () => crypto.randomUUID() } = {}) {
  return {
    async health() {
      const results = await Promise.allSettled([
        env.PATENT_WORK?.health(), env.PATENT_NOTIFY?.health(), env.SUPPORT_AI?.health(),
      ]);
      return { service: 'researchvault-patent-orchestrator',
        database_binding: Boolean(env.PATENT_DB?.prepare),
        outbox_enabled: env.PATENT_OUTBOX_ENABLED === 'true',
        work: results[0].status === 'fulfilled' ? results[0].value ?? null : null,
        notifications: results[1].status === 'fulfilled' ? results[1].value ?? null : null,
        support: results[2].status === 'fulfilled' ? results[2].value ?? null : null };
    },

    async prepare(input) {
      requireValue(env.PATENT_WORK?.prepare, 'patent_work_binding_required');
      // Returns to the trusted portal adapter for PRIVATE immutable storage.
      // No full document or master prompt is stored in the delivery outbox.
      return env.PATENT_WORK.prepare(input);
    },

    async drain({ limit = 10 } = {}) {
      requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 10, 'invalid_batch_size');
      if (env.PATENT_OUTBOX_ENABLED !== 'true') return { enabled: false, sent: 0, dropped: 0, deferred: 0 };
      const store = storeFor(env);
      const totals = { enabled: true, sent: 0, dropped: 0, deferred: 0 };
      for (const event of await store.pending(limit, now())) {
        const lease = identifier(leaseId());
        if (!await store.claimDelivery(event.id, lease, now())) continue;
        try {
          if (!await store.eligible(event)) {
            await store.finishDelivery(event.id, lease, 'dropped'); totals.dropped++; continue;
          }
          let result;
          if (event.destination === 'work') {
            requireValue(env.PATENT_WORK?.wake, 'patent_work_binding_required');
            result = await env.PATENT_WORK.wake(event);
          } else {
            requireValue(env.PATENT_NOTIFY?.notify, 'patent_notify_binding_required');
            result = await env.PATENT_NOTIFY.notify(event);
          }
          if (result?.status === 'sent') {
            await store.finishDelivery(event.id, lease, 'sent'); totals.sent++;
          } else {
            const code = /^[a-z0-9_]{1,80}$/.test(result?.code || '') ? result.code : 'delivery_not_confirmed';
            await store.deferDelivery(event.id, lease, code, now() + 300000); totals.deferred++;
          }
        } catch {
          // Do not log raw provider errors: they can contain a bot token/URL.
          await store.deferDelivery(event.id, lease, 'delivery_failed', now() + 300000); totals.deferred++;
        }
      }
      return totals;
    },
  };
}

export function createPatentClientControl(env) {
  return {
    async submit({ caseId, ownerId, reportLanguage, packageHash, commandId, expectedVersion }) {
      identifier(commandId);
      const store = storeFor(env);
      // Trusted intake adapter has already verified session ownership, NDA,
      // manifest completion, byte validation and privately persisted this hash.
      await store.initialize({ caseId, ownerId, reportLanguage });
      const actor = { role: 'client', id: identifier(ownerId) };
      const prepared = await store.execute({ caseId, commandId: await sha256(`${commandId}:inputs`),
        expectedVersion, actor, event: { type: 'inputs_changed', packageHash, reportLanguage } });
      return store.execute({ caseId, commandId: await sha256(`${commandId}:submit`),
        expectedVersion: prepared.state.version, actor,
        event: { type: 'client_submitted', inputRevision: prepared.state.inputRevision } });
    },
  };
}

export function createPatentAdminControl(env) {
  return {
    async queue({ adminId, afterCaseId = '', limit = 25 }) {
      adminActor(env, adminId);
      requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 50, 'invalid_batch_size');
      if (afterCaseId) identifier(afterCaseId);
      const result = await env.PATENT_DB.prepare(`SELECT case_id, state_json FROM patent_work_bridge_state
        WHERE case_id > ? AND json_extract(state_json, '$.clientSubmitted') = 1
        AND COALESCE(json_extract(state_json, '$.run.phase'), '') != 'finalized'
        ORDER BY case_id LIMIT ?`).bind(afterCaseId, limit).all();
      const cases = result.results.map(row => {
        const state = JSON.parse(row.state_json);
        return { case_id: state.caseId, report_language: state.reportLanguage, input_revision: state.inputRevision,
          state_version: state.version, package_sha256: state.packageHash,
          run_id: state.run?.id || null, phase: state.run?.phase || 'awaiting_admin',
          stage: state.run ? STAGES[state.run.stageIndex] || null : null,
          checkpoint_sha256: state.run?.checkpointHash || null };
      });
      return { cases, next_after_case_id: cases.length === limit ? cases.at(-1).case_id : null };
    },
    async authorizeRun({ adminId, caseId, commandId, expectedVersion, runId, inputRevision, packageHash }) {
      const actor = adminActor(env, adminId);
      return storeFor(env).execute({ caseId, commandId, expectedVersion, actor,
        event: { type: 'authorize_run', runId, inputRevision, packageHash } });
    },
    async approveStage({ adminId, caseId, commandId, expectedVersion, runId, inputRevision, resultHash }) {
      const actor = adminActor(env, adminId);
      return storeFor(env).execute({ caseId, commandId, expectedVersion, actor,
        event: { type: 'approve_stage', runId, inputRevision, resultHash } });
    },
  };
}

// Bind this role to the Telegram queue viewer. It has no approval, execution,
// document, payment or password method; the administrator allowlist still applies.
export function createPatentQueueView(env) {
  return {
    async queue(input) {
      const result = await createPatentAdminControl(env).queue(input);
      return {
        cases: result.cases.map(item => ({
          case_id: item.case_id,
          report_language: item.report_language,
          input_revision: item.input_revision,
          state_version: item.state_version,
          phase: item.phase,
          stage: item.stage,
        })),
        next_after_case_id: result.next_after_case_id,
      };
    },
  };
}
