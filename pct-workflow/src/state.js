export const ORDER_VERSION = 'RV-PCT-ASSESSMENT-2026-11-v1';
export const STAGE_ONE = Object.freeze({ consultation: 11100, report_start: 55500, report_release: 44500 });
export const QUOTE_MIN = 350000;
export const QUOTE_MAX = 550000;
export const PACKAGE_DAYS = [7, 25];
export const RESPONSE_DAYS = 7;
export const FILING_CONSENT_VERSION = 'RV-PCT-FILING-AUTH-v1';
export const FILING_CONSENT_TEXT = 'I have read the final review copy and approve the exact filing package identified below. I authorize submission of that package in ePCT by the authorized party. I understand that this confirmation locks this version in the portal; any later change requires a separate procedure.';

export const stages = Object.freeze({
  consultation_payment: 'Initial consultation payment',
  consultation_requested: 'Consultation requested',
  report_payment: 'Prior-art report payment',
  report_work: 'Prior-art report in preparation',
  report_ready: 'Report ready · unlock with final Stage 1 payment',
  idea_selection: 'Choose and describe your final invention',
  idea_review: 'Final invention under review',
  declined: 'PCT engagement declined',
  awaiting_quote: 'PCT engagement accepted · quote in preparation',
  quote_ready: 'PCT agreement and quote ready',
  agreement_review: 'Signed PCT agreement under review',
  pct_deposit: 'PCT start payment',
  pct_intake: 'Filing information and ePCT access',
  pct_start_pending: 'Filing preparation queued',
  pct_drafting: 'Preparing PCT draft',
  pct_draft_review: 'Word draft ready for your review',
  pct_draft_revision: 'Revising the draft from your comments',
  pct_finalizing: 'Draft approved · preparing final filing package',
  pct_package_ready: 'Final package ready · settle the filing invoice',
  pct_filing_consent: 'Final authorization required for ePCT submission',
  pct_authorized: 'Authorized for filing · submission pending',
  pct_submitting: 'Submitting in ePCT',
  isa_wait: 'Filed · awaiting International Searching Authority',
  pct_response: 'Response or amendments in preparation',
  publication_wait: 'Awaiting official publication scheduling',
  completion_due: 'Services complete · final payment due',
  completed: 'Services complete · settled',
  closed_by_agreement: 'Closed by agreement · settled',
});

export const labels = Object.freeze({
  consultation: 'Initial review and consultation',
  report_start: 'Specialist prior-art report · start',
  report_release: 'Prior-art report · PDF password and Word file',
  pct_start: 'PCT services · start',
  pct_ready: 'PCT services · filing package ready',
  pct_completion: 'PCT services · completion fee',
});

export class RuleError extends Error {
  constructor(message, status = 409, code = 'invalid_stage') { super(message); this.status = status; this.code = code; }
}

export function ensure(condition, message, status, code) {
  if (!condition) throw new RuleError(message, status, code);
}

export function quoteBreakdown(total) {
  ensure(Number.isSafeInteger(total) && total >= QUOTE_MIN && total <= QUOTE_MAX,
    'Enter a PCT service price from US$3,500 to US$5,500.', 422, 'invalid_quote');
  const completion = Math.min(Math.round(total * 15 / 100), 75000);
  const base = total - completion;
  const start = Math.round(base * 40 / 100);
  return { total, start, ready: base - start, completion, currency: 'USD' };
}

const NEXT_PAYMENT = {
  consultation: ['consultation_payment', 'consultation_requested'],
  report_start: ['report_payment', 'report_work'],
  report_release: ['report_ready', 'idea_selection'],
  pct_start: ['pct_deposit', 'pct_intake'],
  pct_ready: ['pct_package_ready', 'pct_filing_consent'],
  pct_completion: ['completion_due', 'completed'],
};

export function invoice(s, key, amount, at) {
  ensure(!s.invoices[key], 'This invoice already exists.');
  s.invoices[key] = { key, label: labels[key], amount_cents: amount, currency: 'USD',
    status: 'issued', issued_at: at, ...(Object.hasOwn(STAGE_ONE, key) ? { non_refundable: true } : {}) };
}

export function initialState({ title, name, country, undertaking, at }) {
  const s = { title, name, country, undertaking, order_version: ORDER_VERSION, stage: 'consultation_payment',
    invoices: {}, documents: [], messages: [], report: null, idea: null, decision: null, quote: null };
  invoice(s, 'consultation', STAGE_ONE.consultation, at);
  return s;
}

function setStage(s, expected, next) {
  ensure(s.stage === expected, 'This action is not available at the current stage.');
  s.stage = next;
}

export function recordReceipt(s, key, receipt) {
  const inv = s.invoices[key];
  ensure(inv?.status === 'issued', 'This invoice is no longer open.');
  ensure(inv.receipt?.reference !== receipt.reference || inv.receipt?.method !== receipt.method,
    'This receipt is already awaiting review.');
  inv.receipt = receipt;
}

