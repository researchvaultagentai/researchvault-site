import{audit}from'./db.js';
import{nowSec,uid}from'./security.js';

function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function adminEmails(env){return String(env.ADMIN_EMAILS||'').split(',').map(x=>x.trim()).filter(Boolean)}

export async function notifyDepositPricingReady(env,caseRow,user){
  if(!env.RESEND_API_KEY)return{sent:false,reason:'resend_not_configured'};
  const destinations=adminEmails(env);if(!destinations.length)return{sent:false,reason:'admin_email_missing'};
  const existing=await env.DB.prepare("SELECT id FROM patent_notifications WHERE case_id=? AND template_key='deposit_pricing_required' AND status IN ('queued','sent') LIMIT 1").bind(caseRow.id).first();
  if(existing)return{sent:false,reason:'already_notified'};
  const nda=await env.DB.prepare("SELECT id FROM patent_signatures WHERE case_id=? AND contract_type='nda' LIMIT 1").bind(caseRow.id).first();
  const disclosure=await env.DB.prepare("SELECT id FROM patent_documents WHERE case_id=? AND category='disclosure' LIMIT 1").bind(caseRow.id).first();
  const deposit=await env.DB.prepare("SELECT id FROM patent_invoices WHERE case_id=? AND (milestone LIKE 'stage1%' OR milestone LIKE '%deposit%' OR milestone LIKE '%advance%') LIMIT 1").bind(caseRow.id).first();
  if(!nda||!disclosure||deposit)return{sent:false,reason:'not_ready'};
  const adminUrl=`https://researchvaultagent.ir/patent/admin/?case=${encodeURIComponent(caseRow.id)}`;
  const subject=`تعیین بیعانه پرونده ${caseRow.public_ref}`;
  const html=`<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#18351b"><h2>پرونده آماده تعیین بیعانه است</h2><p><b>${esc(caseRow.title||'پرونده اختراع')}</b></p><p>شناسه: <b>${esc(caseRow.public_ref)}</b><br>متقاضی: ${esc(user.full_name||user.email)}<br>ایمیل: ${esc(user.email)}</p><p>توافق‌نامه محرمانگی امضا شده و افشای فنی اولیه دریافت شده است. برای فعال‌سازی پرونده، مبلغ بیعانه غیرقابل استرداد را تعیین و فاکتور صادر کنید.</p><p><a href="${adminUrl}" style="display:inline-block;background:#55b915;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:700">باز کردن پرونده و تعیین بیعانه</a></p></div>`;
  let sent=0;
  for(const email of destinations){
    const id=uid('ntf'),t=nowSec();
    await env.DB.prepare("INSERT INTO patent_notifications(id,case_id,user_id,channel,template_key,destination,status,created_at) VALUES(?,?,?,'email','deposit_pricing_required',?,'queued',?)").bind(id,caseRow.id,caseRow.user_id,email,t).run();
    try{
      const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({from:env.OTP_FROM_EMAIL||'ResearchVault Patent <patent@researchvaultagent.ir>',to:[email],subject,html})});
      if(!r.ok)throw new Error(`resend:${r.status}:${await r.text()}`);
      const data=await r.json();
      await env.DB.prepare("UPDATE patent_notifications SET status='sent',provider_reference=?,sent_at=? WHERE id=?").bind(data?.id||null,nowSec(),id).run();sent++;
    }catch(e){await env.DB.prepare("UPDATE patent_notifications SET status='failed' WHERE id=?").bind(id).run();console.error('deposit pricing notification failed',e)}
  }
  if(sent)await audit(env,{caseId:caseRow.id,actorType:'system',eventType:'deposit_pricing_notification_sent',meta:{destinations:sent,admin_url:adminUrl}});
  return{sent:sent>0,count:sent};
}
