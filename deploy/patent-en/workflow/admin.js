import { $, api, esc, fileForm, login, money, notice, onClick, onForm, post, session, set, timeline, when } from './shared.js';

const ROOT = '/api/pct/admin';
let token = location.hash.slice(1);
let id = null;
const card = (title, content) => `<section class="card"><h3>${title}</h3>${content}</section>`;
const btn = label => `<button type="submit">${label}</button>`;
const txt = (name, label, attrs = '') => `<label>${label}<input name="${name}" required ${attrs}></label>`;
const check = (name, label) => `<label class="check"><input type="checkbox" name="${name}" required> ${label}</label>`;
const optNote = `<label>Message to the client (optional)<textarea name="note" maxlength="1500"></textarea></label>`;
const path = () => `${ROOT}/cases/${id}`;
const options = (c, cat) => c.documents.filter(d => d.category === cat)
  .map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
const pick = (c, name, label, category) => `<label>${label}<select name="${name}" required>
  <option value="">Select the exact file</option>${options(c,category)}</select></label>`;
const upload = (category, label, ext, password = false) =>
  `<form data-upload="${category}"><label>${label}<input type="file" name="file" accept="${ext}" required></label>
    ${password ? txt('password','PDF open password (AES-256, revision 6)','type="password" minlength="12" maxlength="80" autocomplete="new-password"') : ''}
    ${btn('Upload privately')}</form>`;

function invoices(c) {
  return card('Payment review', c.invoices.map(i => `<section class="invoice">
    <div class="row"><b>${esc(i.label)}</b><span class="amount">${money(i.amount_cents)}</span><span class="pill">${esc(i.status)}</span></div>
    ${i.status === 'issued' && c.test_mode ? `<form data-simulate="${i.key}">${check('confirm','I am confirming a synthetic test payment.')}${btn('Simulate payment confirmation')}</form>` : ''}
    ${i.status === 'issued' && !c.test_mode && i.receipt ? `<form data-verify="${i.key}"><p>Client receipt: <code>${esc(i.receipt.reference)}</code></p>
      ${check('verified','I independently verified this exact deposit in the receiving wallet.')}${btn('Confirm verified payment')}</form>` : ''}
    </section>`).join(''));
}