export function settle(s, key, evidence, at) {
  const inv = s.invoices[key];
  ensure(inv, 'Invoice not found.', 404, 'not_found');
  if (inv.status === 'paid') return false;
  ensure(inv.status === 'issued', 'Only an open invoice can be settled.');
  const [from, to] = NEXT_PAYMENT[key];
  setStage(s, from, to);
  inv.status = 'paid';
  inv.paid_at = at;
  inv.verification = evidence;
  if (key === 'consultation') s.meeting = { status: 'requested', requested_at: at };
  if (key === 'report_start') s.report_started_at = at;
  if (key === 'pct_completion') s.settlement = { status: 'settled', at };
  return true;
}

export function authorizeReport(s, at) {
  setStage(s, 'consultation_requested', 'report_payment');
  s.meeting = { ...s.meeting, status: 'completed', completed_at: at };
  invoice(s, 'report_start', STAGE_ONE.report_start, at);
}

export function publishReport(s, report, at) {
  setStage(s, 'report_work', 'report_ready');
  s.report = report;
  invoice(s, 'report_release', STAGE_ONE.report_release, at);
}

export function chooseIdea(s, { source, candidate, description }, at) {
  setStage(s, 'idea_selection', 'idea_review');
  ensure(source === 'original' || (source === 'team' && s.report.candidates.includes(candidate)),
    'Select your original invention or a candidate listed in your report.', 422, 'invalid_idea');
  s.idea = { source, candidate: source === 'team' ? candidate : null, description, at };
}

export function decideIdea(s, { accepted, note, rightsRef }, at) {
  ensure(typeof accepted === 'boolean', 'Choose accept or decline.', 422, 'invalid_decision');
  if (accepted && s.idea?.source === 'team') ensure(rightsRef, 'Record the separate idea-sale agreement before accepting.', 422, 'rights_required');
  setStage(s, 'idea_review', accepted ? 'awaiting_quote' : 'declined');
  s.decision = { accepted, note: note || (accepted
    ? 'Your selected invention was accepted. We will prepare your PCT service quote.'
    : 'We are unable to proceed with this PCT engagement. Your completed assessment remains available.'),
    rights_ref: accepted ? rightsRef || null : null, at };
}

export function postQuote(s, { total, id, agreement }, at) {
  ensure(['awaiting_quote', 'quote_ready'].includes(s.stage), 'This case is not open for a PCT quote.');
  s.quote = { ...quoteBreakdown(total), id, agreement, offered_at: at };
  s.stage = 'quote_ready';
}

export function acceptQuote(s, evidence, at) {
  setStage(s, 'quote_ready', 'pct_deposit');
  ensure(evidence.quote_id === s.quote.id, 'The quote changed. Review the current agreement before signing.');
  s.engagement = { ...evidence, accepted_at: at, agreement: s.quote.agreement };
  invoice(s, 'pct_start', s.quote.start, at);
}

export function submitOfflineAgreement(s, evidence, at) {
  setStage(s, 'quote_ready', 'agreement_review');
  s.agreement_review = { ...evidence, submitted_at: at };
}

export function reviewOfflineAgreement(s, accepted, note, at) {
  setStage(s, 'agreement_review', accepted ? 'pct_deposit' : 'quote_ready');
  if (accepted) {
    s.engagement = { ...s.agreement_review, accepted_at: at, agreement: s.quote.agreement };
    invoice(s, 'pct_start', s.quote.start, at);
  }
  s.agreement_review = { ...s.agreement_review, accepted, note, reviewed_at: at };
}

export function submitFilingProfile(s, profile, at) {
  setStage(s, 'pct_intake', 'pct_start_pending');
  s.filing_profile = profile;
  s.start_requested_at = at;
}

export function startDrafting(s, at) {
  setStage(s, 'pct_start_pending', 'pct_drafting');
  s.preparation_started_at = at;
}

export function publishDraft(s, doc, note, at) {
  ensure(['pct_drafting','pct_draft_revision'].includes(s.stage), 'This case is not ready for another draft.');
  s.drafts ||= [];
  ensure(s.drafts.length < 30 && !s.drafts.some(d=>d.document_id===doc.id),
    'Choose a new Word draft. Up to 30 versions may be tracked.');
  const draft = { version: (s.drafts.length + 1) + '.0', document_id: doc.id, sha256: doc.sha256, note, published_at: at };
  s.drafts.push(draft);
  s.stage='pct_draft_review';
  return draft;
}

export function draftFeedback(s, draftId, doc, note, at) {
  const draft=s.drafts?.at(-1);
  ensure(s.stage==='pct_draft_review' && draft?.document_id===draftId && doc.draft_id===draftId,
    'Attach comments to the current draft version.');
  draft.feedback={document_id:doc.id,note,submitted_at:at};
  s.stage='pct_draft_revision';
  return draft;
}

