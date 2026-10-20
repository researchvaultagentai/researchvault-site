import { faqAnswer, scopedGuideAnswer, supportLinks } from './rv-support-faq.js';
import { supportScopeForPage, supportReplyInScope } from './rv-support-context.js';

const WORDS = {
  en: { title: 'ResearchVault', subtitle: 'A little guidance, whenever you need it.', open: 'Ask ResearchVault',
    close: 'Close support', welcome: 'Hello. How can I help you move forward?',
    note: 'For confidential invention details, please use your private case portal.',
    placeholder: 'Ask about our services…', send: 'Send message', thinking: 'One moment…',
    start: 'Where do I start?', documents: 'Documents & video', articles: 'Find a paper', human: 'Talk to the agent',
    footer: 'ResearchVault service guide', unavailable: 'You can reach the patent agent directly on Telegram.', },
  fa: { title: 'راهنمای ResearchVault', subtitle: 'یک راهنمای کوتاه برای قدم بعدی شما.', open: 'گفت‌وگو با پشتیبانی',
    close: 'بستن پشتیبانی', welcome: 'سلام. برای کدام بخش می‌توانم راهنمایی‌تان کنم؟',
    note: 'جزئیات محرمانه اختراع را فقط در کارتابل خصوصی پرونده ارسال کنید.',
    placeholder: 'درباره خدمات از ما بپرسید…', send: 'ارسال پیام', thinking: 'چند لحظه…',
    start: 'از کجا شروع کنم؟', documents: 'مدارک و ویدیو', articles: 'دریافت مقاله', human: 'گفت‌وگو با کارگزار',
    footer: 'راهنمای خدمات ResearchVault', unavailable: 'برای گفت‌وگو مستقیم، در تلگرام به کارگزار پیام بدهید.', },
};


const SERVICE_WORDS = {
  articles: {
    en: { title: 'ResearchVault · Paper support', subtitle: 'Help with research-paper requests.',
      welcome: 'Looking for a research paper?', note: 'Please keep account and payment credentials out of this public chat.',
      placeholder: 'Ask about paper retrieval…', human: 'Contact paper support', footer: 'Research-paper retrieval support' },
    fa: { title: 'پشتیبانی دریافت مقاله', subtitle: 'راهنمای درخواست و دریافت مقاله علمی.',
      welcome: 'برای دریافت مقاله راهنمایی می‌خواهید؟', note: 'رمز حساب و اطلاعات حساس پرداخت را در این چت عمومی نفرستید.',
      placeholder: 'درباره دریافت مقاله بپرسید…', human: 'تماس با پشتیبانی مقاله', footer: 'راهنمای سرویس دریافت مقاله' },
  },
  patent_iran: {
    en: { title: 'Iran · Patent support', subtitle: 'Patent services for Iranian clients.',
      welcome: 'How can I help with your Iranian patent engagement?', placeholder: 'Ask about your Iranian patent service…',
      human: 'Contact the Iran patent agent', footer: 'Iranian-client patent service' },
    fa: { title: 'پشتیبانی اختراع · مشتری ایرانی', subtitle: 'راهنمای خدمات اختراع ایران و ایران + PCT.',
      welcome: 'برای پرونده اختراع مشتری ایرانی راهنمایی می‌خواهید؟', placeholder: 'درباره خدمات اختراع مشتری ایرانی بپرسید…',
      human: 'تماس با کارگزار اختراع ایران', footer: 'راهنمای کارگزاری اختراع مشتری ایرانی' },
  },
  patent_pct: {
    en: { title: 'International · PCT support', subtitle: 'Help with your international patent engagement.',
      welcome: 'How can I help with your PCT service?', placeholder: 'Ask about the international PCT service…',
      human: 'Contact the PCT agent', footer: 'International PCT service' },
    fa: { title: 'پشتیبانی بین‌المللی PCT', subtitle: 'راهنمای خدمات اختراع برای مشتری بین‌المللی.',
      welcome: 'برای خدمات بین‌المللی PCT راهنمایی می‌خواهید؟', placeholder: 'درباره خدمات بین‌المللی PCT بپرسید…',
      human: 'تماس با کارگزار بین‌المللی', footer: 'راهنمای خدمات بین‌المللی PCT' },
  },
};