function controls(c) {
  switch (c.stage) {
    case 'consultation_requested': return card('After the consultation', `<form id="report-authorize">
      ${check('held','The consultation took place and the scope of the invention was agreed.')}${btn('Open US$555 report invoice')}</form>`);
    case 'report_work': return card('Release the report to this case', `<p>Upload the final encrypted PDF and editable Word document. The password is stored separately and released after settlement.</p>
      <div class="grid">${upload('report_pdf','Encrypted report PDF','.pdf',true)}${upload('report_docx','Report Word file','.docx')}</div>
      <form id="report-publish">${pick(c,'pdf_id','Encrypted PDF','report_pdf')}${pick(c,'word_id','Editable Word','report_docx')}
      <label>Candidate codes from the report (comma separated, optional)<input name="candidates" maxlength="500" placeholder="C1,C2"></label>
      ${check('reviewed','I checked these files and candidate codes belong to the selected case.')}${btn('Publish locked report and open US$445 invoice')}</form>`);
    case 'idea_review': return card('Review the chosen invention', `<p>${esc(c.idea.source === 'team' ? 'Team candidate ' + c.idea.candidate : 'Original invention')}</p>
      <p>${esc(c.idea.description)}</p>
      <form id="idea-decision"><label>Decision<select name="decision"><option value="accept">Accept</option><option value="decline">Decline</option></select></label>
      ${optNote}
      ${c.idea.source === 'team' ? '<label>Separate idea-sale agreement reference (required when accepting)<input name="rights_ref" maxlength="200"></label>' : ''}
      ${btn('Send decision to client portal')}</form>`);
    case 'awaiting_quote':
    case 'quote_ready': return card('Prepare the PCT quote', `<p>Enter the total professional fee in USD. The portal calculates the three instalments.</p>
      <form id="quote-preview">${txt('total','Total professional fee (USD)','type="number" min="3500" max="5500" step=".01"')}${btn('Preview payment schedule')}</form>
      <div id="quote-result" aria-live="polite"></div>`);
    case 'agreement_review': return card('Review the uploaded signed agreement', `<p>Check the signed upload against the issued Word copy, client information and exact quote.</p>
      <div class="row"><button type="button" class="secondary" id="issued-agreement">Download issued Word copy</button>
      <button type="button" class="secondary" data-signed-review="${c.agreement_review.document_id}">Download signed upload</button></div>
      <form id="review-agreement"><label>Decision<select name="decision"><option value="accept">Approve signed copy</option><option value="decline">Return for correction</option></select></label>
        <label class="check"><input type="checkbox" name="matches_quote"> I verified this file matches the case, signed parties and quote (required to approve).</label>
        ${optNote}${btn('Record review')}</form>`);
    case 'pct_start_pending': return card('Start PCT drafting',`<p>The client accepted the engagement, paid the start invoice and provided filing details.</p><form id="draft-start">${btn('Start preparing Word draft v1.0')}</form>`);
    case 'pct_drafting':
    case 'pct_draft_revision': {
      const next=(c.drafts.length+1)+'.0';
      const feedback=c.drafts.at(-1)?.feedback;
      return card('Publish Word draft v'+next,`
        ${feedback ? `<p><b>Comments returned:</b> ${esc(feedback.note||'See the Word file.')}</p>` : ''}
        ${upload('pct_draft','Word draft v'+next,'.docx')}
        <form id="publish-draft">${pick(c,'document_id','Word draft','pct_draft')}
          <label>Note to the client (optional)<textarea name="note" maxlength="1000"></textarea></label>
          ${check('reviewed','I verified this Word draft belongs to the selected case.')}${btn('Send v'+next+' for client review')}</form>`);
    }
    case 'pct_finalizing': return card('Filing package ready', `<div class="grid">${upload('package_review','Review copy (PDF)','.pdf')}
      ${upload('package_final','Final filing package','.pdf,.docx,.zip')}</div>
      <form id="package-ready">${pick(c,'review_id','Review copy','package_review')}${pick(c,'final_id','Final package','package_final')}
      ${check('reviewed','I checked that the two files belong to this case.')}${btn('Open package invoice and client review')}</form>`);
    case 'pct_package_ready': return card('Before filing','<p>Awaiting verified settlement of the filing package invoice.</p>');
    case 'pct_filing_consent': return card('Before filing','<p>Awaiting final client authorization for this version in ePCT.</p>');
    case 'pct_authorized': return card('Start submitting in ePCT',`<form id="start-submission">
      ${check('official_access','I have official access to this case through my own WIPO account.')}
      ${check('authorization_on_file','The client’s final authorization and any required representation authority are on file.')}
      ${btn('Mark submission in progress')}</form>`);
    case 'pct_submitting': return card('Record the official filing', `<div class="grid">${upload('filing_receipt','Official ePCT filing receipt','.pdf')}
      ${upload('filed_document','Filed document or bundle','.pdf,.docx,.zip')}</div><form id="filed">
      <fieldset><legend>Receipt files to share (at least one)</legend>${c.documents.filter(d=>d.category==='filing_receipt').map(d=>`<label class="check"><input type="checkbox" name="receipt_ids" value="${d.id}"> ${esc(d.name)}</label>`).join('') || '<p>Upload a receipt first.</p>'}</fieldset>
      <fieldset><legend>Filed documents to share</legend>${c.documents.filter(d=>d.category==='filed_document').map(d=>`<label class="check"><input type="checkbox" name="document_ids" value="${d.id}"> ${esc(d.name)}</label>`).join('') || '<p>No filed documents uploaded yet.</p>'}</fieldset>${txt('application_number','Official PCT application number','placeholder="PCT/XX2026/000001" maxlength="40"')}
        ${txt('filed_on','Filing date','type="date"')}${check('fees_confirmed','I verified the official fees and filing evidence.')}${btn('Mark filed and await ISA')}</form>`);
    case 'isa_wait': {
      const searchFiles = [
        ['isa_report','International Search Report (ISR)','report_id'],
        ['isa_written_opinion','Written Opinion (WO-ISA)','written_opinion_id'],
      ];
      const enabled = Array.isArray(c.team_updates);
      return card('International search', `${enabled ? '<div class="grid">'+searchFiles.map(([category,label])=>upload(category,label,'.pdf')).join('')+'</div>' : ''}
      <form id="isa-received">${txt('reference','Search report / written opinion reference','maxlength="180"')}
      <label>Agreed response or amendment needed?<select name="response_needed"><option value="no">No</option><option value="yes">Yes</option></select></label>
      ${enabled ? searchFiles.map(([category,label,name])=>`<label>${label}<select name="${name}"><option value="">No file selected</option>${options(c,category)}</select></label>`).join('') : ''}
      ${enabled ? '<div class="grid"><label>Official deadline, if stated<input type="date" name="official_due_on"></label><label>Official notice reference for that deadline<input name="official_due_source" maxlength="180"></label></div>' : ''}
      ${btn('Record ISA documents')}</form>`);
    }
    case 'pct_response': return card('Response and amendments', `<form id="response-done">${txt('reference','Response / amendment reference','maxlength="180"')}${btn('Mark agreed response complete')}</form>`);
    case 'publication_wait': return card('Official publication scheduling', `${upload('publication_notice','Official publication scheduling notice','.pdf')}
      <form id="complete">${pick(c,'document_id','Official notice','publication_notice')}${txt('reference','Official notice reference','maxlength="180"')}
      ${txt('publication_date','Scheduled publication date','type="date"')}
      ${check('official_confirmed','I checked the date against the official WIPO/ePCT notice.')}
      ${check('work_complete','All agreed services for this case are complete.')}${btn('Complete services and issue final invoice')}</form>`);
    default: return '';
  }
}

