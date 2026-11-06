import { progress } from './progress.js';
import { caseEventText, caseNotifications, nextAction, teamUpdates, tickClocks } from './case-status.js';
import { USDT } from '/patent/assets/international-payments-config.js';
import { $, api, esc, fileForm, login, money, notice, onClick, onForm, post, requestCode, session, set, terms, timeline, when } from './shared.js';

const ROOT = '/api/pct';
const PATH = '/patent/en/workflow/';
let user, testMode = false, activeCase = null, dirty = false, checking = false, clockSample = null;
let paymentCheck = null;
const casePath = id => `${ROOT}/cases/${encodeURIComponent(id)}`;
const txt = (name, label, extra = '') => `<label>${label}<input name="${name}" required ${extra}></label>`;
const check = (name, label) => `<label class="check"><input type="checkbox" name="${name}" required> ${label}</label>`;
const card = (title, html, id = '') => `<section class="card"${id ? ` id="${id}"` : ''}><h3>${title}</h3>${html}</section>`;
const sel = (name, label, options) => `<label>${label}<select name="${name}" required>${options.map(([key, value]) =>
  `<option value="${esc(key)}">${esc(value)}</option>`).join('')}</select></label>`;
const button = label => `<button type="submit">${label}</button>`;

function linkDoc(c, doc, label = doc.name) {
  return `<a href="${casePath(c.id)}/documents/${doc.id}">${esc(label)}</a>`;
}

function renderUndertaking(doc) {
  set(card('Confidentiality comes first', `<p>Before you share technical information, receive our signed confidentiality undertaking. Save a copy for your records.</p>
    <p><a class="button secondary" href="${ROOT}/undertaking/pdf" target="_blank" rel="noopener">Open signed confidentiality PDF</a></p>
    <form id="undertaking">${check('accepted', 'I have received and reviewed the confidentiality undertaking.')}${button('Acknowledge and continue')}</form>`));
  onForm('#undertaking', async () => {
    await post(ROOT + '/undertaking', { accepted: true, version: doc.version, sha256: doc.sha256 });
    await refresh();
  });
}

function renderNew(doc, balance) {
  if (balance) return card('Final invoice outstanding', `<p>Settle the final invoice on <a href="${PATH}?case=${balance.id}">${esc(balance.public_ref)}</a> before opening a new case.</p>`);
  return card('Start a confidential case', `<p>Use a short, non-confidential title here. The next screen accepts your technical materials privately.</p>
    ${terms}<p><a href="${ROOT}/undertaking/pdf" target="_blank" rel="noopener">Save the signed confidentiality undertaking</a></p>
    <form id="new-case"><div class="grid">${txt('name','Full name','autocomplete="name" maxlength="180"')}${txt('country','Country of contracting','autocomplete="country-name" maxlength="80"')}</div>
    ${txt('title','Non-confidential project title','maxlength="180"')}
    ${check('terms','I order Stage 1 and accept the prices and terms above.')}${button('Create case')}</form>`);
}

function renderInvoices(c) {
  const status = { issued: 'Open', paid: 'Paid', waived: 'Waived by agreement' };
  return card('Invoices', c.invoices.map(i => `<section class="invoice">
    <div class="row"><b>${esc(i.label)}</b><span class="amount">${money(i.amount_cents)}</span><span class="pill">${esc(status[i.status])}</span></div>
    ${i.non_refundable ? '<p class="quiet">Stage 1 order terms apply.</p>' : ''}
    ${i.receipt_pending ? '<p>Your receipt is awaiting review. The invoice remains open until confirmation.</p>' : ''}
    ${i.status === 'issued' && testMode ? '<p class="quiet">Test invoice. An administrator will simulate confirmation; no transfer is needed.</p>' : ''}
    ${i.status==='issued' && c.usdt_checkout && !i.receipt_pending ? `<p>
      <button type="button" data-checkout="${i.key}">Pay in USDT</button></p>
      <div data-checkout-details="${i.key}" hidden></div><p data-checkout-status="${i.key}" role="status"></p>` : ''}
    ${i.status === 'issued' && !testMode && (!c.usdt_checkout || i.receipt_pending) ? `<details><summary>Payment instructions</summary>
      <p>Send exactly <b>${(i.amount_cents/100).toFixed(2)} USDT</b> on ${USDT.network} to <code>${USDT.address}</code>.</p>
    <form data-receipt="${i.key}">${txt('reference','TRON transaction ID','pattern="[0-9a-fA-F]{64}" maxlength="64"')}${button('Submit receipt for review')}</form></details>` : ''}</section>`).join(''),'case-invoices');
}