const CSS = `
:host{all:initial;--rv-support-left:max(22px,env(safe-area-inset-left,0px));--rv-support-right:max(22px,env(safe-area-inset-right,0px));--rv-support-bottom:max(22px,env(safe-area-inset-bottom,0px));display:block;font-family:Inter,Vazirmatn,system-ui,sans-serif;position:fixed;top:auto;left:auto;right:var(--rv-support-right);bottom:var(--rv-support-bottom);width:max-content;max-width:calc(100vw - var(--rv-support-left) - var(--rv-support-right));margin:0;z-index:2147480000;color:#16382d;font-size:14px;line-height:1.65;direction:ltr;unicode-bidi:isolate}
:host([dir="rtl"]){direction:rtl;right:auto;left:var(--rv-support-left)}
*{box-sizing:border-box}button,textarea,a{font:inherit}button,a,textarea{outline-offset:4px}button{cursor:pointer}button:focus-visible,a:focus-visible,textarea:focus-visible{outline:3px solid #7dc8a5}button:disabled{cursor:wait;opacity:.65}[hidden]{display:none!important}
.launcher{display:flex;align-items:center;justify-content:center;gap:10px;min-width:54px;min-height:54px;max-width:100%;border:1px solid #ffffff50;border-radius:50px;background:#173e32;color:white;padding:14px 20px;box-shadow:0 6px 28px #122d3233;transition:transform .2s,box-shadow .2s}.launcher:hover{transform:translateY(-2px);box-shadow:0 10px 32px #122d3240}.launcher svg{width:22px;height:22px;flex:0 0 22px}.launcher span{font-weight:600;font-size:13px}
.panel{position:absolute;left:auto;right:0;bottom:76px;width:min(382px,calc(100vw - var(--rv-support-left) - var(--rv-support-right)));height:min(590px,calc(100dvh - var(--rv-support-bottom) - 100px));display:flex;flex-direction:column;border:1px solid #dde6df;border-radius:24px;background:#fff;box-shadow:0 22px 80px #1231252b;overflow:hidden;animation:appear .18s ease-out}
:host([dir="rtl"]) .panel{left:0;right:auto}
.top{display:flex;align-items:center;gap:11px;padding:20px;background:#f3f7f2;border-bottom:1px solid #e3eae2}.mark{width:39px;height:39px;display:grid;place-items:center;border-radius:13px;background:#173e32;color:#dcf5c8;font-family:Georgia,serif;font-size:22px;font-style:italic}.brand{flex:1}.brand b{display:block;font-size:14px}.brand small{display:block;color:#6c7e73;font-size:11px;margin-top:1px}.close{background:transparent;border:0;color:#53685a;font-size:26px;padding:0 5px;line-height:1.2}
.content{padding:20px;overflow:auto;overscroll-behavior:contain;flex:1;background:linear-gradient(#fff,#fbfcfa)}.intro{margin:0 0 15px;font-size:18px;line-height:1.5;font-weight:600;letter-spacing:-.3px}.chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:19px}.chip{background:white;border:1px solid #dbe5da;color:#365b48;border-radius:10px;padding:7px 10px;font-size:11px;transition:background .15s}.chip:hover{background:#eff6eb}
.bubble{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px 14px;max-width:94%;margin:9px 0;border-radius:15px;line-height:1.8}.assistant{background:#f0f4ed;border:1px solid #e7ede2;border-end-start-radius:3px}.user{background:#214e3c;color:#fff;margin-inline-start:auto;border-end-end-radius:3px}.status{font-size:12px;color:#5a7461;margin:8px 0}
.contact{display:inline-flex;gap:7px;align-items:center;color:#2b644b;font-size:12px;text-decoration:none;border-bottom:1px solid #adc7b2;margin-top:8px}.note{font-size:10px;color:#7d887e;line-height:1.6;margin:14px 0 0;display:flex;gap:5px}.compose{border-top:1px solid #e4eae1;background:#fff;padding:12px 15px 10px}.input{display:flex;gap:8px;align-items:flex-end;background:#f6f8f4;border:1px solid #e4eae0;border-radius:14px;padding:8px 8px 8px 12px}textarea{border:0;background:transparent;resize:none;min-height:32px;max-height:90px;line-height:1.6;padding:4px 2px;width:100%;color:#173e32;font-size:13px}textarea:focus{outline:none}.send{border:0;border-radius:10px;background:#173e32;color:#fff;width:34px;height:34px;flex:0 0 34px;display:grid;place-items:center}.send svg{height:17px;width:17px}.foot{font-size:9px;letter-spacing:.2px;text-align:center;color:#9aa596;margin-top:8px}.challenge{margin:5px 0;min-height:0}
@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:480px){:host{--rv-support-left:max(18px,env(safe-area-inset-left,0px));--rv-support-right:max(18px,env(safe-area-inset-right,0px));--rv-support-bottom:max(18px,env(safe-area-inset-bottom,0px))}.launcher{padding:14px;width:56px;height:56px}.launcher span{display:none}.panel{bottom:68px;width:calc(100vw - var(--rv-support-left) - var(--rv-support-right));border-radius:21px}.content{padding:17px}.top{padding:17px}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}@media print{:host{display:none}}
`;

