import { error, json, nowSec, sanitizeText, sha256Hex, uid } from '../../patent-api/src/security.js';
import * as S from './state.js';
import * as D from './repository.js';
import * as F from './files.js';
import * as A from './agreement.js';
import { accountForEmail, authRoute, localSession } from './accounts.js';
import { deliverPctNotices, notificationTarget } from './notifications.js';

const PRODUCTION_ORIGIN = 'https://researchvault-patent.pages.dev';
const INTERNAL = 'https://pct-internal.invalid';
const ID = /^pct_[a-f0-9]{24}$/;
const DOC_ID = /^doc_[a-f0-9]{32}$/;
const ADMIN_ACTIONS = new Set(['authorize_report', 'decide_idea', 'quote', 'waive_completion', 'start_drafting', 'start_submission']);
const APP_NUMBER = /^PCT\/[A-Z]{2}\d{4}\/\d{6}$/;

function testMode(env) {
  return env.ENVIRONMENT === 'test' && env.PCT_ISOLATED_TEST === 'true' && Boolean(env.PCT_STORE) &&
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(env.PCT_ORIGIN || '');
}

const fail = (message, status, code) => S.ensure(false, message, status, code);
const clean = (x, n) => typeof x === 'string' ? sanitizeText(x, n) : '';
function bounded(x, label, min, max) {
  const value = clean(x, max + 1);
  S.ensure(value.length >= min && value.length <= max, `${label} must contain ${min}–${max} characters.`, 422, 'invalid_field');
  return value;
}

async function input(req) {
  const raw = await req.text();
  S.ensure(raw.length <= 24000, 'The form is too large.', 413, 'request_too_large');
  let value;
  try { value = JSON.parse(raw); } catch { fail('Invalid JSON form.', 422, 'invalid_form'); }
  S.ensure(value && typeof value === 'object' && !Array.isArray(value), 'Invalid JSON form.', 422, 'invalid_form');
  return value;
}

function storageReady(env) {
  return /^[a-f0-9]{64}$/i.test(env.PCT_FILE_KEY || '') &&
    (Boolean(env.PCT_STORE) || Boolean(env.B2_KEY_ID && env.B2_APPLICATION_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME));
}

function configured(env) {
  const isolated = testMode(env);
  if (!isolated && (env.ENVIRONMENT !== 'production' || env.PCT_ENABLED !== 'true' || env.PCT_ISOLATED_TEST === 'true')) return false;
  if (!env.PCT_DB || !env.PATENT_API?.fetch || !storageReady(env)) return false;
  try {
    const docs = [F.legalVersion(env, 'undertaking'), F.legalVersion(env, 'agreement')];
    const sample = /(?:^|[./_-])(?:test|sample|demo|fixture)(?:$|[./_-])/i;
    return isolated || !docs.some(doc => sample.test(doc.key) || sample.test(doc.version));
  } catch { return false; }
}

