import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { PDFDocument } from 'pdf-lib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { putObject } from '../src/files.js';
import { sha256Hex } from '../../patent-api/src/security.js';
import { deliverPctNotices } from '../src/notifications.js';
import { initialState, quoteBreakdown } from '../src/state.js';
import { caseById, createCase } from '../src/repository.js';
import { checkCheckout, openCheckout, reconcileCheckout, tronAddressHex } from '../src/usdt.js';
import { confirmWipe, lockCaseUpload, unlockCaseUpload } from '../src/wipe.js';
import { claimNotification, acknowledgeNotification } from '../src/repository.js';
import { UPDATE_WINDOW, NOTICE_LEAD } from '../src/team-updates.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here,'../..');
const ORIGIN='http://127.0.0.1:9072';
const PROD='https://researchvault-patent.pages.dev';
const INTERNAL='https://pct-internal.invalid/internal/pct/';
const ACTOR='77777';
const ADMIN='admin@example.test';
const USER='inventor@example.test';
const OTHER='other@example.test';
const PASS='Test-Report!2468';
const key='c1'.repeat(32);
const testConfig={ ENVIRONMENT:'test', PCT_ORIGIN:ORIGIN, PCT_ISOLATED_TEST:'true', PCT_FILE_KEY:key, PCT_TELEGRAM_ADMIN_IDS:ACTOR,PCT_AUTH_PEPPER:'test-pepper-for-isolated-accounts-only-123',PCT_PASSWORD_ENABLED:'true' };
const opts = { compatibilityDate:'2025-07-18' };
const bytes = name => readFile(path.join(here,'fixtures',name));
const X = t=>strToU8(t);
function makeDocx() {
  const keys = ['CASE_REF','QUOTE_ID','ISSUE_DATE','PCT_TOTAL','PCT_START','PCT_READY','PCT_COMPLETION',
    'CLIENT_NAME','CLIENT_ROLE','CLIENT_ADDRESS','CLIENT_EMAIL','CLIENT_REGISTRATION','CLIENT_SIGNATURE','CLIENT_DATE'];
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+
    keys.map(k=>'<w:p><w:r><w:t>{{'+k+'}}</w:t></w:r></w:p>').join('')+'</w:body></w:document>';
  return zipSync({'[Content_Types].xml': X('<Types/>'), 'word/document.xml':X(xml),
    'word/media/image1.png':Uint8Array.of(137,80,78,71,13,10,26,10)});
}
async function plainPdf() {
  const pdf=await PDFDocument.create(), page=pdf.addPage();
  page.drawText('Synthetic fixture only - no official or personal data');
  return pdf.save();
}
async function sampleUndertaking() {
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  pdf.setTitle('SAMPLE - Confidentiality Undertaking');
  page.drawText('SAMPLE - NOT FOR CLIENT USE', { x: 52, y: 775, size: 20 });
  page.drawText('Confidentiality Undertaking - Workflow Test', { x: 52, y: 737, size: 16 });
  page.drawText('The fictional provider will keep synthetic invention materials private.\n' +
    'Materials are used only to validate the review and consent flow.\n' +
    'This sample contains no actual signature, customer or legal commitment.',
    { x: 52, y: 701, size: 11, lineHeight: 19 });
  return pdf.save();
}
const bundle=async entry=>(await build({entryPoints:[path.join(root,entry)],bundle:true,format:'esm',
  platform:'browser',write:false,logLevel:'error'})).outputFiles[0].text;
const module=(name,contents,extra={})=>({name,...opts,modules:[{type:'ESModule',path:name+'.mjs',contents}],...extra});
async function schema(db, sql) {
  const statements=sql.replace(/^\s*--[^\n]*$/gm,'').trim().split(/;\s*(?=(?:CREATE|PRAGMA|ALTER|$))/).map(s=>s.trim()).filter(Boolean);
  await db.batch(statements.map(s=>db.prepare(s)));
}
function readJson(res) { return res.json().catch(()=>null); }

test('quote boundaries and instalments use cents with the agreed cap', () => {
  for (const [price,start,ready,final] of [[350000,119000,178500,52500],[500000,170000,255000,75000],[550000,190000,285000,75000],[500011,170004,255007,75000]]) {
    assert.deepEqual(quoteBreakdown(price),{total:price,start,ready,completion:final,currency:'USD'});
  }
  assert.throws(()=>quoteBreakdown(349999));
  assert.throws(()=>quoteBreakdown(550001));
});