function renderCase(c) {
  const s = c.stage, report = c.report, pkg = c.package, closed = ['completed','closed_by_agreement'].includes(s);
  const files = c.documents.map(d => `<li>${linkDoc(c,d)} <small>${esc(d.category.replaceAll('_',' '))}</small></li>`).join('');
  const reportPdf = c.documents.find(d => d.id === report?.pdf_id);
  const reportWord = c.documents.find(d => d.id === report?.word_id);
  const canUpload = !closed && !['declined','completion_due'].includes(s);
  const upload = canUpload ? card('Confidential invention materials', `<p>Upload descriptions, draft claims or PCT files, technical or industrial drawings, photos, test results and product videos. Documents: up to 15 MiB each. MP4: up to 20 MiB and 7 minutes.</p>
    <form id="disclosure"><label>Choose files<input name="files" type="file" multiple accept=".pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.webp,.zip,.step,.stp,.iges,.igs,.dxf,.dwg,.sch,.kicad_sch,.brd,.json,.csv,.mp4"></label>
    <label>Initial technical description (optional)<textarea name="description" maxlength="12000"></textarea></label>${button('Upload materials')}</form>`) : '';
  const idea = s === 'idea_selection' ? card('Choose the invention to take forward', `<form id="idea">
    ${sel('choice','Invention to proceed with',[['original','My original invention'],...report.candidates.map(x => ['team:' + x,'Report candidate ' + x])])}
    <label>Describe your final chosen invention in writing<textarea name="description" required minlength="12" maxlength="8000"></textarea></label>${button('Send final selection for review')}</form>`) : '';
  const draft=c.drafts?.at(-1);
  const draftDoc=draft && c.documents.find(d=>d.id===draft.document_id);
  const revision=draftDoc ? card('PCT Word drafts', `
    <p>Current version: <b>v${esc(draft.version)}</b> · ${linkDoc(c,draftDoc,'Download Word draft')}</p>
    ${draft.note?`<p>${esc(draft.note)}</p>`:''}
    <details><summary>Version history</summary><ul>${c.drafts.map(d=>{
      const doc=c.documents.find(x=>x.id===d.document_id);
      return `<li>${linkDoc(c,doc,'v'+d.version)} · ${d.feedback?'Comments returned':c.draft_approval?.document_id===d.document_id?'Approved for final preparation':'Shared for review'}</li>`;
    }).join('')}</ul></details>
    ${s==='pct_draft_review' ? `<p>Use Word comments or Track Changes. Return the annotated Word file if you want changes, or approve this version for preparation of the final package.</p>
      <div class="grid"><form id="draft-feedback"><label>Word file with comments<input name="file" type="file" accept=".docx" required></label>
        <label>Note to the team (optional)<textarea name="note" maxlength="1000"></textarea></label>${button('Return comments on v'+draft.version)}</form>
      <form id="draft-approve">${check('confirmed','I approve v'+draft.version+' for final preparation.')}${button('Approve draft v'+draft.version)}</form></div>` : ''}`,'case-drafts') : '';
  const consent=s==='pct_filing_consent' ? card('Final ePCT filing authorization',`<div class="filing-warning" role="note"><b>This is your final filing authorization.</b><p>Review the final copy. Your confirmation locks this version in the portal and authorizes submission in ePCT. You will no longer be able to request edits to this package here.</p></div>
    <p>${linkDoc(c,c.documents.find(d=>d.id===pkg.review_id),'Open final approval copy')}</p>
    <p id="consent-statement"></p>
    <form id="filing-consent">${txt('signer','Type your full name','maxlength="180" autocomplete="name"')}
      ${check('accepted','I have read and approve this exact final package. I authorize the agreed ePCT submission.')}
      <button id="consent-code" type="button" class="secondary">Send final signing code</button>
      <div id="consent-verify" hidden>${txt('code','Verification code','pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" inputmode="numeric" disabled')}
      ${button('Confirm and authorize ePCT submission')}</div></form>`) : '';
  const progressNote=['pct_start_pending','pct_drafting','pct_draft_revision','pct_finalizing','pct_submitting'].includes(s)
    ? card(esc(c.stage_label),`<div class="prep-progress" aria-hidden="true"></div><p>${s==='pct_start_pending'?
      'Your filing details are ready. The team has been notified to start drafting.':s==='pct_draft_revision'?
      'The team is reviewing your annotated Word file. Your next draft will appear here.':s==='pct_submitting'?
      'Your authorized package is being submitted in ePCT. The official receipt and filed documents will appear here when submission is confirmed.':s==='pct_finalizing'?
      'The team is preparing the final package from your approved draft.':'Your first Word draft will appear here for review.'}</p>`)
    : '';
  const meeting=c.engagement && !closed && s!=='completion_due' ? card('Need an online meeting?', `
    ${c.meeting_requests.some(m=>m.status==='requested')?'<p>Your meeting request is with the team.</p>':
      `<form id="request-meeting"><label>What would you like to discuss? (optional)<textarea name="note" maxlength="1000"></textarea></label>${button('Request an online meeting')}</form>`}
    ${c.meeting_requests.filter(m=>m.note_to_client).map(m=>`<p>${esc(m.note_to_client)}</p>`).join('')}`) : '';
  return `<section class="card case-overview"><p class="case-key">${esc(c.public_ref)}</p><h2>${esc(c.title)}</h2>
    <p class="row"><span class="pill">${esc(c.stage_label)}</span>${closed ? '<b>Case settled — balance US$0</b>' : ''}</p>
    <p id="status-update" class="quiet" aria-live="polite">Status updates while this page is open. <button type="button" id="refresh-case" class="secondary">Refresh</button></p>
    ${c.decision ? `<p>${esc(c.decision.note)}</p>` : ''}
    ${c.meeting?.status === 'requested' ? '<p>Your consultation request is recorded. The team will contact you to arrange it.</p>' : ''}
    ${c.filing ? `<p>Official filing: <b>${esc(c.filing.application_number)}</b> · ${esc(c.filing.filed_on)}</p>` : ''}
    ${c.completion ? `<p>Scheduled international publication date: <b>${esc(c.completion.publication_date)}</b>. The official notice is available under Documents.</p>` : ''}</section>
    ${nextAction(c)}${teamUpdates(c)}${caseNotifications(c)}${progress(s)}
    ${progressNote}${revision}
    ${c.filing ? card('Submission confirmed',`<p>The official ePCT receipt is available for ${esc(c.filing.application_number)}.</p>
      <ul>${c.documents.filter(d=>[...c.filing.receipt_ids,...c.filing.document_ids].includes(d.id)).map(d=>`<li>${linkDoc(c,d)}</li>`).join('')}</ul>`) : ''}
    ${c.isa ? card('International search result',`<p>Recorded ${esc(when(c.isa.received_at))} · ${esc(c.isa.reference)}</p>
      ${c.isa.deadline && !c.response ? `<p><strong>Official deadline</strong> <time datetime="${esc(c.isa.deadline.date)}">${esc(c.isa.deadline.date)}</time> · ${esc(c.isa.deadline.source)}</p>` : ''}
      <ul>${[['report_id','International Search Report (ISR)'],['written_opinion_id','Written Opinion (WO-ISA)']]
        .filter(([key])=>c.isa[key]).map(([key,label])=>`<li>${linkDoc(c,c.documents.find(d=>d.id===c.isa[key]),label)}</li>`).join('')}</ul>`,'case-isa') : ''}
    ${s.startsWith('pct_') || ['isa_wait','publication_wait','completion_due'].includes(s) ? card('Timing and next steps',
      `<p>Our filing package: typically 7–25 days once payment, filing details and prerequisites are complete. An agreed response or amendment: up to 7 days from receipt of the materials needed to act.</p>
      <p class="quiet">Time spent waiting for the ISA or official processing is separate. Filing deadlines follow the official notices for your case.</p>`) : ''}
    ${reportPdf ? card('Specialist prior-art report', `<p>${linkDoc(c,reportPdf,'Download encrypted report PDF')}</p>
      ${reportWord ? `<p>PDF opening password: <code>${esc(report.password)}</code></p><p>${linkDoc(c,reportWord,'Download report Word file')}</p>`
      : '<p>The opening password and Word file are unlocked when the final Stage 1 invoice is confirmed.</p>'}`) : ''}
    ${idea}
    ${c.quote ? renderQuote(c) : ''}
    ${s === 'pct_intake' ? renderFilingIntake() : ''}
    ${consent}
    ${c.filing_consent ? card('Filing authorization recorded',`<p>Signed by ${esc(c.filing_consent.signer)} · ${esc(when(c.filing_consent.signed_at))}</p><a href="${casePath(c.id)}/filing-consent/record">Download authorization record</a>`) : ''}
    ${renderInvoices(c)}
    ${meeting}
    ${card('Guide to your PCT case','<p>Watch the portal walkthrough and see how to respond to requests, follow team updates and track official processing.</p><a href="/patent/en/filing-guide/">Open the filing guide</a>')}
    ${upload}
    ${card('Documents', files ? '<ul>' + files + '</ul>' : '<p class="quiet">No files have been shared yet.</p>','case-documents')}
    ${card('Messages', `${c.messages.map(m=>`<div class="case-message" data-from="${m.actor==='team'?'team':'client'}"><small><b>${m.actor==='team'?'ResearchVault team':'You'}</b> · ${esc(when(m.at))}</small><p>${esc(m.body)}</p></div>`).join('')}
      <form id="message"><label>Message to the team<textarea name="body" required maxlength="2000"></textarea></label>${button('Send private message')}</form>`,'case-messages')}
    ${card('Case activity', timeline(c.events,caseEventText),'case-activity')}`;
}