async function upstream(req, env, path, body) {
  const headers = new Headers();
  for (const key of ['cookie', 'cf-connecting-ip', 'user-agent']) {
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  }
  if (body) headers.set('content-type', 'application/json');
  return env.PATENT_API.fetch(new Request(new URL(path, req.url), {
    method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}

async function account(req, env, admin = false) {
  if (!admin) {
    const pct = await localSession(req,env);
    if (pct) return pct;
  }
  S.ensure(req.headers.get('cookie'), 'Sign in with your verified email to continue.', 401, 'unauthorized');
  const r = await upstream(req, env, '/api/me');
  const value = await r.json().catch(() => null);
  S.ensure(r.ok && value?.user?.id && value.user.email, 'Sign in with your verified email to continue.', 401, 'unauthorized');
  if (admin) S.ensure(value.user.is_admin === true, 'Administrator access required.', 403, 'forbidden');
  if(admin) return value.user;
  const profile=await accountForEmail(env,value.user.email,value.user.id);
  return {id:profile.id,email:profile.email,is_admin:value.user.is_admin===true};
}

function caseSummary(row) {
  const s = row.state;
  return { id: row.id, public_ref: row.public_ref, stage: s.stage,
    stage_label: S.stages[s.stage], title: s.title, updated_at: row.updated_at };
}

function invoiceView(i, admin) {
  const { verification, receipt, ...safe } = i;
  return { ...safe, receipt_pending: i.status === 'issued' && Boolean(receipt), ...(admin && receipt ? { receipt } : {}) };
}

async function caseView(env, row, admin = false) {
  const s = row.state, password = s.report && S.reportReleased(s) && !admin
    ? await F.readPassword(env, s.documents.find(d => d.id === s.report.pdf_id)) : null;
  const showFinal = S.packageReleased(s);
  return {
    ...caseSummary(row), revision: row.revision, invoices: Object.values(s.invoices).map(i => invoiceView(i, admin)),
    documents: s.documents.filter(d => F.mayDownload(s, d, admin)).map(F.documentView),
    meeting: s.meeting, report: s.report ? {
      pdf_id: s.report.pdf_id, ...(password ? { password, word_id: s.report.word_id, candidates: s.report.candidates } : {}),
    } : null,
    idea: s.idea, decision: s.decision ? { accepted: s.decision.accepted, note: s.decision.note,
      ...(admin ? { rights_ref: s.decision.rights_ref } : {}) } : null,
    quote: s.quote ? { ...s.quote, agreement: F.legalView(s.quote.agreement) } : null,
    engagement: s.engagement ? { accepted_at: s.engagement.accepted_at, signer: s.engagement.signer,
      schedule_sha256: s.engagement.schedule_sha256, mode: s.engagement.mode, document_id: s.engagement.document_id,
      execution_sha256: s.engagement.execution_sha256 } : null,
    agreement_review: s.agreement_review ? { accepted: s.agreement_review.accepted, note: s.agreement_review.note,
      document_id: s.agreement_review.document_id } : null,
    drafts: s.drafts || [], draft_approval: s.draft_approval, meeting_requests: s.meeting_requests || [],
    filing_consent: s.filing_consent ? { version:s.filing_consent.version, signed_at:s.filing_consent.accepted_at,
      signer:s.filing_consent.signer, sha256:s.filing_consent.consent_sha256 } : null,
    submission: s.submission ? { started_at:s.submission.started_at } : null,
    filing: s.filing, filing_profile: s.filing_profile, isa: s.isa, response: s.response, completion: s.completion,
    package: s.package ? { review_id: s.package.review_id,
      ready_at: s.package.ready_at, ...((admin || showFinal) ? { final_id: s.package.final_id } : {}) } : null,
    settlement: s.settlement, messages: s.messages, preparation_started_at: s.preparation_started_at,
    events: await D.timeline(env.PCT_DB, row.id),
    ...(admin ? { client: { name: s.name, country: s.country }, test_mode: testMode(env) } : {}),
  };
}

function findDoc(s, id, category) {
  const doc = s.documents.find(d => d.id === id && d.category === category);
  S.ensure(doc, 'Choose the correct document uploaded to this case.', 422, 'wrong_document');
  return doc;
}

function legalSchedule(row) {
  const q = row.state.quote;
  return { case_ref: row.public_ref, quote_id: q.id, currency: q.currency, total: q.total,
    start: q.start, ready: q.ready, completion: q.completion, agreement_sha256: q.agreement.sha256,
    preparation_days: S.PACKAGE_DAYS, response_days: S.RESPONSE_DAYS,
    completion_trigger: 'Agreed services completed and official notice confirming scheduled publication available.' };
}

async function verifySigningCode(req,env,user,b) {
  const challenge = clean(b.challenge_id, 100), code = clean(b.code, 6);
  S.ensure(/^[a-zA-Z0-9_-]{8,100}$/.test(challenge) && /^\d{6}$/.test(code),
    'Verify your email with a new one-time code.', 422, 'otp_required');
  S.ensure(!await env.PCT_DB.prepare('SELECT 1 FROM pct_signature_challenges WHERE challenge_id=?').bind(challenge).first(),
    'This verification code has already been used.',409,'otp_reused');
  const verified = await upstream(req, env, '/api/auth/verify-otp', { challenge_id: challenge, code });
  const v = await verified.json().catch(() => null);
  S.ensure(verified.ok && v?.user?.id && v.user.email === user.email,
    'The one-time code must verify your signed-in email.', 403, 'otp_required');
  return challenge;
}

async function filingConsent(row) {
  const s=row.state,pkg=s.package;
  S.ensure(pkg && s.draft_approval && s.invoices.pct_ready?.status==='paid',
    'The filing invoice must be confirmed before final authorization.');
  const f=findDoc(s,pkg.final_id,'package_final');
  const record={version:S.FILING_CONSENT_VERSION,case_ref:row.public_ref,draft_version:s.draft_approval.version,
    draft_sha256:s.draft_approval.sha256,review_id:pkg.review_id,review_sha256:pkg.review_sha256,
    final_id:f.id,final_name:f.name,final_sha256:f.sha256,text:S.FILING_CONSENT_TEXT};
  return {...record,consent_sha256:await sha256Hex(JSON.stringify(record))};
}

async function acceptEngagement(req, env, row, user, b) {
  const q = row.state.quote;
  S.ensure(row.stage === 'quote_ready' && q?.id === b.quote_id && b.accepted === true,
    'Review and accept the current quote and agreement.');
  const signer = bounded(b.signer, 'Signer name', 2, 180);
  const scheduleHash = await sha256Hex(JSON.stringify(legalSchedule(row)));
  S.ensure(scheduleHash === b.schedule_sha256, 'The reviewed payment schedule does not match.');
  const party = {
    name: bounded(b.legal_name, 'Client legal name', 2, 180),
    role: bounded(b.role, 'Signing capacity', 2, 120),
    address: bounded(b.address, 'Postal address and country', 5, 800),
    email: user.email, registration: clean(b.registration, 160) || null,
  };
  const doc=b.document_id ? findDoc(row.state,b.document_id,'signed_agreement') : null;
  if(doc) S.ensure(doc.quote_id===q.id,'Upload the signed copy of the current offer.');
  else await A.verifyAgreementTemplate(env,q.agreement);
  const challenge=await verifySigningCode(req,env,user,b);
  const at = nowSec(), evidence = { quote_id: q.id, signer, party, verified_email: user.email,
    otp_challenge_id: challenge, schedule_sha256: scheduleHash };
  if (doc) {
    S.submitOfflineAgreement(row.state, { ...evidence, mode: 'upload', document_id: doc.id }, at);
  } else {
    const execution_sha256 = await sha256Hex(JSON.stringify({ ...evidence, at }));
    S.acceptQuote(row.state, { ...evidence, execution_sha256, mode: 'electronic' }, at);
  }
}

function filingProfile(b) {
  S.ensure(['applicant','inventor_applicant','authorized_representative'].includes(b.role) &&
    ['existing','needs_guidance'].includes(b.epct_access),
  'Select your filing role and ePCT access plan.', 422, 'invalid_filing_profile');
  S.ensure(!Object.keys(b).some(k => /(?:password|secret|token|recovery|otp)/i.test(k)),
    'Do not submit ePCT login credentials.', 422, 'credentials_not_allowed');
  S.ensure(b.epct_consent===true,'Confirm that you will use official ePCT access for this case.',422,'epct_access_required');
  return { epct_consent:true, legal_name: bounded(b.legal_name, 'Legal name', 2, 180),
    address: bounded(b.address, 'Postal address', 5, 1000), postal_code: clean(b.postal_code, 32) || null,
    country: bounded(b.country, 'Country', 2, 80), role: b.role, epct_access: b.epct_access };
}

function receiptEvidence(b) {
  const method = b.method;
  S.ensure(method === 'usdt_trc20', 'Select an available payment method.', 422, 'invalid_receipt');
  const reference = clean(b.reference, 120).toLowerCase();
  S.ensure(/^[a-f0-9]{64}$/.test(reference), 'Enter the 64-character TRON transaction ID.', 422, 'invalid_receipt');
  return { method, reference, submitted_at: nowSec() };
}

function actualDate(v, past = false) {
  const text = clean(v, 12);
  const date = new Date(text + 'T00:00:00Z');
  S.ensure(/^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === text && (!past || date.getTime() <= Date.now()),
    'Enter a valid date.', 422, 'invalid_date');
  return text;
}

async function clientAction(req, env, row, user) {
  const b = await input(req), s = row.state, at = nowSec();
  let topic = b.action, detail = {}, notify = false;
  switch (b.action) {
    case 'submit_receipt':
      S.recordReceipt(s, b.milestone, receiptEvidence(b));
      detail = { milestone: b.milestone };
      notify = true;
      break;
    case 'choose_idea':
      S.chooseIdea(s, { source: b.source, candidate: clean(b.candidate, 30),
        description: bounded(b.description, 'Final invention description', 12, 8000) }, at);
      topic = 'idea_selected'; notify = true;
      break;
    case 'accept_quote':
      await acceptEngagement(req, env, row, user, b);
      topic = b.document_id ? 'signed_agreement_uploaded' : 'agreement_signed';
      detail={signature_challenge:clean(b.challenge_id,100)}; notify=true;
      break;
    case 'filing_profile':
      S.submitFilingProfile(s, filingProfile(b), at);
      topic = 'filing_start_requested'; notify = true;
      break;
    case 'draft_feedback': {
      const doc=findDoc(s,b.feedback_id,'pct_feedback');
      const draft=S.draftFeedback(s,b.draft_id,doc,clean(b.note,1000),at);
      detail={version:draft.version}; notify=true;
      break;
    }
    case 'approve_draft': {
      S.ensure(b.confirmed===true,'Confirm that this draft is ready for final preparation.',422,'confirmation_required');
      const draft=S.approveDraft(s,b.draft_id,user.id,at);
      topic='draft_approved';detail={version:draft.version};notify=true;
      break;
    }
    case 'request_meeting': {
      const meeting=S.requestOnlineMeeting(s,uid('meet'),clean(b.note,1000),at);
      topic='online_meeting_requested';detail={version:meeting.version};notify=true;
      break;
    }
    case 'authorize_filing': {
      S.ensure(s.stage==='pct_filing_consent' && b.accepted===true,
        'Confirm the final filing authorization after payment.',409,'authorization_required');
      const consent=await filingConsent(row);
      S.ensure(b.consent_sha256===consent.consent_sha256 && b.final_sha256===consent.final_sha256,
        'Review the current exact filing package before giving authorization.',409,'consent_version_changed');
      const signer=bounded(b.signer,'Signer name',2,180);
      const challenge=await verifySigningCode(req,env,user,b);
      S.authorizeFiling(s,{...consent,signer,verified_email:user.email,otp_challenge_id:challenge},nowSec());
      topic='filing_authorized';detail={signature_challenge:challenge,version:consent.draft_version};notify=true;
      break;
    }
    case 'message':
      S.ensure(s.undertaking && s.messages.length < 50, 'This case cannot receive another message.');
      s.messages.push({ body: bounded(b.body, 'Message', 2, 2000), actor: 'client', at });
      topic = 'client_message'; notify = true;
      break;
    default: fail('Unknown case action.', 404, 'not_found');
  }
  try { return await D.save(env.PCT_DB,row,user.id,topic,detail,notify); }
  catch(e) {
    if(/UNIQUE constraint failed: pct_signature_challenges/.test(e?.message || ''))fail('This verification code has already been used.',409,'otp_reused');
    throw e;
  }
}

async function adminAction(env, row, actor, b, fromBot = false) {
  const s = row.state, at = nowSec();
  let event = b.action, details = {}, notify = false;
  if (fromBot) S.ensure(ADMIN_ACTIONS.has(b.action), 'Use the private case console for this action.', 403, 'forbidden');
  switch (b.action) {
    case 'authorize_report':
      S.ensure(b.meeting_completed === true, 'Confirm the consultation is complete.');
      S.authorizeReport(s, at);
      event = 'report_authorized';
      break;
    case 'decide_idea':
      S.decideIdea(s, { accepted: b.accepted, note: clean(b.note, 1500), rightsRef: clean(b.rights_ref, 200) }, at);
      event = b.accepted ? 'idea_accepted' : 'idea_declined';
      break;
    case 'quote': {
      S.ensure(Number.isInteger(b.revision) && b.revision === row.revision,
        'Refresh and review the current case before sending a quote.');
      const agreement = F.legalVersion(env, 'agreement');
      await A.verifyAgreementTemplate(env, agreement);
      S.postQuote(s, { total: b.total_cents, id: uid('quote'), agreement }, at);
      event = 'quote_offered';
      break;
    }
    case 'simulate_payment':
    case 'verify_payment': {
      const simulate = b.action === 'simulate_payment';
      if (simulate) S.ensure(testMode(env), 'Payment simulation is disabled.', 403, 'simulation_disabled');
      const inv = Object.hasOwn(S.labels, b.milestone) ? s.invoices[b.milestone] : null;
      S.ensure(inv, 'Invoice not found.', 404, 'not_found');
      if (inv.status === 'paid') return row;
      const receipt = inv.receipt;
      if (!simulate) S.ensure(b.verified === true && receipt && b.reference === receipt.reference &&
        b.amount_cents === inv.amount_cents, 'Confirm the actual deposit, receipt reference and exact invoiced amount.',
        422, 'payment_evidence_required');
      const key = simulate ? null : await sha256Hex(receipt.method + ':' + receipt.reference);
      if (key) {
        const exists = await env.PCT_DB.prepare('SELECT 1 FROM pct_verified_payment_refs WHERE evidence_key=?').bind(key).first();
        S.ensure(!exists, 'This transaction already settled another invoice.', 409, 'duplicate_payment');
      }
      S.settle(s, b.milestone, simulate ? { mode: 'simulation', actor } :
        { mode: 'verified_manually', actor, reference: receipt.reference, method: receipt.method }, at);
      event = b.milestone === 'consultation' ? 'consultation_requested' : 'payment_confirmed';
      details = { milestone: b.milestone, amount_cents: inv.amount_cents, payment_evidence_key: key, simulated: simulate };
      notify = true;
      break;
    }
    case 'review_agreement':
      S.ensure(typeof b.accepted === 'boolean', 'Select approve or request changes.');
      S.ensure(!b.accepted || b.matches_quote === true, 'Confirm the signed document matches the issued quote and client details.');
      S.reviewOfflineAgreement(s, b.accepted, clean(b.note,1000) || (b.accepted ? 'Signed agreement accepted.' : 'Please review and upload a corrected signed agreement.'), at);
      event = b.accepted ? 'uploaded_agreement_accepted' : 'uploaded_agreement_returned';
      break;
    case 'publish_report': {
      const pdf = findDoc(s, b.pdf_id, 'report_pdf'), word = findDoc(s, b.word_id, 'report_docx');
      S.ensure(pdf.password_key && b.reviewed === true, 'Confirm this encrypted PDF and Word file belong to the selected case.');
      const codes = Array.isArray(b.candidates) ? b.candidates : [];
      S.ensure(codes.length <= 30 && codes.every(x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,30}$/.test(x)),
        'Enter up to 30 candidate codes from the report.', 422, 'invalid_candidates');
      S.publishReport(s, { pdf_id: pdf.id, word_id: word.id, candidates: [...new Set(codes)], published_at: at }, at);
      event = 'report_published';
      break;
    }
    case 'start_drafting':
      S.startDrafting(s,at); event='drafting_started'; break;
    case 'publish_draft': {
      const doc=findDoc(s,b.document_id,'pct_draft');
      S.ensure(b.reviewed===true,'Confirm this Word draft belongs to the selected case.');
      const draft=S.publishDraft(s,doc,clean(b.note,1000),at);
      details={version:draft.version};event='draft_published';break;
    }
    case 'ack_meeting':
      S.acknowledgeMeeting(s,b.meeting_id,clean(b.note,1000) || 'The team has received your meeting request.',at);
      event='online_meeting_acknowledged';break;
    case 'package_ready': {
      const review = findDoc(s, b.review_id, 'package_review'), final = findDoc(s, b.final_id, 'package_final');
      S.ensure(b.reviewed === true, 'Confirm that both filing files belong to this case.');
      S.ensure(review.sha256!==final.sha256,'Upload a separate approval copy and the final deliverable.');
      S.packageReady(s, { review_id: review.id, review_sha256:review.sha256, final_id: final.id, final_sha256:final.sha256 }, at);
      event = 'filing_package_ready';
      break;
    }
    case 'start_submission':
      S.startSubmission(s,{official_access:b.official_access===true,authorization_on_file:b.authorization_on_file===true},actor,at);
      event='submission_started';
      break;
    case 'filed': {
      const receipts=Array.isArray(b.receipt_ids)?[...new Set(b.receipt_ids)]:[];
      const docs=Array.isArray(b.document_ids)?[...new Set(b.document_ids)]:[];
      S.ensure(receipts.length>=1 && receipts.length<=10 && docs.length<=15,'Select the official submission receipt and any filed documents.',422,'receipt_required');
      for(const id of receipts)findDoc(s,id,'filing_receipt');
      for(const id of docs)findDoc(s,id,'filed_document');
      const number = clean(b.application_number, 40).toUpperCase();
      S.ensure(APP_NUMBER.test(number), 'Enter the official PCT application number.', 422, 'invalid_application');
      S.markFiled(s, { application_number: number, filed_on: actualDate(b.filed_on, true),
        fees_confirmed: b.fees_confirmed === true,receipt_ids:receipts,document_ids:docs }, at);
      event = 'filed_awaiting_isa'; notify=true;
      break;
    }
    case 'isa_received':
      S.ensure(typeof b.response_needed === 'boolean', 'Indicate whether a response or amendment is in scope.');
      S.recordIsa(s, { reference: bounded(b.reference, 'ISA document reference', 2, 180),
        response_needed: b.response_needed }, at);
      event = 'isa_received';
      break;
    case 'response_done':
      S.recordResponse(s, { reference: bounded(b.reference, 'Response / amendment reference', 2, 180) }, at);
      event = 'response_completed';
      break;
    case 'complete': {
      const doc = findDoc(s, b.document_id, 'publication_notice');
      S.ensure(b.official_confirmed === true && b.work_complete === true,
        'Confirm the agreed services are complete and the official notice states the scheduled publication date.');
      const scheduled = actualDate(b.publication_date);
      S.ensure(s.filing?.filed_on && scheduled >= s.filing.filed_on, 'Publication cannot precede filing.');
      S.markComplete(s, { document_id: doc.id, publication_date: scheduled,
        reference: bounded(b.reference, 'Official notice reference', 2, 180) }, at);
      event = 'services_completed';
      break;
    }
    case 'waive_completion':
      if (fromBot) S.ensure(b.revision === row.revision, 'The case changed. Open it again before waiving the balance.');
      S.ensure(b.agreed === true, 'Confirm the settlement with the client.');
      S.waiveCompletion(s, bounded(b.reason, 'Settlement reason', 5, 1000), at);
      event = 'completion_fee_waived';
      break;
    default: fail('Unknown administrator action.', 404, 'not_found');
  }
  try { return await D.save(env.PCT_DB, row, actor, event, details, notify); }
  catch (e) {
    if (/UNIQUE constraint failed: pct_verified_payment_refs/.test(e?.message || '')) {
      fail('This transaction already settled another invoice.', 409, 'duplicate_payment');
    }
    throw e;
  }
}

async function botRoute(req, env, url) {
  const actor = req.headers.get('x-pct-telegram-actor') || '';
  const admins = String(env.PCT_TELEGRAM_ADMIN_IDS || '').split(',').map(x => x.trim());
  S.ensure(/^\d{1,20}$/.test(actor) && admins.includes(actor), 'Administrator access required.', 403, 'forbidden');
  S.ensure(req.method === 'POST' && configured(env), 'Workflow unavailable.', 503, 'workflow_unavailable');
  const b = await input(req), db = env.PCT_DB;
  switch (url.pathname) {
    case '/internal/pct/list':
      return json(await D.adminList(db, Math.min(1000, Math.max(0, Math.floor(Number(b.offset) || 0)))));
    case '/internal/pct/log':
      return json(await D.caseLog(db,b.case_id,Math.min(300,Math.max(0,Math.floor(Number(b.offset)||0)))));
    case '/internal/pct/case': {
      const c = await D.caseById(db, b.case_id);
      return json({ id: c.id, public_ref: c.public_ref, stage: c.stage, revision: c.revision,
        team_idea: c.state.idea?.source === 'team' });
    }
    case '/internal/pct/link':
      return json({ url: await D.newAdminLink(db, b.case_id, actor, env.PCT_ORIGIN) });
    case '/internal/pct/quote-preview': {
      const c = await D.caseById(db, b.case_id);
      S.ensure(['awaiting_quote','quote_ready'].includes(c.stage), 'This case is not open for a PCT quote.');
      return json({ ...S.quoteBreakdown(b.total_cents), revision: c.revision, public_ref: c.public_ref });
    }
    case '/internal/pct/action': {
      const c = await D.caseById(db, b.case_id);
      const changed = await adminAction(env, c, 'tg:' + actor, b, true);
      return json({ ok: true, public_ref: changed.public_ref, stage: changed.stage });
    }
    case '/internal/pct/notification':
      return json({ notification: await D.claimNotification(db) });
    case '/internal/pct/notification-ack':
      return json({ ok: await D.acknowledgeNotification(db, b.id, b.lease) });
    default: fail('Not found.', 404, 'not_found');
  }
}

async function route(req, env) {
  const url = new URL(req.url), path = url.pathname.replace(/\/$/, ''), method = req.method, db = env.PCT_DB;
  if (url.origin === INTERNAL && path.startsWith('/internal/pct/')) return botRoute(req, env, url);
  S.ensure(url.origin === env.PCT_ORIGIN && (url.origin === PRODUCTION_ORIGIN || testMode(env)) &&
    path.startsWith('/api/pct/'), 'Not found.', 404, 'not_found');
  S.ensure(method === 'GET' || (method === 'POST' && req.headers.get('origin') === url.origin),
    'Same-origin request required.', 403, 'forbidden');
  if (path === '/api/pct/status' && method === 'GET') return json({ enabled: configured(env), ...(testMode(env) ? { test_mode: true } : {}) });
  S.ensure(configured(env), 'The new PCT workflow is not available yet.', 503, 'workflow_unavailable');

  if (path.startsWith('/api/pct/auth/')) return authRoute(req,env,path,{input,upstream,account});

  if (path.startsWith('/api/pct/admin/')) {
    const user = await account(req, env, true);
    if (path === '/api/pct/admin/redeem' && method === 'POST') {
      const b = await input(req);
      S.ensure(/^[a-f0-9]{48}$/.test(b.token || ''), 'Invalid case link.', 403, 'invalid_admin_link');
      return json({ case_id: await D.redeemAdminLink(db, b.token, user.id) });
    }
    const match = /^\/api\/pct\/admin\/cases\/([^/]+)(?:\/(.*))?$/.exec(path);
    S.ensure(match && ID.test(match[1]), 'Not found.', 404, 'not_found');
    await D.requireAdminGrant(db, req.headers.get('x-pct-admin-link'), user.id, match[1]);
    const row = await D.caseById(db, match[1]);
    if (!match[2] && method === 'GET') return json(await caseView(env, row, true));
    if (match[2] === 'agreement' && method === 'GET') {
      S.ensure(row.state.quote, 'The case does not have an issued agreement.', 404, 'agreement_unavailable');
      return F.attachment(await A.caseAgreementDocx(env,row),`PCT-Agreement-${row.public_ref}.docx`);
    }
    if (match[2] === 'quote-preview' && method === 'POST') {
      const b = await input(req);
      S.ensure(['awaiting_quote','quote_ready'].includes(row.stage), 'This case is not open for a PCT quote.');
      return json({ ...S.quoteBreakdown(b.total_cents), revision: row.revision });
    }
    if (match[2] === 'action' && method === 'POST') {
      const b = await input(req);
      const changed = await adminAction(env, row, user.id, b);
      return json(await caseView(env, changed, true));
    }
    if (match[2] === 'documents' && method === 'POST') {
      const doc = await F.uploadFile(req, env, row, true);
      await D.save(db, row, user.id, 'admin_document_uploaded', { document_id: doc.id });
      return json(F.documentView(doc), 201);
    }
    const docId = /^documents\/(doc_[a-f0-9]{32})$/.exec(match[2] || '')?.[1];
    if (docId && method === 'GET') return download(env, row, docId, true);
    fail('Not found.', 404, 'not_found');
  }

  const user = await account(req, env);
  if (path === '/api/pct/undertaking' || path === '/api/pct/undertaking/pdf') {
    const doc = F.legalVersion(env, 'undertaking');
    if (path.endsWith('/pdf') && method === 'GET') return F.attachment(await F.checkedLegalBytes(env, doc),
      `ResearchVault-Confidentiality-${doc.version}.pdf`, true);
    if (method === 'GET') return json({ ...F.legalView(doc), accepted: Boolean(await D.undertakingReceipt(db, user.id, doc)),
      order_version: S.ORDER_VERSION });
    const b = await input(req);
    S.ensure(path === '/api/pct/undertaking' && b.accepted === true && b.version === doc.version && b.sha256 === doc.sha256,
      'Review the current provider undertaking first.', 422, 'undertaking_required');
    await F.checkedLegalBytes(env, doc);
    await D.acknowledge(db, user.id, doc);
    return json({ ok: true });
  }

  if (path === '/api/pct/cases') {
    if (method === 'GET') return json({ cases: (await D.caseList(db, user.id)).map(caseSummary),
      outstanding_balance: await D.debt(db, user.id) });
    const doc = F.legalVersion(env, 'undertaking');
    const accepted = await D.undertakingReceipt(db, user.id, doc);
    S.ensure(accepted, 'Acknowledge the provider confidentiality undertaking before opening a case.', 403, 'undertaking_required');
    const b = await input(req);
    S.ensure(b.order_version === S.ORDER_VERSION && b.accepted === true, 'Accept the Stage 1 order terms first.', 422, 'order_terms_required');
    S.ensure(/^[a-zA-Z0-9_-]{16,100}$/.test(b.request_id || ''), 'Invalid case request.', 422, 'invalid_request');
    const state = S.initialState({ title: bounded(b.title, 'Non-confidential title', 2, 180),
      name: bounded(b.name, 'Name', 2, 180), country: bounded(b.country, 'Country', 2, 80),
      undertaking: { ...F.legalView(doc), accepted_at: accepted.accepted_at }, at: nowSec() });
    return json(caseSummary(await D.createCase(db, user.id, state, b.request_id)), 201);
  }

  const match = /^\/api\/pct\/cases\/([^/]+)(?:\/(.*))?$/.exec(path);
  S.ensure(match && ID.test(match[1]), 'Case not found.', 404, 'not_found');
  const row = await D.caseById(db, match[1], user.id), action = match[2];
  if (!action && method === 'GET') return json(await caseView(env, row));
  if (action==='status' && method==='GET') return json({revision:row.revision,stage:row.stage});
  if (action === 'action' && method === 'POST') return json(await caseView(env, await clientAction(req, env, row, user)));
  if (action === 'documents' && method === 'POST') {
    const doc = await F.uploadFile(req, env, row, false);
    await D.save(db, row, user.id, 'client_document_uploaded', { document_id: doc.id });
    return json(F.documentView(doc), 201);
  }
  if (action==='filing-consent' && method==='GET') return json(await filingConsent(row));
  if (action==='filing-consent/record' && method==='GET') {
    const c=row.state.filing_consent;
    S.ensure(c,'Final filing authorization is not available yet.',404,'authorization_required');
    return F.attachment(new TextEncoder().encode([
      'ResearchVault Patent · Final ePCT filing authorization',c.text,
      'Case: '+c.case_ref,'Draft: v'+c.draft_version,'Final file: '+c.final_name,
      'Final SHA-256: '+c.final_sha256,'Authorization SHA-256: '+c.consent_sha256,
      'Signed by: '+c.signer,'Verified email: '+c.verified_email,
      'Confirmed: '+new Date(c.accepted_at*1000).toISOString(),'Version: '+c.version,
    ].join('\n\n')),`PCT-Filing-Authorization-${row.public_ref}.txt`);
  }
  if (action && /^agreement(?:\/(?:download|signed|text|provider-signature))?$/.test(action) && method === 'GET') {
    const q = row.state.quote;
    S.ensure(q && row.state.decision?.accepted, 'The PCT agreement is not available yet.', 404, 'agreement_unavailable');
    if (action.endsWith('/provider-signature')) return new Response(await A.providerImage(env,row), { headers:{'content-type':'image/png'} });
    if (action.endsWith('/text')) return json({ sections: await A.agreementSections(env,row) });
    if (action.endsWith('/download')) return F.attachment(await A.caseAgreementDocx(env,row),`PCT-Agreement-${row.public_ref}.docx`);
    if (action.endsWith('/signed')) {
      const signed = row.state.engagement;
      S.ensure(signed, 'The signed agreement is not available yet.',404,'agreement_unavailable');
      if (signed.mode === 'upload') return download(env,row,signed.document_id,false);
      return F.attachment(await A.caseAgreementDocx(env,row,signed),`PCT-Agreement-${row.public_ref}-signed.docx`);
    }
    const schedule = legalSchedule(row);
    return json({ ...schedule, version: q.agreement.version, schedule_sha256: await sha256Hex(JSON.stringify(schedule)) });
  }
  const docId = action?.startsWith('documents/') ? action.slice(10) : '';
  if (DOC_ID.test(docId) && method === 'GET') return download(env, row, docId, false);
  fail('Not found.', 404, 'not_found');
}

async function download(env, row, docId, admin) {
  const doc = row.state.documents.find(d => d.id === docId);
  S.ensure(doc && F.mayDownload(row.state, doc, admin), 'Document not available.', 404, 'document_not_found');
  const bytes = await F.getObject(env, doc.key);
  S.ensure(await sha256Hex(bytes) === doc.sha256, 'Document integrity check failed.', 500, 'invalid_document');
  return F.attachment(bytes, doc.name);
}

export default {
  async fetch(req, env, ctx) {
    try {
      const response = await route(req, env);
      if (response.ok && req.method==='POST' && /\/(?:action|notification-ack)$/.test(new URL(req.url).pathname) &&
          ctx?.waitUntil && notificationTarget(env)) {
        ctx.waitUntil(deliverPctNotices(env).catch(()=>console.warn('pct_notice_retry_pending')));
      }
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'private, no-store');
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'no-referrer');
      headers.set('x-frame-options', 'DENY');
      return new Response(response.body, { status: response.status, headers });
    } catch (e) {
      if (e instanceof S.RuleError) return error(e.message, e.status, e.code);
      console.error('pct_workflow_error', e?.name || 'Error');
      return error('The PCT workflow is temporarily unavailable.', 500, 'internal_error');
    }
  },
  async scheduled(_event,env,ctx) {
    ctx.waitUntil(deliverPctNotices(env).catch(()=>console.warn('pct_notice_retry_pending')));
  },
};
