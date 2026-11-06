import { acknowledgeNotification, claimNotification } from './repository.js';

const teamTasks = {
  consultation:'هماهنگی مشاوره',prior_art:'گزارش پیشینه',invention:'بررسی اختراع انتخابی',quote:'آماده‌سازی پیشنهاد قیمت',
  agreement:'بررسی توافق‌نامه',draft:'آماده‌سازی پیش‌نویس',revision:'بازبینی پیش‌نویس',package:'آماده‌سازی بستهٔ نهایی',
  filing:'ارسال در ePCT',isa_response:'پاسخ به گزارش ISA',receipt:'بررسی رسید پرداخت',meeting:'درخواست جلسه',message:'پیام مشتری',
};

function noticeText(n) {
  if(n.type==='team_update_reminder' && Number.isSafeInteger(n.due_at)) {
    const due=new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'}).format(n.due_at*1000);
    const minutes=Math.max(1,Math.ceil((n.due_at-Date.now()/1000)/60));
    const time=minutes>=60 ? `${Math.floor(minutes/60)} ساعت و ${minutes%60} دقیقه` : `${minutes} دقیقه`;
    return `${n.public_ref}\n⏳ ${time} تا موعد به‌روزرسانی\n${teamTasks[n.kind] || 'به‌روزرسانی پرونده'} · ${due} (تهران)`;
  }
  const amount=n.amount_cents ? '\nUS$'+(n.amount_cents/100).toFixed(2) : '';
  return n.public_ref+'\n'+(labels[n.type] || 'پرونده به‌روزرسانی شد.')+(n.version?' · v'+n.version:'')+amount;
}

const labels={
  consultation_requested:'پرداخت مشاوره تأیید شد؛ درخواست جلسه ثبت شد.',
  payment_confirmed:'پرداخت تأیید شد.',
  usdt_payment_review:'پرداخت USDT نیاز به بررسی دارد.',
  submit_receipt:'رسید پرداخت در انتظار بررسی است.',
  idea_selected:'مشتری ایده نهایی خود را ثبت کرد.',
  agreement_signed:'قرارداد و مبلغ‌ها با OTP تأیید شد.',
  signed_agreement_uploaded:'نسخه امضاشده برای بررسی در کارتابل است.',
  filing_start_requested:'اطلاعات فایلینگ تکمیل شد؛ تهیه پیش‌نویس را شروع کنید.',
  draft_feedback:'فایل Word کامنت‌گذاری‌شده برگشت.',
  draft_approved:'مشتری پیش‌نویس را برای ساخت بسته نهایی تأیید کرد.',
  online_meeting_requested:'مشتری درخواست جلسه آنلاین داد.',
  filing_authorized:'رضایت نهایی ePCT با OTP ثبت شد.',
  filed_awaiting_isa:'ارسال تأیید شد و رسید ePCT در کارتابل قرار گرفت.',
  client_message:'پیام خصوصی جدید در کارتابل.',
};

export function notificationTarget(env) {
  const chat=String(env.PCT_NOTIFY_CHAT_ID || ''), token=String(env.PCT_TELEGRAM_NOTIFY_TOKEN || '');
  const allowlist=String(env.PCT_TELEGRAM_ADMIN_IDS || '').split(',').map(v=>v.trim());
  return env.ENVIRONMENT==='production' && env.PCT_ENABLED==='true' && /^\d{1,20}$/.test(chat) &&
    allowlist.includes(chat) && /^\d{6,15}:[a-zA-Z0-9_-]{20,100}$/.test(token) ? {chat,token} : null;
}

export async function deliverPctNotices(env,fetcher=fetch,limit=2) {
  const target=notificationTarget(env);
  if(!target)return 0;
  let delivered=0;
  for(let i=0;i<limit;i++){
    const n=await claimNotification(env.PCT_DB,{timing:env.PCT_RESPONSE_TIMING_ENABLED==='true'});
    if(!n)break;
    const text=noticeText(n);
    const res=await fetcher('https://api.telegram.org/bot'+target.token+'/sendMessage',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(6500),headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:target.chat,text,protect_content:true,disable_web_page_preview:true,
        reply_markup:{inline_keyboard:[[{text:'دیدن پرونده',callback_data:'p2:case:'+n.case_id}]]}}),
    });
    const sent=await res.json().catch(()=>null);
    if(!res.ok || !sent?.ok || !sent?.result?.message_id)break;
    if(await acknowledgeNotification(env.PCT_DB,n.id,n.lease))delivered++;
  }
  return delivered;
}