let loadChallenge;
function turnstileApi() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loadChallenge) loadChallenge = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.onload = () => resolve(window.turnstile); script.onerror = reject;
    document.head.append(script);
  });
  return loadChallenge;
}

export function mountSupportWidget() {
  const previous = document.getElementById('rv-support-widget');
  if (previous) return previous;
  const lang = document.documentElement.lang.toLowerCase().startsWith('fa') ? 'fa' : 'en';
  const scope = supportScopeForPage(window.location.origin, window.location.pathname);
  if (!scope) return null;
  const links = supportLinks(scope);
  const copy = { ...WORDS[lang], pricing: lang === 'fa' ? 'هزینه‌ها' : 'Fees',
    tracking: lang === 'fa' ? 'پیگیری درخواست' : 'Track a request', ...SERVICE_WORDS[scope][lang] };
  let config = { ...(window.ResearchVaultSupportConfig || {}) };
  let configuration;
  const configure = () => {
    if (!configuration) configuration = (async () => {
      if (config.endpoint && config.turnstileSiteKey) return config;
      try {
        const response = await fetch('/support/config', { credentials: 'omit', redirect: 'error', cache: 'no-store',
          signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const value = await response.json();
          if (value.configured === true && typeof value.turnstileSiteKey === 'string' &&
              /^[a-zA-Z0-9_-]{10,100}$/.test(value.turnstileSiteKey)) {
            config = { endpoint: '/support/chat', turnstileSiteKey: value.turnstileSiteKey };
          }
        }
      } catch { /* The local service guide remains available. */ }
      return config;
    })();
    return configuration;
  };
  const host = document.createElement('div'); host.id = 'rv-support-widget'; host.dataset.supportScope = scope; host.dir = lang === 'fa' ? 'rtl' : 'ltr';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><section class="panel" hidden role="dialog" aria-modal="false" aria-labelledby="rv-support-title">
    <header class="top"><span class="mark" aria-hidden="true">r</span><div class="brand"><b id="rv-support-title"></b><small></small></div><button class="close" type="button">×</button></header>
    <div class="content"><h2 class="intro"></h2><div class="chips"></div><div class="messages" role="log" aria-live="polite" aria-relevant="additions"></div><p class="status" role="status" hidden></p><a class="contact" target="_blank" rel="noopener noreferrer"></a><p class="note"></p></div>
    <form class="compose"><div class="input"><textarea rows="1" maxlength="1500"></textarea><button class="send" type="submit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m5 12 14-8-4 16-4-6-6-2Z"/><path d="m11 14 8-10"/></svg></button></div><div class="challenge"><slot name="challenge"></slot></div><div class="foot"></div></form>
    </section><button class="launcher" type="button" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5H4v-7.5A8.5 8.5 0 1 1 20 11.5Z"/><path d="M8 10h8m-8 4h5"/></svg><span></span></button>`;
  const $ = selector => root.querySelector(selector);
  $('#rv-support-title').textContent = copy.title; $('.brand small').textContent = copy.subtitle;
  $('.intro').textContent = copy.welcome; $('.note').textContent = copy.note; $('.foot').textContent = copy.footer;
  $('.launcher span').textContent = copy.open; $('.launcher').setAttribute('aria-label', copy.open);
  $('.close').setAttribute('aria-label', copy.close); $('.send').setAttribute('aria-label', copy.send);
  $('textarea').placeholder = copy.placeholder; $('textarea').setAttribute('aria-label', copy.placeholder);
  $('.contact').href = links.human; $('.contact').textContent = `${copy.human} ↗`;
  const challengeContainer = document.createElement('div'); challengeContainer.slot = 'challenge'; host.append(challengeContainer);
  let history = [], busy = false, challengeId, pending, destroyed = false;
  const append = (role, text) => {
    const bubble = document.createElement('div'); bubble.className = `bubble ${role}`; bubble.textContent = text;
    $('.messages').append(bubble); $('.content').scrollTop = $('.content').scrollHeight;
  };
  const show = open => { $('.panel').hidden = !open; $('.launcher').setAttribute('aria-expanded', String(open));
    if (open) $('textarea').focus(); else $('.launcher').focus(); };
  $('.launcher').onclick = () => show($('.panel').hidden); $('.close').onclick = () => show(false);
  root.addEventListener('keydown', event => { if (event.key === 'Escape') show(false); });
  for (const topic of (scope === 'articles' ? ['articles', 'pricing', 'tracking', 'human'] : ['start', 'documents', 'pricing', 'human'])) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chip'; button.textContent = copy[topic];
    button.onclick = () => { if (busy) return; append('user', copy[topic]); append('assistant', faqAnswer(topic, lang, scope)); };
    $('.chips').append(button);
  }
  async function token() {
    const api = await turnstileApi();
    if (challengeId !== undefined) api.remove(challengeId);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('verification_timeout')), 30000);
      challengeId = api.render(challengeContainer, { sitekey: config.turnstileSiteKey, action: 'support_chat',
        language: lang, callback: value => { clearTimeout(timeout); resolve(value); },
        'error-callback': () => { clearTimeout(timeout); reject(new Error('verification_failed')); } });
    });
  }
  async function send() {
    if (supportScopeForPage(window.location.origin, window.location.pathname) !== scope) {
      host.rvSupportDestroy(); mountSupportWidget(); return;
    }
    const message = $('textarea').value.trim(); if (!message || busy) return;
    busy = true; $('.send').disabled = true; $('textarea').value = ''; append('user', message);
    $('.status').textContent = copy.thinking; $('.status').hidden = false;
    let reply = scopedGuideAnswer(message, lang, scope);
    try {
      if (!reply) await configure();
      if (!reply && !destroyed && config.endpoint && config.turnstileSiteKey) {
        const endpoint = new URL(config.endpoint, window.location.origin);
        if (endpoint.protocol !== 'https:' || endpoint.origin !== window.location.origin) throw new Error('invalid_endpoint');
        const turnstileToken = await token();
        if (destroyed) return;
        pending = new AbortController(); const timeout = setTimeout(() => pending.abort(), 20000);
        let response;
        try { response = await fetch(endpoint.href, { method: 'POST', credentials: 'omit', redirect: 'error',
          headers: { 'content-type': 'application/json', 'x-rv-support-page': window.location.pathname }, signal: pending.signal,
          body: JSON.stringify({ message, language: lang, history: history.slice(-6), historyScope: scope, turnstileToken }) }); }
        finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error('support_unavailable');
        const result = await response.json();
        if (result.serviceScope !== scope || !supportReplyInScope(result.reply, scope)) throw new Error('invalid_reply');
        reply = result.reply.slice(0, 4000);
      }
    } catch { reply = null; }
    finally {
      reply ||= faqAnswer('human', lang, scope);
      append('assistant', reply);
      history.push({ role: 'user', content: message.slice(0, 500) }, { role: 'assistant', content: reply.slice(0, 500) });
      history = history.slice(-6); busy = false; pending = null; $('.send').disabled = false; $('.status').hidden = true;
      if (challengeId !== undefined && window.turnstile) { window.turnstile.remove(challengeId); challengeId = undefined; }
      $('textarea').focus();
    }
  }
  $('.compose').onsubmit = event => { event.preventDefault(); void send(); };
  $('textarea').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
  });
  host.rvSupportDestroy = () => { destroyed = true; pending?.abort(); if (challengeId !== undefined && window.turnstile) window.turnstile.remove(challengeId); host.remove(); };
  document.body.append(host);
  return host;
}

if (typeof document !== 'undefined') {
  // The guide must not wait for unrelated fonts, images or trust-badge scripts.
  // An async module in <head> can finish before <body> has been parsed.
  const boot = () => { if (!document.body) return false; mountSupportWidget(); return true; };
  if (!boot()) {
    const bodyObserver = new MutationObserver(() => { if (boot()) bodyObserver.disconnect(); });
    bodyObserver.observe(document.documentElement, { childList: true });
  }
  window.addEventListener('popstate', () => {
    document.getElementById('rv-support-widget')?.rvSupportDestroy?.(); mountSupportWidget();
  });
  new MutationObserver(() => {
    document.getElementById('rv-support-widget')?.rvSupportDestroy?.(); mountSupportWidget();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}
