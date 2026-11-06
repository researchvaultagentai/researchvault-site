import { esc, when } from './shared.js';

const tasks = {
  consultation:'Consultation arrangements', prior_art:'Specialist prior-art report', invention:'Review of your selected invention',
  quote:'Case quote', agreement:'Signed agreement review', draft:'First Word draft', revision:'Draft revisions',
  package:'Final filing package', filing:'Authorized ePCT submission', isa_response:'Agreed ISA response or amendment',
  receipt:'Payment receipt review', meeting:'Online meeting request', message:'Reply to your private message',
};
const customer = {
  consultation_payment:['Complete the consultation invoice','Add invention materials and submit your payment receipt to start the assessment.','#case-invoices'],
  report_payment:['Start the prior-art report','Submit the receipt for the report start invoice.','#case-invoices'],
  report_ready:['Unlock the specialist report','The locked PDF is ready. After the release invoice is confirmed, the password and Word version appear here.','#case-invoices'],
  idea_selection:['Choose the invention you want to pursue','Read the report and send us your final technical direction.','#idea'],
  quote_ready:['Review the quote and sign','Read the case agreement and sign it with an email code or return the signed copy.','#case-quote'],
  pct_deposit:['Confirm your PCT start payment','Submit the receipt for the first PCT service instalment.','#case-invoices'],
  pct_intake:['Complete the filing details','Provide applicant information and plan access through official ePCT permissions.','#filing'],
  pct_draft_review:['Review the latest Word draft','Return your annotated Word file or approve this version for final preparation.','#case-drafts'],
  pct_package_ready:['Settle the filing instalment','After confirmation, the final authorization opens in this portal.','#case-invoices'],
  pct_filing_consent:['Authorize the exact final package','Review the final copy and confirm with the email signing code.','#filing-consent'],
  completion_due:['Review the official notice and settle the balance','Find the publication scheduling notice under Documents and submit the final receipt.','#case-invoices'],
};
const external = {
  isa_wait:['Waiting for the International Searching Authority','Your submission is recorded. We will update this case after the ISA report or official notice arrives. Processing follows the authority’s timetable.'],
  publication_wait:['Waiting for official publication scheduling','We will record the scheduled date when the official notice is available.'],
};
const closed = {completed:['Case complete','Your official documents remain available. The final invoice is settled.'],
  closed_by_agreement:['Case closed by agreement','The agreed closing balance is settled.'],declined:['Assessment complete','This case is not proceeding to PCT services. Your assessment remains available.']};
const hourglass = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3v3a5 5 0 0 0 2 4l3 2-3 2a5 5 0 0 0-2 4v3M17 3v3a5 5 0 0 1-2 4l-3 2 3 2a5 5 0 0 1 2 4v3"/><path d="m9 19 3-2 3 2"/></svg>';

export function caseNext(c) {
  const receipt = (c.invoices || []).some(i=>i.status==='issued' && i.receipt_pending);
  if (Object.hasOwn(external,c.stage)) return {owner:'authority',label:'Official processing',detail:external[c.stage]};
  if (Object.hasOwn(closed,c.stage)) return {owner:'closed',label:'Case closed',detail:closed[c.stage]};
  if (Object.hasOwn(customer,c.stage) && !receipt) return {owner:'client',label:'Your action',detail:customer[c.stage]};
  return {owner:'team',label:'With our team',detail:receipt ? ['Reviewing your payment receipt','The invoice updates once payment is verified.'] : [c.stage_label,'We’ll post the next milestone or a progress update in this case.']};
}

export function countdown(due, now) {
  const seconds = due - now;
  if (seconds <= 0) return {text:'Update overdue',tone:'late'};
  const m = Math.ceil(seconds / 60), days = Math.floor(m / 1440), hours = Math.floor(m / 60) % 24;
  return {text:days ? `${days}d ${hours}h left` : hours ? `${hours}h ${m%60}m left` : `${m}m left`,tone:seconds <= 86400 ? 'soon' : 'open'};
}

