// Explicit links to an older case/payment still use the previous email login.
const next=new URLSearchParams(location.search).get('next');
if(!next || ['/patent/en/intake/','/patent/en/workflow/'].includes(next)){
  fetch('/api/pct/status',{credentials:'same-origin'})
    .then(r=>r.ok?r.json():null).then(s=>{if(s?.enabled)location.replace('/patent/en/workflow/');}).catch(()=>{});
}