function render(c) {
  const mayWaive = c.engagement && c.invoices.some(i => i.key === 'pct_start' && i.status === 'paid') &&
    !c.invoices.some(i => i.key === 'pct_ready' && i.status === 'issued') && !c.settlement;
  set(`<section class="card"><p class="case-key">${esc(c.public_ref)}</p><h2>${esc(c.title)}</h2>
    <p>${esc(c.client.name)} · ${esc(c.client.country)}</p><span class="pill">${esc(c.stage_label)}</span></section>
    ${Array.isArray(c.team_updates) && !['completed','closed_by_agreement','declined'].includes(c.stage) ? card('Post a case update',`
      <p>The client sees this in their private case. Select the checkbox only when the message reports progress on the current case stage.</p>
      <form id="team-update"><label>Case update<textarea name="body" minlength="2" maxlength="2000" required></textarea></label>
      <label class="check"><input type="checkbox" name="progress"> This message gives a progress update on the current stage.</label>${btn('Post to this case')}</form>`) : ''}
    ${controls(c)}${invoices(c)}
    ${c.meeting_requests.filter(m=>m.status==='requested').map(m=>card('Online meeting request',`<p>${esc(m.note||'The client requested a meeting.')}</p>
      <form data-meeting="${m.id}"><label>Reply or meeting details<textarea name="note" maxlength="1000"></textarea></label>${btn('Acknowledge request')}</form>`)).join('')}
    ${c.filing_profile ? card('Private filing information', `<p>${esc(c.filing_profile.legal_name)} · ${esc(c.filing_profile.role)}</p>
      <p>${esc(c.filing_profile.address)}, ${esc(c.filing_profile.postal_code)} ${esc(c.filing_profile.country)}</p>
      <p>ePCT access plan: ${esc(c.filing_profile.epct_access.replaceAll('_',' '))}</p>`) : ''}
    ${card('Private documents', `<ul>${c.documents.map(d=>`<li><button type="button" class="secondary" data-download="${d.id}">Download ${esc(d.name)}</button> <small>${esc(d.category.replaceAll('_',' '))}</small></li>`).join('')}</ul>`)}
    ${mayWaive ? card('Settle by agreement', `<form id="waive"><label>Reason for closing / waiving the final fee<textarea name="reason" required minlength="5" maxlength="1000"></textarea></label>
      ${check('agreed','The client and I have agreed to waive the final completion fee.')}${btn('Waive final fee and close with zero balance')}</form>`) : ''}
    ${c.settlement ? card('Balance', '<p>Case settled — balance US$0.</p>') : ''}
    ${card('Client messages', c.messages?.map(m => `<p>${esc(m.body)} <small>${esc(when(m.at))}</small></p>`).join('') || '<p>No messages.</p>')}
    ${card('Case activity', timeline(c.events))}`);

  const action = async body => {
    const changed = await post(path() + '/action', body, token);
    render(changed);
    notice('Case updated.');
  };
  const formAction = (selector, name, adapt = () => ({})) =>
    onForm(selector, d => action({ ...Object.fromEntries(d), ...adapt(d), action: name }));
  formAction('#report-authorize','authorize_report',()=>({meeting_completed:true}));
  formAction('#team-update','post_team_update',d=>({progress:d.has('progress')}));
  formAction('#report-publish','publish_report',d=>({reviewed:true,candidates:d.get('candidates').split(',').map(x=>x.trim()).filter(Boolean)}));
  formAction('#idea-decision','decide_idea',d=>({accepted:d.get('decision')==='accept'}));
  formAction('#review-agreement','review_agreement',d=>({accepted:d.get('decision')==='accept',matches_quote:d.has('matches_quote')}));
  formAction('#draft-start','start_drafting');
  formAction('#publish-draft','publish_draft',()=>({reviewed:true}));
  for(const m of c.meeting_requests.filter(m=>m.status==='requested'))
    formAction(`[data-meeting="${m.id}"]`,'ack_meeting',()=>({meeting_id:m.id}));
  formAction('#package-ready','package_ready',()=>({reviewed:true}));
  formAction('#start-submission','start_submission',()=>({official_access:true,authorization_on_file:true}));
  formAction('#filed','filed',d=>({fees_confirmed:true,receipt_ids:d.getAll('receipt_ids'),document_ids:d.getAll('document_ids')}));
  formAction('#isa-received','isa_received',d=>({response_needed:d.get('response_needed')==='yes'}));
  formAction('#response-done','response_done');
  formAction('#complete','complete',()=>({official_confirmed:true,work_complete:true}));
  formAction('#waive','waive_completion',()=>({agreed:true}));
  for (const f of document.querySelectorAll('[data-upload]')) {
    const kind = f.dataset.upload;
    onForm(`[data-upload="${kind}"]`, async d => {
      await post(path()+'/documents',fileForm(kind,d.get('file'),d.get('password')),token);
      await load(); notice('File saved to the selected case.');
    });
  }
  for (const i of c.invoices.filter(x=>x.status==='issued')) {
    formAction(`[data-simulate="${i.key}"]`,'simulate_payment',()=>({milestone:i.key}));
    formAction(`[data-verify="${i.key}"]`,'verify_payment',()=>({milestone:i.key,verified:true,reference:i.receipt.reference,amount_cents:i.amount_cents}));
  }
  const download = async (suffix,name) => {
    const res = await api(path()+suffix,{grant:token,raw:true});
    const url = URL.createObjectURL(await res.blob()), a = document.createElement('a');
    a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
  };
  onClick('#issued-agreement', () => download('/agreement',c.public_ref+'-issued.docx'));
  for (const d of c.documents) {
    onClick(`[data-signed-review="${d.id}"]`,()=>download('/documents/'+d.id,d.name));
    onClick(`[data-download="${d.id}"]`,()=>download('/documents/'+d.id,d.name));
  }
  onForm('#quote-preview', async data => {
    const total_cents = Math.round(Number(data.get('total'))*100);
    const p = await post(path()+'/quote-preview',{total_cents},token);
    $('#quote-result').innerHTML = `<p>Start ${money(p.start)} · Package ready ${money(p.ready)} · Completion ${money(p.completion)}</p>
      <form id="quote-send">${check('confirmed','Send this schedule and agreement to the selected case.')}${btn('Send quote')}</form>`;
    onForm('#quote-send', () => action({action:'quote',total_cents,revision:p.revision}));
  });
}

async function load() { render(await api(path(), { grant: token })); }

async function open(user) {
  if (!user?.is_admin) throw new Error('Sign in with the verified administrator account.');
  if (!id) id = (await post(ROOT+'/redeem',{token})).case_id;
  await load();
}

(async () => {
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return set(card('Open a case from Telegram', '<p>Use the short-lived link for the selected case.</p>'));
  }
  history.replaceState({}, '', location.pathname);
  try { await open(await session()); }
  catch (error) { if (error.status !== 401) throw error; login(open); }
})().catch(error => { set(card('Private case unavailable', '<p>Get a fresh link from Telegram and sign in again.</p>')); notice(error.message,true); });