function renderQuote(c) {
  const q = c.quote;
  return card('PCT service quote', `<p>Total professional fees: <b>${money(q.total)}</b>. Official fees and separately agreed purchases are additional.</p>
    <table><tbody><tr><th scope="row">At acceptance</th><td>${money(q.start)}</td></tr>
    <tr><th scope="row">Package ready, before filing</th><td>${money(q.ready)}</td></tr>
    <tr><th scope="row">After agreed services are complete and the official publication scheduling notice is available</th><td>${money(q.completion)}</td></tr></tbody></table>
    <div class="row"><button type="button" id="agreement-text" class="secondary">Read full agreement</button>
      <a href="${casePath(c.id)}/agreement/download">Download case Word copy</a>
      ${c.engagement ? `<a href="${casePath(c.id)}/agreement/signed">Download signed agreement</a>` : ''}</div>
    <div id="agreement-content" class="agreement-content" hidden tabindex="-1"></div>
    ${c.agreement_review?.note ? `<p>${esc(c.agreement_review.note)}</p>` : ''}
    ${c.stage === 'agreement_review' ? '<p>Your uploaded agreement is awaiting review.</p>' : ''}
    ${c.stage === 'quote_ready' ? `<form id="sign-agreement">
      <div class="grid">${txt('legal_name','Client or company legal name','maxlength="180" autocomplete="name"')}
        ${txt('role','Signing capacity','maxlength="120" placeholder="e.g. Individual applicant"')}
        ${txt('address','Postal address and country','maxlength="800" autocomplete="street-address"')}
        <label>Registration or identity reference (if required)<input name="registration" maxlength="160"></label></div>
      <div class="grid">${txt('signer','Type your full name as your signature','maxlength="180" autocomplete="name"')}
        <label>Verified email<input readonly value="${esc(user.email)}"></label></div>
      <details><summary>Sign and upload a copy instead</summary><p>Fill and sign the Word copy or its PDF equivalent, then attach it. This option is reviewed before the invoice opens.</p>
        <label>Signed Word or PDF<input type="file" name="signed_file" accept=".docx,.pdf"></label></details>
      ${check('accepted','I have read the case agreement and accept the exact fees above. My typed name and verified code confirm my signature or, if attached, my signed copy.')}
      <div class="row"><button type="button" id="agreement-code" class="secondary">Send signing code</button></div>
      <div id="agreement-verify" hidden>${txt('code','Verification code','pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" inputmode="numeric" disabled')}
      ${button('Sign and confirm agreement')}</div></form>` : c.engagement ? '<p>Quote and agreement accepted.</p>' : ''}`,'case-quote');
}

