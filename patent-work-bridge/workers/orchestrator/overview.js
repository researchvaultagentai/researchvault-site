import { identifier, requireValue } from '../../src/contracts.js';
import { STAGES } from '../../src/workflow.js';

const PHASES = new Set(['authorized', 'running', 'awaiting_approval', 'finalized']);
const CLOSED = new Set(['completed', 'withdrawn']);

function timestamp(...values) {
  const times = values.map(value => typeof value === 'number' ? value * 1000 : Date.parse(value || ''))
    .filter(value => Number.isFinite(value) && value > 0);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function status(row) {
  let state = null, invalid = false;
  if (row.state_json !== null) {
    try {
      state = JSON.parse(row.state_json);
      requireValue(state?.caseId === row.case_id && Number.isSafeInteger(state.inputRevision)
        && state.inputRevision >= 0 && Number.isSafeInteger(state.version) && state.version >= 0,
      'invalid_overview_state');
    } catch { invalid = true; state = null; }
  }
  let phase = invalid ? 'workflow_unknown' : !state ? 'portal_only'
    : !state.clientSubmitted ? 'awaiting_submission' : state.run?.phase || 'awaiting_admin';
  if (state?.run && (!PHASES.has(phase) || !Number.isSafeInteger(state.run.stageIndex)
      || state.run.stageIndex < 0 || state.run.stageIndex >= STAGES.length)) phase = 'workflow_unknown';
  const stage = state?.run && phase !== 'workflow_unknown' ? STAGES[state.run.stageIndex] : null;
  const actions = {
    portal_only: 'connect_intake', awaiting_submission: 'confirm_documents',
    awaiting_admin: 'admin_review', authorized: 'start_authorized_stage',
    running: 'stage_in_progress', awaiting_approval: 'approve_stage',
    finalized: 'analysis_finalized', workflow_unknown: 'check_workflow',
  };
  let nextAction = actions[phase];
  if (row.case_stage === 'suspended') nextAction = 'review_suspension';
  if (CLOSED.has(row.case_stage)) nextAction = state?.run && phase !== 'finalized'
    ? 'check_status_mismatch' : 'case_closed';
  return {
    case_id: row.case_id,
    public_ref: row.public_ref || null,
    title: typeof row.title === 'string' ? row.title.slice(0, 160) : null,
    case_stage: row.case_stage || null,
    report_language: ['en', 'fa'].includes(state?.reportLanguage) ? state.reportLanguage : null,
    input_revision: state?.inputRevision ?? 0,
    state_version: state?.version ?? null,
    phase, stage, next_action: nextAction,
    updated_at: timestamp(row.updated_at, row.work_updated_at),
  };
}

// A read-only inventory, deliberately separate from AdminControl's actionable
// submitted-work queue. Merely listing a portal case must never submit or run it.
export async function readPatentOverview(db, { afterCaseId = '', limit = 25 } = {}) {
  requireValue(db?.prepare, 'patent_database_required');
  requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 50, 'invalid_batch_size');
  if (afterCaseId) identifier(afterCaseId);
  const { results } = await db.prepare(`WITH case_ids AS (
      SELECT id AS case_id FROM patent_cases
      UNION SELECT case_id FROM patent_work_bridge_state
    ), page AS (
      SELECT case_id FROM case_ids WHERE case_id > ? ORDER BY case_id LIMIT ?
    )
    SELECT page.case_id, c.public_ref, c.title, c.case_stage, c.updated_at,
      b.state_json,
      (SELECT MAX(created_at) FROM patent_work_bridge_commands command
        WHERE command.case_id = page.case_id) AS work_updated_at
    FROM page
    LEFT JOIN patent_cases c ON c.id = page.case_id
    LEFT JOIN patent_work_bridge_state b ON b.case_id = page.case_id
    ORDER BY page.case_id`).bind(afterCaseId, limit + 1).all();
  const total = await db.prepare(`SELECT COUNT(*) AS total FROM (
    SELECT id FROM patent_cases UNION SELECT case_id FROM patent_work_bridge_state
  )`).first();
  const cases = results.slice(0, limit).map(status);
  return { cases, total_cases: Number(total.total), scope: 'all_cases',
    next_after_case_id: results.length > limit ? cases.at(-1).case_id : null };
}