test('real Workers: isolated email OTP, signed contract, document gates, ISA and final settlement', {timeout:55000}, async t=>{
  const [workflow,auth,sql,authSql,pdf,ndaPdf,locked,empty,video]=await Promise.all([
    bundle('pct-workflow/src/index.js'),bundle('patent-api/src/index-b2.js'),
    readFile(path.join(root,'pct-workflow/migrations/0001_workflow.sql'),'utf8'),
    readFile(path.join(root,'patent-api/migrations/0001_init.sql'),'utf8'),
    plainPdf(),sampleUndertaking(),bytes('locked-report.pdf'),bytes('permissions-only.pdf'),bytes('sample.mp4'),
  ]);
  const docx=makeDocx(), mail=new Map();
  const vars={...testConfig, PCT_WIPE_ENABLED:'true', PCT_UNDERTAKING_KEY:'pct-workflow/legal/sample-undertaking.pdf',PCT_UNDERTAKING_VERSION:'SAMPLE-1',
    PCT_UNDERTAKING_SHA256:await sha256Hex(ndaPdf), PCT_AGREEMENT_KEY:'pct-workflow/legal/test-agreement.docx',
    PCT_AGREEMENT_VERSION:'TEST-PCT-3', PCT_AGREEMENT_SHA256:await sha256Hex(docx)};
  const edge=`export default {fetch(req,env){const p=new URL(req.url).pathname;
    return p.startsWith('/api/pct/')||p.startsWith('/internal/pct/')?env.PCT.fetch(req):env.AUTH.fetch(req)}}`;
  const prod = {...vars,ENVIRONMENT:'production',PCT_ORIGIN:PROD,PCT_ENABLED:'true',PCT_ISOLATED_TEST:'false'};
  const productionDocs={PCT_UNDERTAKING_KEY:'pct-workflow/legal/undertaking.pdf',PCT_UNDERTAKING_VERSION:'RV-NDA-1',
    PCT_AGREEMENT_KEY:'pct-workflow/legal/agreement.docx',PCT_AGREEMENT_VERSION:'RV-PCT-3'};
  const mf=new Miniflare({workers:[
    module('edge',edge,{serviceBindings:{PCT:'pct',AUTH:'auth'}}),
    module('pct',workflow,{d1Databases:{PCT_DB:'test-cases'},r2Buckets:{PCT_STORE:'test-files'},serviceBindings:{PATENT_API:'auth'},bindings:vars}),
    module('prod-guard',workflow,{d1Databases:{PCT_DB:'test-cases'},r2Buckets:{PCT_STORE:'test-files'},serviceBindings:{PATENT_API:'auth'},
      bindings:{...prod,...productionDocs}}),
    module('prod-off',workflow,{d1Databases:{PCT_DB:'test-cases'},r2Buckets:{PCT_STORE:'test-files'},serviceBindings:{PATENT_API:'auth'},
      bindings:{...prod,...productionDocs,PCT_ENABLED:'false',PCT_WIPE_ENABLED:'false'}}),
    module('prod-wipe-off',workflow,{d1Databases:{PCT_DB:'test-cases'},r2Buckets:{PCT_STORE:'test-files'},serviceBindings:{PATENT_API:'auth'},
      bindings:{...prod,...productionDocs,PCT_ENABLED:'false',PCT_WIPE_ENABLED:'true'}}),
    module('prod-sample',workflow,{d1Databases:{PCT_DB:'test-cases'},r2Buckets:{PCT_STORE:'test-files'},serviceBindings:{PATENT_API:'auth'},bindings:prod}),
    module('auth',auth,{d1Databases:{DB:'test-identity'},bindings:{ENVIRONMENT:'test',ADMIN_EMAILS:ADMIN,OTP_PEPPER:'test-otp-pepper',
      SESSION_PEPPER:'test-session-pepper',RESEND_API_KEY:'test-key'},outboundService:async req=>{
        assert.equal(req.url,'https://api.resend.com/emails');
        const b=await req.json(), email=b.to[0];
        assert.ok(email.endsWith('@example.test'));
        mail.set(email,b.html.match(/>(\d{6})<\//)[1]);
        return Response.json({id:'synthetic-delivery'});
      }}),
  ]});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('PCT_DB','pct');
  await schema(db,sql);
  await schema(db,await readFile(path.join(root,'pct-workflow/migrations/0002_accounts.sql'),'utf8'));
  await schema(db,await readFile(path.join(root,'pct-workflow/migrations/0003_filing_consent_evidence.sql'),'utf8'));
  await schema(db,await readFile(path.join(root,'pct-workflow/migrations/0004_case_wipe.sql'),'utf8'));
  await schema(db,await readFile(path.join(root,'pct-workflow/migrations/0005_team_updates.sql'),'utf8'));
  await schema(db,await readFile(path.join(root,'pct-workflow/migrations/0006_usdt_checkouts.sql'),'utf8'));
  await schema(db,await readFile(path.join(root,'pct-workflow/migrations/0007_admin_publications.sql'),'utf8'));
  await schema(db,await readFile(path.join(root,'pct-workflow/migrations/0008_usdt_payment_references.sql'),'utf8'));
  const identityDb=await mf.getD1Database('DB','auth');
  await schema(identityDb,authSql);
  const files=await mf.getR2Bucket('PCT_STORE','pct');
  await putObject({PCT_STORE:files,PCT_FILE_KEY:key},vars.PCT_UNDERTAKING_KEY,ndaPdf);
  await putObject({PCT_STORE:files,PCT_FILE_KEY:key},vars.PCT_AGREEMENT_KEY,docx);

  async function req(p,{method='GET',cookie,body,grant,expected=200,raw=false,origin=ORIGIN,worker}={}){
    const h={...(cookie?{cookie}:{}),...(grant?{'x-pct-admin-link':grant}:{}),...(method==='POST'?{origin}:{}),
      ...(body && !(body instanceof FormData)?{'content-type':'application/json'}:{})};
    const init={method,headers:h,body:body instanceof FormData?body:body?JSON.stringify(body):undefined};
    const res=worker?await worker.fetch(origin+p,init):await mf.dispatchFetch(origin+p,init);
    assert.equal(res.status,expected,p+': '+(res.status===expected?'':await res.clone().text()));
    return raw?res:readJson(res);
  }
  const post=(p,body,cookie,extra={})=>req(p,{method:'POST',body,cookie,...extra});
  async function otp(email,cookie) {
    const v=await post('/api/auth/request-otp',{destination:email,channel:'email'},cookie);
    return {challenge_id:v.challenge_id,code:mail.get(email)};
  }
  async function login(email) {
    const r=await post('/api/auth/verify-otp',await otp(email),null,{raw:true});
    const cookie=r.headers.get('set-cookie').split(';')[0];
    assert.ok(cookie.startsWith('patent_session='));
    await r.text();
    return cookie;
  }
  async function bot(route,body={},actor=ACTOR,expected=200,worker=mf) {
    const init={method:'POST',headers:{'x-pct-telegram-actor':actor,'content-type':'application/json'},body:JSON.stringify(body)};
    const res=await (worker===mf?mf.dispatchFetch(INTERNAL+route,init):worker.fetch(INTERNAL+route,init));
    assert.equal(res.status,expected,route+': '+(res.status===expected?'':await res.clone().text()));
    return res.json();
  }
  async function grantCase(id,admin) {
    const link=await bot('link',{case_id:id});
    const grant=new URL(link.url).hash.slice(1);
    await post('/api/pct/admin/redeem',{token:grant},admin);
    await post('/api/pct/admin/redeem',{token:grant},admin,{expected:403});
    return grant;
  }
  const upload=(p,cookie,category,name,buffer,grant,password,expected=201)=>{
    const body=new FormData();
    body.append('category',category);body.append('file',new Blob([buffer]),name);
    if(password)body.append('password',password);
    return post(p,body,cookie,{grant,expected});
  };
  const status=await req('/api/pct/status');
  assert.deepEqual(status,{enabled:true,test_mode:true});
  const productionSample=await mf.getWorker('prod-sample');
  const productionOff=await mf.getWorker('prod-off');
  assert.deepEqual(await req('/api/pct/status',{worker:productionSample,origin:PROD}),{enabled:false});
  assert.deepEqual(await req('/api/pct/status',{worker:productionOff,origin:PROD}),{enabled:false});
  assert.deepEqual(await bot('list',{},ACTOR,200,productionOff),{cases:[],more:false,enrollment_open:false});
  await bot('list',{},'10000',403,productionOff);
  await bot('action',{action:'start_drafting'},ACTOR,503,productionOff);
  await bot('link',{},ACTOR,503,productionOff);
  await req('/api/pct/undertaking/pdf',{worker:productionSample,origin:PROD,expected:503});
  await req('/api/pct/cases',{expected:401});
  await req('/api/pct/undertaking/pdf',{expected:401});
  const client=await login(USER), admin=await login(ADMIN), other=await login(OTHER);
  const nda=await req('/api/pct/undertaking',{cookie:client});
  assert.equal(nda.version,'SAMPLE-1');
  assert.equal(nda.accepted,false);
  const start = {request_id:'synthetic-case-first-001',title:'Synthetic actuator patent',name:'Test Inventor',country:'Canada',
    order_version:nda.order_version,accepted:true};
  await post('/api/pct/cases',start,client,{expected:403});
  const ndadownload=await req('/api/pct/undertaking/pdf',{cookie:client,raw:true});
  const ndaBytes=await ndadownload.arrayBuffer();
  assert.equal(await sha256Hex(ndaBytes),nda.sha256);
  assert.equal((await PDFDocument.load(ndaBytes)).getTitle(),'SAMPLE - Confidentiality Undertaking');
  await post('/api/pct/undertaking',{accepted:true,version:nda.version,sha256:'bad'},client,{expected:422});
  await post('/api/pct/undertaking',{accepted:true,version:nda.version,sha256:nda.sha256},client);
  assert.equal((await req('/api/pct/undertaking',{cookie:client})).accepted,true);
  assert.deepEqual(await req('/api/pct/auth/options'),{google:false,password:true});
  const before=(await req('/api/pct/auth/me',{cookie:client})).user;
  const password='Synthetic-Only-Password-525!';
  const saved=await post('/api/pct/auth/password/set',{email:USER,password,...await otp(USER,client)},null,{raw:true});
  const savedCookie=saved.headers.get('set-cookie').split(';')[0];await saved.text();
  assert.equal((await req('/api/pct/auth/me',{cookie:savedCookie})).user.id,before.id);
  await post('/api/pct/auth/password/login',{email:USER,password:'Incorrect synthetic password'},null,{expected:401});
  const pwdResponse=await post('/api/pct/auth/password/login',{email:USER,password},null,{raw:true});
  const pwdCookie=pwdResponse.headers.get('set-cookie').split(';')[0];await pwdResponse.text();
  assert.equal((await req('/api/pct/auth/me',{cookie:pwdCookie})).user.id,before.id);
  const credential=await db.prepare('SELECT password_hash,password_salt FROM pct_accounts WHERE id=?').bind(before.id).first();
  assert.ok(credential.password_salt && credential.password_hash && credential.password_hash!==password);
  await bot('list',{},'10000',403);
  await req('/api/pct/cases',{cookie:client,origin:PROD,expected:404});

  async function firstSteps(request_id, choice='original', checkFiles=false) {
    const c=await post('/api/pct/cases',{...start,request_id},client,{expected:201}), id=c.id;
    const C='/api/pct/cases/'+id, M='/api/pct/admin/cases/'+id;
    const g=await grantCase(id,admin);
    const act=(action,fields={},expected=200)=>post(M+'/action',{action,...fields},admin,{grant:g,expected});
    const customer=(action,fields={},expected=200)=>post(C+'/action',{action,...fields},client,{expected});
    const read=()=>req(C,{cookie:client});
    const pay=milestone=>act('simulate_payment',{milestone});
    const file=(category,name,buf,password,expected=201)=>upload(M+'/documents',admin,category,name,buf,g,password,expected);
    assert.equal(c.stage,'consultation_payment');
    if(checkFiles) {
      assert.equal((await post('/api/pct/cases',{...start,request_id},client,{expected:201})).id,id);
      await req(C,{cookie:other,expected:404});
      await req(M,{cookie:client,grant:g,expected:403});
      await req(M,{cookie:admin,expected:403});
      await upload(C+'/documents',client,'disclosure','draft.docx',docx);
      await upload(C+'/documents',client,'disclosure','test.mp4',video);
      await customer('submit_receipt',{milestone:'consultation',method:'usdt_trc20',reference:'b'.repeat(64)});
      assert.equal((await read()).invoices[0].receipt_pending,true);
      assert.equal((await read()).stage,'consultation_payment');
      const prodWorker=await mf.getWorker('prod-guard');
      await post(M+'/action',{action:'simulate_payment',milestone:'consultation'},admin,
        {worker:prodWorker,origin:PROD,grant:g,expected:403});
    }
    assert.equal((await pay('consultation')).meeting.status,'requested');
    await pay('consultation');
    await bot('action',{case_id:id,action:'authorize_report',meeting_completed:true});
    assert.equal((await pay('report_start')).stage,'report_work');
    if(checkFiles) {
      await file('report_pdf','unlocked.pdf',pdf,PASS,422);
      await file('report_pdf','permissions.pdf',empty,PASS,422);
      await file('report_pdf','bad-password.pdf',locked,'Wrong-Password!000',422);
    }
    const lock=await file('report_pdf','locked.pdf',locked,PASS), word=await file('report_docx','report.docx',docx);
    await act('publish_report',{pdf_id:lock.id,word_id:word.id,candidates:['C2'],reviewed:true});
    assert.equal((await read()).report.password,undefined);
    assert.equal((await read()).documents.some(d=>d.id===word.id),false);
    await req(C+'/documents/'+word.id,{cookie:client,expected:404});
    assert.ok((await (await req(C+'/documents/'+lock.id,{cookie:client,raw:true})).arrayBuffer()).byteLength);
    await pay('report_release');
    assert.equal((await read()).report.password,PASS);
    assert.equal((await read()).invoices.filter(i=>i.non_refundable).reduce((a,i)=>a+i.amount_cents,0),111100);
    await customer('choose_idea',{source:choice,candidate:'C2',description:'The final invention includes this actuator arrangement.'});
    if(choice==='team') {
      await act('decide_idea',{accepted:true},422);
      await act('decide_idea',{accepted:true,rights_ref:'Private idea sale reference 1'});
    } else {
      const current=await bot('case',{case_id:id});
      await bot('action',{case_id:id,action:'decide_idea',accepted:true,revision:current.revision-1},ACTOR,409);
      const note='We can proceed with this synthetic invention.';
      if (process.env.PCT_BOT_ADMIN_MODULE) {
        const { handlePctAdminUpdate }=await import(pathToFileURL(path.resolve(root,process.env.PCT_BOT_ADMIN_MODULE)).href);
        const messages=[], chat={id:Number(ACTOR),type:'private'}, from={id:Number(ACTOR)};
        const tgEnv={PCT_WORKFLOW_ENABLED:'true',TELEGRAM_WEBHOOK_SECRET:'local-test',PCT_WORKFLOW:{fetch:async r=>mf.dispatchFetch(r.url,{
          method:r.method,headers:Object.fromEntries(r.headers),body:await r.text(),
        })}};
        const options={adminId:ACTOR,telegramVerified:true,telegramApi:async(_env,method,payload)=>{
          if(method==='sendMessage')messages.push(payload);
        }};
        const callback=(data,text)=>handlePctAdminUpdate(tgEnv,{callback_query:{data,from,message:{chat,from:{is_bot:true},text}}},options);
        await callback('p2:reason:'+id+':a');
        assert.match(messages.at(-1)?.text,/^\[PCT decision /);
        await handlePctAdminUpdate(tgEnv,{message:{text:note,chat,from,reply_to_message:{from:{is_bot:true},text:messages.at(-1).text}}},options);
        assert.equal((await read()).stage,'idea_review');
        const preview=messages.at(-1);
        await callback(preview.reply_markup.inline_keyboard[0][0].callback_data,preview.text);
        assert.match(messages.at(-1).text,/5000/);
      } else await bot('action',{case_id:id,action:'decide_idea',accepted:true,revision:current.revision,note});
      assert.equal((await read()).decision.note,note);
    }
    const preview=await bot('quote-preview',{case_id:id,total_cents:500000});
    await bot('action',{case_id:id,action:'quote',revision:preview.revision,total_cents:500000});
    const terms=await req(C+'/agreement',{cookie:client});
    const issued=await req(C+'/agreement/download',{cookie:client,raw:true});
    assert.match(strFromU8(unzipSync(new Uint8Array(await issued.arrayBuffer()))['word/document.xml']),/2,550.00/);
    const text=await req(C+'/agreement/text',{cookie:client});
    assert.ok(text.sections.some(s=>s.text==='750.00'));
    await req(C+'/agreement/provider-signature',{cookie:other,expected:404});
    const signer={quote_id:terms.quote_id,schedule_sha256:terms.schedule_sha256,accepted:true,signer:'Test Inventor',
      legal_name:'Test Inventor',role:'Inventor and applicant',address:'123 Test Street, Toronto, Canada'};
    if(choice==='team'){
      const signed=await upload(C+'/documents',client,'signed_agreement','signed-copy.pdf',pdf);
      const submitted=await customer('accept_quote',{...signer,...await otp(USER,client),document_id:signed.id});
      assert.equal(submitted.stage,'agreement_review');assert.equal(submitted.invoices.some(i=>i.key==='pct_start'),false);
      await act('review_agreement',{accepted:true,matches_quote:true});
    }else{
      assert.equal((await customer('accept_quote',{...signer,...await otp(USER,client)})).engagement.mode,'electronic');
      const signed=await req(C+'/agreement/signed',{cookie:client,raw:true});
      assert.match(strFromU8(unzipSync(new Uint8Array(await signed.arrayBuffer()))['word/document.xml']),/Test Inventor/);
    }
    await pay('pct_start');
    const profile={legal_name:'Test Inventor',address:'123 Test Street',country:'Canada',postal_code:'M5V 3A8',
      role:'inventor_applicant',epct_access:'needs_guidance',epct_consent:true};
    await customer('filing_profile',{...profile,epct_password:'should not be recorded'},422);
    assert.equal((await customer('filing_profile',profile)).stage,'pct_start_pending');
    await bot('action',{case_id:id,action:'start_drafting'});
    const v1=await file('pct_draft','draft-v1.docx',docx);
    await req(C+'/documents/'+v1.id,{cookie:client,expected:404});
    if (checkFiles) {
      const before=await bot('case',{case_id:id});
      const draft={action:'publish_draft',document_id:v1.id,reviewed:true,revision:before.revision};
      const focused=await bot('link',{case_id:id,task:'stage'});
      assert.match(focused.url,/\?task=stage#[a-f0-9]{48}$/);
      await post(M+'/prepare',draft,admin,{grant:g});
      const first=(await bot('case',{case_id:id})).prepared_publication;
      assert.equal(first.action,'publish_draft');
      await post(M+'/prepare',{...draft,note:'Reviewed final wording.'},admin,{grant:g});
      const final=(await bot('case',{case_id:id})).prepared_publication;
      await bot('action',{case_id:id,action:'publish_prepared',revision:before.revision,nonce:first.nonce},ACTOR,409);
      assert.equal((await read()).stage,'pct_drafting');
      await bot('action',{case_id:id,action:'publish_prepared',revision:before.revision,nonce:final.nonce});
      assert.equal((await read()).drafts[0].note,'Reviewed final wording.');
    } else {
      await act('publish_draft',{document_id:v1.id,reviewed:true});
    }
    assert.equal((await read()).drafts[0].version,'1.0');
    const feedback=await upload(C+'/documents',client,'pct_feedback','v1-comments.docx',docx);
    assert.equal((await customer('draft_feedback',{draft_id:v1.id,feedback_id:feedback.id,note:'Please improve claim 2.'})).stage,'pct_draft_revision');
    const meeting=await customer('request_meeting',{note:'Review the claim with us.'});
    await customer('request_meeting',{},409);
    await act('ack_meeting',{meeting_id:meeting.meeting_requests[0].id,note:'We will contact you.'});
    const v2=await file('pct_draft','draft-v2.docx',docx);
    await act('publish_draft',{document_id:v2.id,reviewed:true,note:'Second revision.'});
    await customer('approve_draft',{draft_id:v1.id,confirmed:true},409);
    assert.equal((await customer('approve_draft',{draft_id:v2.id,confirmed:true})).draft_approval.version,'2.0');
    const rev=await file('package_review','review.pdf',pdf), final=await file('package_final','final.docx',docx);
    await act('package_ready',{review_id:rev.id,final_id:final.id,reviewed:true});
    await req(C+'/documents/'+final.id,{cookie:client,expected:404});
    await req(C+'/documents/'+rev.id,{cookie:client,expected:404});
    await req(C+'/filing-consent',{cookie:client,expected:409});
    assert.equal((await pay('pct_ready')).stage,'pct_filing_consent');
    assert.ok((await (await req(C+'/documents/'+rev.id,{cookie:client,raw:true})).arrayBuffer()).byteLength);
    await req(C+'/documents/'+final.id,{cookie:client,expected:404});
    await bot('action',{case_id:id,action:'start_submission',official_access:true,authorization_on_file:true},ACTOR,409);
    const consent=await req(C+'/filing-consent',{cookie:client});
    await customer('authorize_filing',{accepted:true,signer:'Test Inventor',consent_sha256:'bad',final_sha256:consent.final_sha256},409);
    // The filing consent follows draft review on a later day.
    await identityDb.prepare('UPDATE patent_otp_challenges SET created_at=created_at-3600 WHERE destination=?').bind(USER).run();
    const code=await otp(USER,client);
    const signedConsent={accepted:true,signer:'Test Inventor',consent_sha256:consent.consent_sha256,final_sha256:consent.final_sha256,...code};
    assert.equal((await customer('authorize_filing',signedConsent)).stage,'pct_authorized');
    await customer('authorize_filing',signedConsent,409);
    const evidence=await req(C+'/filing-consent/record',{cookie:client,raw:true});
    assert.match(await evidence.text(),/Draft: v2.0/);
    assert.ok((await (await req(C+'/documents/'+final.id,{cookie:client,raw:true})).arrayBuffer()).byteLength);
    await bot('action',{case_id:id,action:'start_submission',official_access:true,authorization_on_file:true});
    assert.equal((await read()).stage,'pct_submitting');
    const receipt=await file('filing_receipt','epct-receipt.pdf',pdf), filed=await file('filed_document','filed-package.docx',docx);
    await req(C+'/documents/'+receipt.id,{cookie:client,expected:404});
    const filingDate=new Date().toISOString().slice(0,10);
    await act('filed',{application_number:'PCT/CA2026/000001',filed_on:filingDate,fees_confirmed:true},422);
    await act('filed',{application_number:'PCT/CA2026/000001',filed_on:filingDate,fees_confirmed:true,
      receipt_ids:[receipt.id],document_ids:[filed.id]});
    const official=await req(C+'/documents/'+receipt.id,{cookie:client,raw:true});
    assert.equal(await sha256Hex(await official.arrayBuffer()),await sha256Hex(pdf));
    assert.equal((await read()).stage,'isa_wait');
    assert.deepEqual((await read()).team_updates,[]);
    const report=await file('isa_report','search-report.pdf',pdf);
    const opinion=await file('isa_written_opinion','written-opinion.pdf',pdf);
    await req(C+'/documents/'+report.id,{cookie:client,expected:404});
    await act('isa_received',{reference:'Synthetic ISA notice',response_needed:true,report_id:report.id,
      written_opinion_id:opinion.id,official_due_on:filingDate,official_due_source:'Synthetic official notice'});
    const searched=await read();
    assert.equal(searched.team_updates[0].kind,'isa_response');
    assert.equal(searched.isa.deadline.date,filingDate);
    assert.ok(searched.documents.some(d=>d.id===opinion.id));
    assert.ok(searched.events.some(e=>e.event_type==='isa_received' && e.revision>searched.client_seen_revision));
    await post(C+'/seen',{revision:searched.revision+1},client,{expected:422});
    await post(C+'/seen',{revision:searched.revision},client);
    assert.equal((await read()).client_seen_revision,searched.revision);
    await act('response_done',{reference:'Synthetic response'});
    const notice=await file('publication_notice','notice.pdf',pdf);
    await act('complete',{document_id:notice.id,reference:'Synthetic notice reference',publication_date:filingDate,
      official_confirmed:true,work_complete:true});
    assert.equal((await read()).stage,'completion_due');
    assert.equal((await read()).invoices.find(i=>i.key==='pct_completion').amount_cents,75000);
    await post('/api/pct/cases',{...start,request_id:request_id+'-blocked'},client,{expected:409});
    return {read,act,pay,id,C,M,g};
  }

  const settled=await firstSteps(start.request_id,'original',true);
  assert.equal((await settled.pay('pct_completion')).stage,'completed');
  assert.equal((await req(settled.C,{cookie:pwdCookie})).stage,'completed');
  // The second synthetic case represents a later session outside the OTP rate window.
  await identityDb.prepare('UPDATE patent_otp_challenges SET created_at=created_at-3600 WHERE destination=?').bind(USER).run();
  const waived=await firstSteps('synthetic-case-second-002','team');
  assert.equal((await bot('case',{case_id:waived.id})).can_waive_completion,true);
  const waivedResult=await waived.act('waive_completion',{reason:'Synthetic settlement confirmed with test client.',agreed:true});
  assert.equal(waivedResult.stage,'closed_by_agreement');
  assert.equal(waivedResult.invoices.find(i=>i.key==='pct_completion').status,'waived');
  assert.equal((await req('/api/pct/cases',{cookie:client})).outstanding_balance,null);
  assert.equal((await post('/api/pct/cases',{...start,request_id:'synthetic-after-closure-003'},client,{expected:201})).stage,'consultation_payment');
  const counts=await db.prepare("SELECT count(*) AS n FROM pct_verified_payment_refs").first();
  assert.equal(counts.n,0);
  const notify=await bot('notification');
  assert.ok(notify.notification);
  assert.equal((await bot('notification-ack',{id:notify.notification.id,lease:notify.notification.lease})).ok,true);
  let noticePayload;
  const notificationEnv={PCT_DB:db,ENVIRONMENT:'production',PCT_ENABLED:'true',
    PCT_TELEGRAM_ADMIN_IDS:ACTOR,PCT_NOTIFY_CHAT_ID:ACTOR,PCT_TELEGRAM_NOTIFY_TOKEN:'123456:synthetic_test_token_only'};
  assert.equal(await deliverPctNotices({...notificationEnv,ENVIRONMENT:'test'},async()=>{throw new Error('No Telegram in tests');}),0);
  assert.equal(await deliverPctNotices(notificationEnv,async (_url,init)=>{
    noticePayload=JSON.parse(init.body);
    return Response.json({ok:true,result:{message_id:1}});
  },1),1);
  assert.equal(noticePayload.chat_id,ACTOR);
  assert.match(noticePayload.reply_markup.inline_keyboard[0][0].callback_data,/^p2:case:pct_/);
  assert.ok(!JSON.stringify(noticePayload).includes(USER));
  const list=await bot('list');
  assert.ok(list.cases.some(c=>c.stage==='completed'));
  assert.ok(list.cases.some(c=>c.stage==='closed_by_agreement'));
  assert.equal((await bot('case',{case_id:waived.id},ACTOR,200,productionOff)).enrollment_open,false);
  let offset=0,all=[];
  for(;;){
    const log=await bot('log',{case_id:settled.id,offset});
    all.push(...log.entries);
    if(!log.more)break;
    offset+=8;
  }
  assert.deepEqual(all.map(x=>x.number),Array.from({length:all.length},(_,i)=>i+1));
  for(const type of ['draft_feedback','draft_approved','online_meeting_requested','filing_authorized','submission_started','filed_awaiting_isa'])
    assert.ok(all.some(x=>x.type===type),type);
  assert.ok(all.some(x=>x.type==='draft_approved' && x.version==='2.0'));
  assert.ok(!JSON.stringify(all).includes('Please improve claim 2.'));

  // Wipe only the first synthetic case; keep its owner's account, second case,
  // and the legal templates. Exercise an actual failed storage delete and retry.
  const target=settled.id, case_id=target, caseArgs={case_id}, prefix=`pct-workflow/cases/${target}/`;
  const targetRef=(await settled.read()).public_ref, retained=`pct-workflow/cases/${waived.id}/retained-fixture`;
  const nearPrefix=`pct-workflow/cases/${target}x/retained-fixture`;
  await files.put(prefix+'orphan-fixture','synthetic orphan');
  await files.put(retained,'synthetic sibling');
  await files.put(nearPrefix,'synthetic similar prefix');
  const alreadyPaid=await sha256Hex('synthetic previously settled transfer');
  await db.prepare('INSERT INTO pct_verified_payment_refs VALUES(?,?,?,?)').bind(alreadyPaid,target,'consultation',1).run();
  const offWipe=await mf.getWorker('prod-wipe-off');
  assert.equal((await bot('case',caseArgs,ACTOR,200,offWipe)).can_wipe,true);
  await bot('wipe-prepare',caseArgs,ACTOR,503,productionOff);
  await bot('wipe-prepare',caseArgs,'10000',403,offWipe);
  await post(settled.M+'/wipe',{},admin,{grant:settled.g,expected:404});
  const cancelled=await bot('wipe-prepare',caseArgs,ACTOR,200,offWipe);
  assert.equal(cancelled.public_ref,targetRef);
  assert.ok(cancelled.document_count>1);
  assert.deepEqual(await bot('wipe-cancel',{...caseArgs,token:cancelled.token},ACTOR,200,offWipe),{cancelled:true});
  await bot('wipe-confirm',{...caseArgs,token:cancelled.token},ACTOR,409,offWipe);
  const expired=await bot('wipe-prepare',caseArgs,ACTOR,200,offWipe);
  await db.prepare('UPDATE pct_case_wipes SET expires_at=1 WHERE case_id=?').bind(target).run();
  await bot('wipe-confirm',{...caseArgs,token:expired.token},ACTOR,409,offWipe);
  const stale=await bot('wipe-prepare',caseArgs,ACTOR,200,offWipe);
  await db.prepare('UPDATE pct_cases SET revision=revision+1,event_json=? WHERE id=?')
    .bind(JSON.stringify({type:'test_revision',actor:'synthetic'}),target).run();
  await bot('wipe-confirm',{...caseArgs,token:stale.token},ACTOR,409,offWipe);
  const current=await bot('wipe-prepare',caseArgs,ACTOR,200,offWipe);
  await bot('wipe-confirm',{case_id:waived.id,token:current.token},ACTOR,409,offWipe);
  const row=await db.prepare('SELECT id,revision FROM pct_cases WHERE id=?').bind(target).first();
  const uploadToken=await lockCaseUpload(db,row);
  await bot('wipe-confirm',{...caseArgs,token:current.token},ACTOR,409,offWipe);
  await unlockCaseUpload(db,target,uploadToken);
  const notice=await db.prepare('SELECT id FROM pct_events WHERE case_id=? AND notify=1 AND notified_at IS NULL LIMIT 1')
    .bind(target).first();
  assert.ok(notice);
  await db.prepare('UPDATE pct_events SET lease_until=unixepoch()+90 WHERE id=?').bind(notice.id).run();
  await bot('wipe-confirm',{...caseArgs,token:current.token},ACTOR,409,offWipe);
  await db.prepare('UPDATE pct_events SET lease_until=NULL WHERE id=?').bind(notice.id).run();
  const broken={list:options=>files.list(options),delete:async()=>{throw new Error('synthetic storage failure');}};
  const pending=await confirmWipe({PCT_DB:db,PCT_STORE:broken},target,ACTOR,current.token);
  assert.deepEqual(pending,{state:'pending',reason:'storage_or_database',public_ref:targetRef});
  assert.equal((await bot('case',caseArgs,ACTOR,200,offWipe)).can_continue_wipe,true);
  assert.ok((await files.list({prefix})).objects.some(o=>o.key.endsWith('.secret')));
  await req(settled.C,{cookie:client,expected:404});
  await req(settled.M,{cookie:admin,grant:settled.g,expected:404});
  assert.ok(!(await req('/api/pct/cases',{cookie:client})).cases.some(c=>c.id===target));
  await assert.rejects(lockCaseUpload(db,row),/case changed/);
  await bot('wipe-continue',{case_id:waived.id},ACTOR,404,offWipe);
  assert.deepEqual(await bot('wipe-continue',caseArgs,ACTOR,200,offWipe),{state:'deleted',public_ref:targetRef});
  assert.equal((await files.list({prefix})).objects.length,0);
  assert.ok(await files.get(retained));
  assert.ok(await files.get(nearPrefix));
  assert.ok(await files.get(vars.PCT_UNDERTAKING_KEY));
  for (const table of ['pct_events','pct_admin_links','pct_signature_challenges','pct_verified_payment_refs','pct_case_wipes','pct_team_updates','pct_usdt_checkouts','pct_usdt_reference_checkouts','pct_admin_publications']) {
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE case_id=?`).bind(target).first()).n,0,table);
  }
  assert.equal(await db.prepare('SELECT id FROM pct_cases WHERE id=?').bind(target).first(),null);
  await bot('wipe-confirm',{...caseArgs,token:current.token},ACTOR,409,offWipe);
  assert.equal((await req(waived.C,{cookie:pwdCookie})).stage,'closed_by_agreement');
  await assert.rejects(db.prepare('INSERT INTO pct_verified_payment_refs VALUES(?,?,?,?)')
    .bind(alreadyPaid,waived.id,'consultation',1).run(),/pct_payment_already_consumed/);

  const newId='pct_'+'3'.repeat(24), startAt=Math.floor(Date.now()/1000)-1;
  const existing={stage:'pct_drafting',start_requested_at:startAt,invoices:{},documents:[],messages:[]};
  await db.prepare(`INSERT INTO pct_cases(id,user_id,public_ref,stage,state_json,event_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).bind(newId,'user-test-clock','PCT-2026-3333333333',existing.stage,JSON.stringify(existing),
    JSON.stringify({type:'case_created',actor:'synthetic'}),startAt,startAt).run();
  const near=startAt+UPDATE_WINDOW-NOTICE_LEAD;
  assert.notEqual((await claimNotification(db,{timing:true,at:near-1}))?.type,'team_update_reminder');
  const attempts=await Promise.all([claimNotification(db,{timing:true,at:near}),claimNotification(db,{timing:true,at:near})]);
  const reminders=attempts.filter(x=>x?.type==='team_update_reminder');
  assert.equal(reminders.length,1);
  const n=reminders[0];
  assert.equal(n.case_id,newId);
  assert.equal(n.due_at,startAt+UPDATE_WINDOW);
  assert.equal(n.kind,'draft');
  assert.equal(await acknowledgeNotification(db,n.id,'wrong'),false);
  const retry=await claimNotification(db,{timing:true,at:near+91});
  assert.equal(retry.id,n.id);
  assert.notEqual(retry.lease,n.lease);
  assert.equal(await acknowledgeNotification(db,n.id,n.lease),false);
  assert.equal(await acknowledgeNotification(db,retry.id,retry.lease),true);
  assert.notEqual((await claimNotification(db,{timing:true,at:near+100}))?.type,'team_update_reminder');

  // Two synthetic invoices share the configured destination and use different memos.
  // The mocked transport never queries the real wallet or sends any funds.
  const at=Math.floor(Date.now()/1000), env={PCT_DB:db,PCT_USDT_ENABLED:'true',PCT_TRONGRID_API_KEY:'test-only'};
  const openCase=i=>createCase(db,'usdt-buyer-'+i,initialState({title:'Synthetic',name:'Synthetic',
    country:'Canada',undertaking:{accepted_at:at},at}),'synthetic-checkout-'+i);
  const [a,b,allocated]=await Promise.all([openCase(1),openCase(2),openCase(3)]);
  const [a1,a2,b1]=await Promise.all([
    openCheckout(env,a,'consultation',at),openCheckout(env,a,'consultation',at),openCheckout(env,b,'consultation',at),
  ]);
  assert.deepEqual(a1,a2);
  assert.equal(a1.address,b1.address);
  assert.match(a1.reference,/^RVPCT-[a-f0-9]{24}$/);
  assert.notEqual(a1.reference,b1.reference);
  const recipient=await tronAddressHex(a1.address);
  assert.ok(recipient);
  const badAmount='e'.repeat(64), correct='f'.repeat(64), failed='d'.repeat(64);
  const transfer=({txid,reference,value='111000000',confirmed=true,success=true})=>async (url,init)=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://api.trongrid.io');
    assert.equal(init.headers['TRON-PRO-API-KEY'],'test-only');
    assert.deepEqual(JSON.parse(init.body),{value:txid});
    if (u.pathname==='/walletsolidity/gettransactionbyid') return Response.json(confirmed ?
      {txID:txid,raw_data:{data:Buffer.from(reference).toString('hex')}} : {});
    assert.equal(u.pathname,'/walletsolidity/gettransactioninfobyid');
    return Response.json({id:txid,blockNumber:1,blockTimeStamp:at*1000,receipt:{result:success?'SUCCESS':'REVERT'},
      log:[{address:'a614f803b6fd780986a42c78ec9c7f77e6ded13c',
        topics:['ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0'.repeat(64),
          recipient.padStart(64,'0')],data:BigInt(value).toString(16).padStart(64,'0')}]});
  };
  const check=(row,txid,clock,mock)=>checkCheckout(env,row,'consultation',txid,{at:clock,fetcher:transfer(mock)});
  const right={txid:correct,reference:a1.reference};
  assert.equal((await check(b,correct,at,right)).status,'reference_mismatch');
  assert.equal((await caseById(db,b.id)).stage,'consultation_payment');
  assert.equal((await check(a,badAmount,at,{txid:badAmount,reference:a1.reference,value:'110000000'})).status,'review_required');
  assert.equal((await check(a,failed,at+50,{txid:failed,reference:a1.reference,success:false})).status,'review_required');
  assert.equal((await check(a,correct,at+100,{...right,confirmed:false})).status,'checking_transfer');
  assert.equal((await caseById(db,a.id)).state.invoices.consultation.status,'issued');
  const retryTransfer=()=>reconcileCheckout(env,{caseId:a.id,key:'consultation',at:at+150,fetcher:transfer(right)});
  await Promise.all([retryTransfer(),retryTransfer()]);
  const paid=await caseById(db,a.id);
  assert.equal(paid.state.invoices.consultation.paid_at,at+150);
  assert.equal(paid.stage,'consultation_requested');
  assert.equal(paid.state.team_updates[0].due_at,at+150+UPDATE_WINDOW);
  const events=(await db.prepare('SELECT event_type,notify FROM pct_events WHERE case_id=? ORDER BY revision')
    .bind(a.id).all()).results;
  assert.deepEqual(events.map(e=>[e.event_type,e.notify]),
    [['case_created',0],['usdt_payment_review',1],['consultation_requested',1]]);

  // An invoice with an already assigned dedicated address retains its checkout.
  const assigned='TJmmqjb1DK9TTZbQXzRQ2AuA94z4gKAPFh';
  await db.prepare(`INSERT INTO pct_usdt_checkouts(case_id,milestone,address,amount_cents,started_at,next_check_at)
    VALUES(?,?,?,?,?,?)`).bind(allocated.id,'consultation',assigned,11100,at,at).run();
  assert.deepEqual(await openCheckout(env,allocated,'consultation',at),
    {address:assigned,amount_cents:11100,network:'TRON (TRC20)',status:'awaiting_transfer'});
});