function renderFilingIntake() {
  return card('Filing details and ePCT access', `<p>Use your own WIPO account. We guide you in setting up access or sharing this application with the team through official ePCT access rights. Never send your ePCT password or codes.</p>
    <form id="identity"><label>Supporting identity document (only if requested)<input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg"></label>${button('Upload privately')}</form>
    <form id="filing"><div class="grid">${txt('legal_name','Legal name as on official identity document','maxlength="180" autocomplete="name"')}
    ${txt('country','Country','maxlength="80" autocomplete="country-name"')}
    <label>Postal code, if applicable<input name="postal_code" maxlength="32" autocomplete="postal-code"></label></div>
    ${txt('address','Full postal address','maxlength="1000" autocomplete="street-address"')}
    ${sel('role','Your role',[['applicant','Applicant'],['inventor_applicant','Inventor and applicant'],['authorized_representative','Authorized representative']])}
    ${sel('epct_access','WIPO account',[['existing','I have a WIPO account'],['needs_guidance','I need help setting up my WIPO account']])}
    ${check('epct_consent','I will grant the authorized team access to this case through ePCT or request help to set it up.')}
    ${button('Submit filing details')}</form>`);
}

function showCheckout(c,key,payment) {
  const details=$(`[data-checkout-details="${key}"]`), status=$(`[data-checkout-status="${key}"]`);
  if (activeCase!==c || !status) return;
  if (paymentCheck) paymentCheck.last=payment;
  if (payment.status==='paid') {
    status.textContent='Payment confirmed. Your case is being updated.';
    paymentCheck=null;
    void checkStatus();
    return;
  }
  if (details.hidden) {
    details.hidden=false;
    details.innerHTML=`<p>Send exactly <strong>${(payment.amount_cents/100).toFixed(2)} USDT</strong> on TRON (TRC20) to this invoice address.</p>
      <p><code class="checkout-address">${esc(payment.address)}</code></p>
      <p><button type="button" data-copy-payment="${key}" class="secondary">Copy address</button></p>
      <p class="quiet">The portal checks for confirmation automatically. You can close this page and return later.</p>`;
    onClick(`[data-copy-payment="${key}"]`, async button=>{
      await navigator.clipboard.writeText(payment.address);
      button.textContent='Address copied';
    });
  }
  status.textContent=payment.status==='review_required' ? 'A transfer needs review. Please wait for an update before sending another payment.'
    : 'Waiting for the transfer to be confirmed on TRON.';
}