export function approveDraft(s, draftId, actor, at) {
  const draft=s.drafts?.at(-1);
  ensure(s.stage==='pct_draft_review' && draft?.document_id===draftId, 'Only the current Word draft can be approved.');
  s.draft_approval={version:draft.version,document_id:draftId,sha256:draft.sha256,actor,approved_at:at};
  s.stage='pct_finalizing';
  return draft;
}

export function requestOnlineMeeting(s, id, note, at) {
  ensure(s.engagement && !['completed','closed_by_agreement','declined','completion_due'].includes(s.stage),
    'A meeting cannot be requested at the current stage.');
  s.meeting_requests ||= [];
  ensure(s.meeting_requests.length<15 && !s.meeting_requests.some(m=>m.status==='requested'),
    'A meeting request is already open or the request limit was reached.');
  const request={id,note,status:'requested',requested_at:at,version:s.drafts?.at(-1)?.version || null};
  s.meeting_requests.push(request);
  return request;
}

export function acknowledgeMeeting(s, id, note, at) {
  const item=s.meeting_requests?.find(m=>m.id===id && m.status==='requested');
  ensure(item,'This meeting request is not open.');
  Object.assign(item,{status:'acknowledged',note_to_client:note,acknowledged_at:at});
}

export function packageReady(s, ready, at) {
  ensure(s.draft_approval, 'The client must first approve the current draft.');
  setStage(s, 'pct_finalizing', 'pct_package_ready');
  s.package = { ...ready, ready_at: at };
  invoice(s, 'pct_ready', s.quote.ready, at);
}

export function authorizeFiling(s, evidence, at) {
  ensure(s.invoices.pct_ready?.status==='paid' && s.package?.final_sha256===evidence.final_sha256,
    'Settle the filing invoice and review the current final package first.');
  setStage(s, 'pct_filing_consent', 'pct_authorized');
  s.filing_consent={...evidence,accepted_at:at};
}

export function startSubmission(s, access, actor, at) {
  ensure(s.filing_consent && access.official_access && access.authorization_on_file,
    'Confirm the authorized ePCT access and filing authority for this application.');
  setStage(s, 'pct_authorized', 'pct_submitting');
  s.submission={...access,started_at:at,actor};
}

export function markFiled(s, filing, at) {
  ensure(s.filing_consent && s.submission?.official_access && s.invoices.pct_ready?.status === 'paid' &&
    filing.fees_confirmed && filing.receipt_ids.length,
    'Verified settlement, ePCT authorization, official fees and a submission receipt are required.');
  setStage(s, 'pct_submitting', 'isa_wait');
  s.filing = { ...filing, recorded_at: at };
}

export function recordIsa(s, result, at) {
  setStage(s, 'isa_wait', result.response_needed ? 'pct_response' : 'publication_wait');
  s.isa = { ...result, received_at: at };
}

export function recordResponse(s, result, at) {
  setStage(s, 'pct_response', 'publication_wait');
  s.response = { ...result, completed_at: at };
}

export function markComplete(s, official, at) {
  setStage(s, 'publication_wait', 'completion_due');
  s.completion = { ...official, completed_at: at };
  invoice(s, 'pct_completion', s.quote.completion, at);
}

export const canWaiveCompletion = s => Boolean(s.quote && s.engagement && s.invoices.pct_start?.status === 'paid' &&
  (!s.invoices.pct_ready || s.invoices.pct_ready.status === 'paid') &&
  (!s.invoices.pct_completion || s.invoices.pct_completion.status === 'issued') &&
  !['completed', 'closed_by_agreement'].includes(s.stage));

export function waiveCompletion(s, reason, at) {
  ensure(s.quote && s.engagement && s.invoices.pct_start?.status === 'paid' &&
    (!s.invoices.pct_ready || s.invoices.pct_ready.status === 'paid'),
  'Close any other outstanding PCT invoices before waiving the completion fee.');
  ensure(!['completed', 'closed_by_agreement'].includes(s.stage), 'This case is already settled.');
  ensure(!s.invoices.pct_completion || s.invoices.pct_completion.status === 'issued',
    'A paid completion fee cannot be waived.');
  if (!s.invoices.pct_completion) invoice(s, 'pct_completion', s.quote.completion, at);
  s.invoices.pct_completion.status = 'waived';
  s.invoices.pct_completion.waived_at = at;
  s.settlement = { status: 'waived', at, reason };
  s.stage = 'closed_by_agreement';
}

export const outstandingCompletion = s => s.invoices.pct_completion?.status === 'issued';
export const reportReleased = s => s.invoices.report_release?.status === 'paid';
export const packageReleased = s => s.invoices.pct_ready?.status === 'paid' && Boolean(s.filing_consent && s.filing_consent.final_sha256===s.package?.final_sha256);
