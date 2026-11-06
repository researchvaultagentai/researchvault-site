export const UPDATE_WINDOW = 72 * 60 * 60;
export const NOTICE_LEAD = 24 * 60 * 60;

const terminal = new Set(['completed', 'closed_by_agreement', 'declined', 'wipe_pending']);

export function pendingTeamUpdates(s) {
  if (terminal.has(s.stage)) return [];
  const work = [];
  const add = (kind, opened, identity = '', renew = false) => {
    if (!Number.isSafeInteger(opened) || opened <= 0) return;
    const taskKey = `${kind}:${identity}:${opened}`;
    const progressAt = renew && Number.isSafeInteger(s.team_update_at) ? Math.max(opened, s.team_update_at) : opened;
    const extensionAt = s.team_update_extensions?.[taskKey];
    const at = Number.isSafeInteger(extensionAt) ? Math.max(progressAt, extensionAt) : progressAt;
    work.push({ key: `${taskKey}:${at}`, task_key: taskKey, kind, started_at: at, due_at: at + UPDATE_WINDOW });
  };
  const draft = s.drafts?.at(-1);
  switch (s.stage) {
    case 'consultation_requested': add('consultation', s.meeting?.requested_at, '', true); break;
    case 'report_work': add('prior_art', s.report_started_at, '', true); break;
    case 'idea_review': add('invention', s.idea?.at, '', true); break;
    case 'awaiting_quote': add('quote', s.decision?.at, '', true); break;
    case 'agreement_review': add('agreement', s.agreement_review?.submitted_at, '', true); break;
    case 'pct_start_pending':
    case 'pct_drafting': add('draft', s.start_requested_at || s.preparation_started_at, '', true); break;
    case 'pct_draft_revision': add('revision', draft?.feedback?.submitted_at, draft?.version, true); break;
    case 'pct_finalizing': add('package', s.draft_approval?.approved_at, s.draft_approval?.version, true); break;
    case 'pct_authorized':
    case 'pct_submitting': add('filing', s.filing_consent?.accepted_at, '', true); break;
    case 'pct_response': add('isa_response', s.isa?.received_at, '', true); break;
  }
  for (const invoice of Object.values(s.invoices || {})) {
    if (invoice.status === 'issued' && invoice.receipt) {
      add('receipt', invoice.receipt.review_since || invoice.receipt.submitted_at, invoice.key);
    }
  }
  for (const request of s.meeting_requests || []) {
    if (request.status === 'requested') add('meeting', request.requested_at, request.id);
  }
  // Group messages sent before a team reply. A second message does not move the target.
  const messages = s.messages || [];
  const lastReply = messages.findLastIndex(m => m.actor === 'team');
  const first = messages.findIndex((m, i) => i > lastReply && m.actor === 'client');
  if (first >= 0) add('message', messages[first].at, first);
  return work.sort((a,b) => a.due_at - b.due_at || a.key.localeCompare(b.key));
}

export const clientTeamUpdates = s => pendingTeamUpdates(s).map(({key, task_key, ...item}) => item);

export function applyTeamUpdateExtension(s, task, at) {
  s.team_update_extensions = { ...s.team_update_extensions, [task.task_key]: at };
  return at + UPDATE_WINDOW;
}