async function checkPayment() {
  const check=paymentCheck;
  if (!check || check.busy || document.hidden || activeCase!==check.case) return;
  check.busy=true;
  try {
    const payment=await post(casePath(check.case.id)+'/checkout/check',{milestone:check.key});
    showCheckout(check.case,check.key,payment);
  } catch {
    // Keep the checkout address visible through a transient network error.
  } finally { check.busy=false; }
}

function bindCase(c) {
  onClick('#mark-case-notices-read', async () => {
    await post(casePath(c.id)+'/seen',{revision:c.revision});
    c.client_seen_revision=c.revision;
    $('#case-notifications')?.remove();
  });
  onClick('#refresh-case',async()=>{
    if(dirty && !window.confirm('Refresh the case? Any unsubmitted form edits will be lost.'))return;
    await refresh();
  });
  const root = casePath(c.id);
  for (const {key} of c.invoices) {
    onClick(`[data-checkout="${key}"]`,async()=>{
      const payment=await post(root+'/checkout',{milestone:key});
      paymentCheck={case:c,key,busy:false};
      showCheckout(c,key,payment);
      await checkPayment();
    });
  }
  const act = async payload => { await post(root + '/action', payload); await refresh(); };
  for (const form of document.querySelectorAll('[data-receipt]')) {
    const key = form.dataset.receipt;
    onForm(`[data-receipt="${key}"]`, data => act({ action: 'submit_receipt', milestone: key, method: 'usdt_trc20', reference: data.get('reference') }));
  }
  onForm('#disclosure', async (data, form) => {
    const files = data.getAll('files').filter(f => f.size);
    const desc = data.get('description').trim();
    if (desc) files.unshift(new File([desc], 'initial-description.txt', { type: 'text/plain' }));
    if (!files.length) throw new Error('Choose at least one file or add a description.');
    for (let i = 0; i < files.length; i++) {
      notice(`Uploading ${i + 1} of ${files.length}…`);
      try { await post(root + '/documents', fileForm('disclosure', files[i])); }
      catch (error) { throw new Error(`Uploaded ${i} of ${files.length}. ${error.message}`); }
    }
    form.reset(); await refresh(); notice('Your materials were uploaded privately.');
  });
  onForm('#idea', data => {
    const [source, candidate] = data.get('choice').split(':');
    return act({ action: 'choose_idea', source, candidate, description: data.get('description') });
  });
  onClick('#agreement-text', async () => {
    const {sections}=await api(root+'/agreement/text');
    const box=$('#agreement-content');
    box.innerHTML=sections.map(p=>{
      if(p.type==='table')return '<div class="agreement-table"><table><tbody>'+p.rows.map((r,i)=>'<tr>'+r.map(x=>`<${i?'td':'th'}>${esc(x)}</${i?'td':'th'}>`).join('')+'</tr>').join('')+'</tbody></table></div>';
      if(p.type==='provider_signature')return `<img class="signature-stamp" src="${root}/agreement/provider-signature" alt="Provider signature and fingerprint">`;
      return p.type==='heading'?`<h4>${esc(p.text)}</h4>`:`<p>${esc(p.text)}</p>`;
    }).join('');
    box.hidden=false;box.focus();
  });
  let challenge, schedule, signedUpload;
  onClick('#agreement-code', async () => {
    const form=$('#sign-agreement'), code=form.elements.code;
    code.disabled=true;
    if (!form.reportValidity()) { if(challenge)code.disabled=false; return; }
    schedule = await api(root + '/agreement');
    challenge = (await requestCode(user.email)).challenge_id;
    $('#agreement-verify').hidden = false;
    code.disabled=false;code.focus();
    notice('Signing code sent to your verified email.');
  });
  onForm('#sign-agreement', async data => {
    if (!challenge || !schedule) throw new Error('Request a new signing code before signing.');
    const file=data.get('signed_file');
    if(file?.size && (!signedUpload || signedUpload.file.name!==file.name || signedUpload.file.lastModified!==file.lastModified || signedUpload.file.size!==file.size)){
      signedUpload={file,doc:await post(root+'/documents',fileForm('signed_agreement',file))};
    }
    await act({ action:'accept_quote', quote_id:schedule.quote_id, schedule_sha256:schedule.schedule_sha256,
      challenge_id:challenge, code:data.get('code'), signer:data.get('signer'), legal_name:data.get('legal_name'),
      role:data.get('role'), address:data.get('address'), registration:data.get('registration'),
      accepted:true, ...(file?.size?{document_id:signedUpload.doc.id}:{}) });
  });
  onForm('#identity', async data => {
    await post(root + '/documents', fileForm('identity', data.get('file'))); await refresh(); notice('Identity document saved privately.');
  });
  onForm('#filing', data => act({ ...Object.fromEntries(data), epct_consent:true, action: 'filing_profile' }));
  const draft=c.drafts?.at(-1);
  let feedbackUpload=null;
  onForm('#draft-feedback',async data=>{
    const file=data.get('file');
    if(!feedbackUpload||feedbackUpload.name!==file.name||feedbackUpload.lastModified!==file.lastModified){
      feedbackUpload={name:file.name,lastModified:file.lastModified,doc:await post(root+'/documents',fileForm('pct_feedback',file))};
    }
    await act({action:'draft_feedback',draft_id:draft.document_id,feedback_id:feedbackUpload.doc.id,note:data.get('note')});
  });
  onForm('#draft-approve',()=>act({action:'approve_draft',draft_id:draft.document_id,confirmed:true}));
  onForm('#request-meeting',data=>act({action:'request_meeting',note:data.get('note')}));
  let filingCode, filingStatement;
  if($('#filing-consent')){
    api(root+'/filing-consent').then(a=>{
      filingStatement=a;$('#consent-statement').textContent=a.text+' Package: '+a.final_name+' · SHA-256: '+a.final_sha256;
    }).catch(e=>notice(e.message,true));
  }
  onClick('#consent-code',async()=>{
    const form=$('#filing-consent'),code=form.elements.code;
    code.disabled=true;
    if(!form.reportValidity()){if(filingCode)code.disabled=false;return;}
    filingStatement=await api(root+'/filing-consent');
    filingCode=(await requestCode(user.email)).challenge_id;
    $('#consent-verify').hidden=false;code.disabled=false;code.focus();notice('Final signing code sent.');
  });
  onForm('#filing-consent',data=>{
    if(!filingCode||!filingStatement)throw new Error('Request the signing code first.');
    return act({action:'authorize_filing',accepted:true,signer:data.get('signer'),code:data.get('code'),
      challenge_id:filingCode,consent_sha256:filingStatement.consent_sha256,final_sha256:filingStatement.final_sha256});
  });
  onForm('#message', data => act({ action: 'message', body: data.get('body') }));
}