export function teamUpdates(c) {
  const items=(c.team_updates || []).filter(i=>Object.hasOwn(tasks,i.kind) && Number.isSafeInteger(i.due_at));
  if (!items.length) return '';
  const now=Number.isSafeInteger(c.server_now) ? c.server_now : Math.floor(Date.now()/1000);
  return `<section class="team-window" id="case-team-updates" aria-label="Team update targets"><div class="team-window-head">${hourglass}<div><strong>Team update targets</strong><p>We aim to post a reply or progress update within 72 hours of a pending team action.</p></div></div>
    <ul>${items.map(i=>{
      const value=countdown(i.due_at,now), date=new Date(i.due_at*1000);
      const local=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(date);
      return `<li><span>${tasks[i.kind]}<small>Target: <time datetime="${date.toISOString()}">${esc(local)}</time></small></span><strong class="case-clock" data-case-clock="${i.due_at}" data-clock-tone="${value.tone}">${value.text}</strong></li>`;
    }).join('')}</ul><p class="quiet">These are communication targets. Official deadlines and deliverable timelines are separate.</p></section>`;
}

export function nextAction(c) {
  const {owner,label,detail:[title,copy,anchor]}=caseNext(c);
  return `<section class="next-action" data-next-owner="${owner}" aria-label="Next action"><span class="owner-tag">${label}</span><div><h3>${esc(title)}</h3><p>${copy}</p></div>
    ${anchor ? `<a class="button secondary" href="${anchor}">Go to this step <span aria-hidden="true">↓</span></a>` : ''}</section>`;
}

export function tickClocks(now, root = document) {
  for (const node of root.querySelectorAll('[data-case-clock]')) {
    const value=countdown(Number(node.dataset.caseClock),now);
    if (node.textContent!==value.text) node.textContent=value.text;
    node.dataset.clockTone=value.tone;
  }
}

const extensionNotice = 'This case needs more work than anticipated. We will post the next update within 72 hours of this notice. Thank you for your patience.';

const noticeEvents = {
  team_update_extended:[extensionNotice,'#case-team-updates'],
  team_update_posted:['The ResearchVault team posted a private update.','#case-messages'],
  online_meeting_acknowledged:['The team replied to your meeting request.','#case-messages'],
  report_published:['Your specialist report is ready to unlock.','#case-invoices'],
  payment_confirmed:['Your payment was verified.','#case-invoices'],
  usdt_payment_review:['A USDT transfer needs review. Please wait for an update.','#case-invoices'],
  consultation_requested:['Your payment was verified and your consultation request was recorded.','#case-invoices'],
  idea_accepted:['The team accepted your selected invention.','#case-activity'],
  idea_declined:['The team posted its decision on your selected invention.','#case-activity'],
  quote_offered:['Your quote and agreement are ready for review.','#case-quote'],
  uploaded_agreement_accepted:['Your signed agreement was accepted.','#case-activity'],
  uploaded_agreement_returned:['Please review the team’s request to correct the signed agreement.','#case-quote'],
  draft_published:['A Word draft is ready for your review.','#case-drafts'],
  filing_package_ready:['The filing package and invoice are ready.','#case-invoices'],
  submission_started:['Your authorized ePCT submission has started.','#case-activity'],
  filed_awaiting_isa:['Filing is confirmed. Your official receipt is available.','#case-documents'],
  isa_received:['The team recorded the outcome of the international search.','#case-isa'],
  response_completed:['The team recorded completion of the agreed response.','#case-documents'],
  services_completed:['The official publication notice is available.','#case-documents'],
  completion_fee_waived:['The team recorded settlement of the remaining balance.','#case-activity'],
};

export const caseEventText = event => event.event_type === 'team_update_extended' ? extensionNotice
  : event.event_type.replaceAll('_',' ');

export function caseNotifications(c) {
  if (!Number.isSafeInteger(c.client_seen_revision)) return '';
  const notices=(c.events || []).filter(e=>e.revision>c.client_seen_revision && Object.hasOwn(noticeEvents,e.event_type));
  if (!notices.length) return '';
  return `<section class="team-window" id="case-notifications" aria-label="New case notifications">
    <h3>${notices.length} new case ${notices.length===1?'notification':'notifications'}</h3>
    <ul>${notices.map(e=>{
      const [label, anchor]=noticeEvents[e.event_type];
      return `<li><a href="${anchor}">${label}</a><time>${esc(when(e.created_at))}</time></li>`;
    }).join('')}</ul><button type="button" class="secondary" id="mark-case-notices-read">Mark as read</button></section>`;
}