async function refresh() {
  const [doc, list] = await Promise.all([api(ROOT + '/undertaking'), api(ROOT + '/cases')]);
  if (!doc.accepted && !list.cases.length) return renderUndertaking(doc);
  const q = new URLSearchParams(location.search);
  const id = q.get('new') ? null : q.get('case') || list.cases[0]?.id;
  const chosen = list.cases.find(c => c.id === id);
  const c = chosen ? await api(casePath(id)) : null;
  activeCase=c;dirty=false;
  clockSample=Number.isSafeInteger(c?.server_now)?{server:c.server_now,local:performance.now()}:null;
  const sidebar = `<aside class="card case-list"><h2>My cases</h2><a href="${PATH}?new=1">+ New PCT case</a>
    ${list.cases.map(x => `<a href="${PATH}?case=${x.id}"${x.id === id ? ' aria-current="page"' : ''}>${esc(x.title)}<br><small>${esc(x.public_ref)}</small></a>`).join('')}</aside>`;
  set(`<div class="layout">${sidebar}<div class="stack">${c ? renderCase(c)
    : (!doc.accepted ? '<div id="renew-nda"></div>' : renderNew(doc, list.outstanding_balance))}</div></div>`);
  if (!c && !doc.accepted) return renderUndertaking(doc);
  if (c) {
    bindCase(c); updateClocks();
    if (paymentCheck?.case.id===c.id && c.invoices.some(i=>i.key===paymentCheck.key && i.status==='issued')) {
      paymentCheck={...paymentCheck,case:c,busy:false};
      if (paymentCheck.last) showCheckout(c,paymentCheck.key,paymentCheck.last);
    } else {
      paymentCheck=null;
    }
  }
  const requestId = crypto.randomUUID();
  onForm('#new-case', async data => {
    const result = await post(ROOT + '/cases', { ...Object.fromEntries(data), accepted: true,
      order_version: doc.order_version, request_id: requestId });
    history.replaceState({}, '', PATH + '?case=' + result.id);
    await refresh();
  });
}

document.addEventListener('input',event=>{
  if(activeCase && event.target.closest?.('#app form'))dirty=true;
});
document.addEventListener('change',event=>{
  if(activeCase && event.target.closest?.('#app form'))dirty=true;
});
async function checkStatus() {
  if(!activeCase||checking||document.hidden)return;
  const current=activeCase;
  checking=true;
  try {
    const next=await api(casePath(current.id)+'/status');
    if(activeCase!==current) return;
    if (next.revision===current.revision) {
      if (next.client_seen_revision>=current.revision) $('#case-notifications')?.remove();
      return;
    }
    if(dirty || $('#app button:disabled:not([hidden])')){
      const note=$('#status-update');
      if(note && note.firstChild)note.firstChild.textContent='A case update is ready. Submit your form or refresh. ';
    }else await refresh();
  }catch{/* preserve the current case during transient network errors */}
  finally{checking=false;}
}
setInterval(checkStatus,12000);
setInterval(checkPayment,15000);
const updateClocks=()=>{if(!document.hidden && clockSample)tickClocks(clockSample.server+(performance.now()-clockSample.local)/1000);};
setInterval(updateClocks,15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateClocks();checkStatus();}});

async function open(u) {
  user = u;
  $('#sign-out').hidden = false;
  await refresh();
}

onClick('#sign-out', async () => { await post('/api/pct/auth/logout', {}); location.assign(PATH); });
(async () => {
  const status = await api(ROOT + '/status');
  if (!status?.enabled) return set(card('PCT applications are currently paused', '<a href="/patent/en/dashboard/">Open your case dashboard</a>'));
  testMode = status.test_mode === true;
  try { await open(await session(true)); }
  catch (error) { if (error.status !== 401) throw error; login(open, '', await api(ROOT+'/auth/options')); }
})().catch(error => { set(card('Unable to open the portal', '<p>Try reloading this page.</p>')); notice(error.message, true); });
