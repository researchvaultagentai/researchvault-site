/* ============================================================
   ResearchVaultAgent — Main Script
   i18n + Header + Footer injection
   ============================================================ */

// ==================== i18n Dictionary ====================
const I18N = {
  // ---- Header / Nav ----
  "nav.home": { fa: "خانه", en: "Home" },
  "nav.pricing": { fa: "تعرفه‌ها", en: "Pricing" },
  "nav.about": { fa: "درباره ما", en: "About" },
  "nav.contact": { fa: "تماس با ما", en: "Contact" },
  "nav.terms": { fa: "قوانین", en: "Terms" },
  "nav.privacy": { fa: "حریم خصوصی", en: "Privacy" },
  "nav.refund": { fa: "بازگشت وجه", en: "Refund" },
  "nav.start": { fa: "شروع در تلگرام", en: "Start on Telegram" },

  // ---- Hero ----
  "hero.badge": { fa: "دسترسی سریع به مقالات علمی", en: "Fast access to research papers" },
  "hero.title1": { fa: "دسترسی آسان به", en: "Easy access to" },
  "hero.title2": { fa: "مقالات علمی معتبر", en: "trusted research papers" },
  "hero.subtitle": {
    fa: "کافیست DOI، عنوان مقاله، یا لینک ناشر را ارسال کنید. ربات ResearchVaultAgent به‌صورت خودکار منابع معتبر Open Access را بررسی کرده و فایل PDF کامل را تحویل می‌دهد.",
    en: "Just send the DOI, article title, or publisher link. ResearchVaultAgent automatically checks trusted Open Access sources and delivers the full PDF."
  },
  "hero.cta": { fa: "شروع در تلگرام", en: "Start on Telegram" },
  "hero.cta2": { fa: "مشاهده تعرفه‌ها", en: "View pricing" },
  "mockup.user": { fa: "10.1038/s41586-020-2649-2", en: "10.1038/s41586-020-2649-2" },
  "mockup.bot": { fa: "در حال جستجو در منابع معتبر...", en: "Searching trusted sources..." },
  "mockup.file": { fa: "مقاله.pdf آماده دریافت است", en: "Article.pdf is ready" },

  // ---- Features ----
  "features.label": { fa: "چرا ما؟", en: "Why us?" },
  "features.title": { fa: "همه چیز برای پژوهش شما", en: "Everything for your research" },
  "features.subtitle": {
    fa: "از منابع معتبر جهانی تا تحویل سریع PDF در تلگرام — همه در یک ربات ساده.",
    en: "From trusted global sources to fast PDF delivery on Telegram — all in one simple bot."
  },
  "feature1.title": { fa: "منابع معتبر جهانی", en: "Trusted global sources" },
  "feature1.text": {
    fa: "دسترسی به Crossref، Unpaywall، OpenAlex، Europe PMC، OpenAIRE، Semantic Scholar و ده‌ها منبع دیگر.",
    en: "Access to Crossref, Unpaywall, OpenAlex, Europe PMC, OpenAIRE, Semantic Scholar, and dozens more."
  },
  "feature2.title": { fa: "سرعت بالا", en: "High speed" },
  "feature2.text": {
    fa: "میانگین زمان تحویل مقاله زیر ۱۵ ثانیه، با کش هوشمند برای درخواست‌های تکراری.",
    en: "Average delivery under 15 seconds, with smart caching for repeat requests."
  },
  "feature3.title": { fa: "صرفه‌جویی در هزینه", en: "Cost saving" },
  "feature3.text": {
    fa: "بدون نیاز به اشتراک گران‌قیمت دانشگاهی. فقط برای هر مقاله موفق اعتبار کسر می‌شود.",
    en: "No expensive university subscription needed. Only successful deliveries consume credits."
  },
  "feature4.title": { fa: "دو زبان", en: "Bilingual" },
  "feature4.text": {
    fa: "پشتیبانی کامل از فارسی و انگلیسی، با رابط کاربری ساده و واضح.",
    en: "Full support for Persian and English, with a simple, clear interface."
  },
  "feature5.title": { fa: "پرداخت امن", en: "Secure payment" },
  "feature5.text": {
    fa: "پرداخت با استارز تلگرام یا ریال ایران از طریق درگاه رسمی زرین‌پال.",
    en: "Pay with Telegram Stars or Iranian Rial via the official ZarinPal gateway."
  },
  "feature6.title": { fa: "پشتیبانی ۲۴/۷", en: "24/7 Support" },
  "feature6.text": {
    fa: "پاسخ‌گویی سریع در تلگرام، برای هر سؤال یا مشکلی که پیش بیاید.",
    en: "Fast response on Telegram for any question or issue."
  },

  // ---- Steps ----
  "steps.label": { fa: "چطور کار می‌کند؟", en: "How it works" },
  "steps.title": { fa: "سه گام ساده تا مقاله شما", en: "Three simple steps" },
  "step1.title": { fa: "ارسال DOI یا عنوان", en: "Send DOI or title" },
  "step1.text": {
    fa: "کافیست DOI، عنوان مقاله یا لینک صفحه ناشر را در ربات ارسال کنید.",
    en: "Just send the DOI, article title, or publisher page link to the bot."
  },
  "step2.title": { fa: "جستجوی خودکار", en: "Automatic search" },
  "step2.text": {
    fa: "ربات به‌صورت خودکار در ده‌ها منبع معتبر علمی جستجو می‌کند.",
    en: "The bot automatically searches dozens of trusted scholarly sources."
  },
  "step3.title": { fa: "دریافت PDF", en: "Receive the PDF" },
  "step3.text": {
    fa: "فایل PDF کامل، مستقیماً در چت تلگرام برای شما ارسال می‌شود.",
    en: "The full PDF file is sent directly to your Telegram chat."
  },

  // ---- Pricing Preview ----
  "pricing.label": { fa: "تعرفه‌ها", en: "Pricing" },
  "pricing.title": { fa: "پلن مناسب خود را انتخاب کنید", en: "Choose your plan" },
  "pricing.subtitle": {
    fa: "هر اعتبار معادل یک مقاله موفق است. بدون هزینه ماهانه یا اشتراک اجباری.",
    en: "Each credit equals one successful paper. No monthly fee or forced subscription."
  },
  "pricing.cta": { fa: "مشاهده همه پلن‌ها", en: "View all plans" },
  "pricing.credits": { fa: "اعتبار", en: "credits" },
  "pricing.usd": { fa: "دلار", en: "USD" },
  "pricing.popular": { fa: "محبوب", en: "POPULAR" },

  // ---- Trust ----
  "trust1.label": { fa: "منبع علمی", en: "scholarly sources" },
  "trust2.label": { fa: "مقاله تحویل شده", en: "papers delivered" },
  "trust3.label": { fa: "آپ‌تایم", en: "uptime" },
  "trust4.label": { fa: "پشتیبانی", en: "support" },

  // ---- FAQ ----
  "faq.label": { fa: "سوالات متداول", en: "FAQ" },
  "faq.title": { fa: "پاسخ به پرسش‌های شما", en: "Answers to your questions" },
  "faq1.q": { fa: "چطور از ربات استفاده کنم؟", en: "How do I use the bot?" },
  "faq1.a": {
    fa: "کافیه در تلگرام ربات را استارت کنید، سپس DOI، عنوان مقاله یا لینک صفحه ناشر را ارسال کنید. ربات به‌صورت خودکار مقاله را پیدا کرده و برایتان ارسال می‌کند.",
    en: "Just start the bot on Telegram, then send the DOI, article title, or publisher page link. The bot will automatically find and deliver the paper."
  },
  "faq2.q": { fa: "اعتبار چگونه محاسبه می‌شود؟", en: "How are credits calculated?" },
  "faq2.a": {
    fa: "برای هر مقاله‌ای که با موفقیت تحویل داده شود، ۱ اعتبار از حساب شما کسر می‌شود. اگر مقاله پیدا نشود، هیچ اعتباری کسر نمی‌شود.",
    en: "For each successfully delivered paper, 1 credit is deducted. If the paper isn't found, no credit is consumed."
  },
  "faq3.q": { fa: "چطور می‌توانم اعتبار بخرم؟", en: "How do I buy credits?" },
  "faq3.a": {
    fa: "از داخل ربات، روی گزینه «اعتبار» بزنید و پلن موردنظر را انتخاب کنید. پرداخت با استارز تلگرام یا ریال ایران (زرین‌پال) امکان‌پذیر است.",
    en: "From inside the bot, tap \"Credits\" and choose a plan. Payment via Telegram Stars or Iranian Rial (ZarinPal) is available."
  },
  "faq4.q": { fa: "اگر مقاله‌ای پیدا نشد چه کنم؟", en: "What if a paper isn't found?" },
  "faq4.a": {
    fa: "در این حالت اعتباری کسر نمی‌شود. می‌توانید عنوان دقیق‌تر یا لینک صفحه ناشر را ارسال کنید، یا با پشتیبانی تماس بگیرید.",
    en: "No credit is consumed in this case. You can send a more precise title or publisher page link, or contact support."
  },

  // ---- CTA ----
  "cta.title": { fa: "آماده شروع هستید؟", en: "Ready to start?" },
  "cta.text": {
    fa: "همین حالا در تلگرام ربات را استارت کنید و اولین مقاله خود را دریافت کنید.",
    en: "Start the bot on Telegram right now and get your first paper."
  },
  "cta.btn": { fa: "شروع در تلگرام", en: "Start on Telegram" },

  // ---- Footer ----
  "footer.desc": {
    fa: "دستیار هوشمند پژوهش — دسترسی سریع به مقالات علمی از منابع معتبر Open Access.",
    en: "Smart research assistant — fast access to scholarly papers from trusted Open Access sources."
  },
  "footer.product": { fa: "محصول", en: "Product" },
  "footer.legal": { fa: "حقوقی", en: "Legal" },
  "footer.support": { fa: "پشتیبانی", en: "Support" },
  "footer.rights": { fa: "تمام حقوق محفوظ است.", en: "All rights reserved." },

  // ---- Pages ----
  "pages.pricing.title": { fa: "تعرفه‌ها", en: "Pricing" },
  "pages.pricing.subtitle": {
    fa: "شفاف، ساده، بدون هزینه پنهان. فقط برای هر مقاله موفق اعتبار کسر می‌شود.",
    en: "Transparent, simple, no hidden fees. Only successful deliveries consume credits."
  },
  "pages.about.title": { fa: "درباره ما", en: "About us" },
  "pages.about.subtitle": { fa: "چه کسی و چرا ResearchVaultAgent را ساخت؟", en: "Who built ResearchVaultAgent and why?" },
  "pages.contact.title": { fa: "تماس با ما", en: "Contact us" },
  "pages.contact.subtitle": { fa: "پاسخ به سوالات و پشتیبانی در سریع‌ترین زمان ممکن.", en: "Fast answers and support." },
  "pages.terms.title": { fa: "قوانین و مقررات", en: "Terms of Service" },
  "pages.terms.subtitle": { fa: "شرایط استفاده از خدمات ResearchVaultAgent", en: "Terms for using ResearchVaultAgent" },
  "pages.privacy.title": { fa: "حریم خصوصی", en: "Privacy Policy" },
  "pages.privacy.subtitle": { fa: "چگونه از داده‌های شما محافظت می‌کنیم", en: "How we protect your data" },
  "pages.refund.title": { fa: "شرایط بازگشت وجه", en: "Refund Policy" },
  "pages.refund.subtitle": { fa: "تعهد ما به بازگشت وجه در شرایط خاص", en: "Our commitment to refunds in certain cases" },
};

// ==================== Language Management ====================
function getLang() {
  return localStorage.getItem("rva-lang") || "fa";
}

function setLang(lang) {
  localStorage.setItem("rva-lang", lang);
  applyLang();
}

function t(key) {
  const lang = getLang();
  return I18N[key]?.[lang] || I18N[key]?.en || key;
}

function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });

  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    el.innerHTML = t(key);
  });

  // Update active nav link
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const key = link.getAttribute("data-nav");
    const current = window.location.pathname.split("/").pop() || "index.html";
    const map = {
      home: "index.html",
      pricing: "pricing.html",
      about: "about.html",
      contact: "contact.html",
      terms: "terms.html",
      privacy: "privacy.html",
      refund: "refund.html",
    };
    if (map[key] === current) link.classList.add("nav__link--active");
  });

  // Update language toggle label
  const toggle = document.querySelector(".lang-toggle");
  if (toggle) {
    toggle.innerHTML = lang === "fa" ? "🇬🇧 English" : "🇮🇷 فارسی";
  }
}

// ==================== Header / Footer Injection ====================
function injectHeader() {
  const header = document.createElement("header");
  header.className = "header";
  header.innerHTML = `
    <div class="container header__inner">
      <a href="index.html" class="logo">
        <span class="logo__icon">
            <img src="assets/logo.png" alt="ResearchVault" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />
        </span>
        <span class="logo__text-fa">ResearchVault</span>
        <span class="logo__text-en">ResearchVault</span>
      </a>
      <nav class="nav" id="main-nav">
        <a href="index.html" class="nav__link" data-nav="home" data-i18n="nav.home"></a>
        <a href="pricing.html" class="nav__link" data-nav="pricing" data-i18n="nav.pricing"></a>
        <a href="about.html" class="nav__link" data-nav="about" data-i18n="nav.about"></a>
        <a href="contact.html" class="nav__link" data-nav="contact" data-i18n="nav.contact"></a>
      </nav>
      <div class="header__actions">
        <button class="lang-toggle" onclick="toggleLang()">🇬🇧 English</button>
        <a href="https://t.me/ResearchVaultAgentBot" target="_blank" rel="noopener" class="btn btn--primary btn--sm">
          <span data-i18n="nav.start"></span>
        </a>
        <button class="mobile-toggle" onclick="toggleMobileMenu()" aria-label="Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  document.body.insertBefore(header, document.body.firstChild);
}

function injectFooter() {
  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.innerHTML = `
    <div class="container">
      <div class="footer__grid">
        <div>
          <div class="footer__brand">
            <span class="logo__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </span>
            ResearchVault
          </div>
          <p class="footer__desc" data-i18n="footer.desc"></p>
        </div>
        <div>
          <div class="footer__title" data-i18n="footer.product"></div>
          <div class="footer__links">
            <a href="index.html" class="footer__link" data-i18n="nav.home"></a>
            <a href="pricing.html" class="footer__link" data-i18n="nav.pricing"></a>
            <a href="about.html" class="footer__link" data-i18n="nav.about"></a>
          </div>
        </div>
        <div>
          <div class="footer__title" data-i18n="footer.legal"></div>
          <div class="footer__links">
            <a href="terms.html" class="footer__link" data-i18n="nav.terms"></a>
            <a href="privacy.html" class="footer__link" data-i18n="nav.privacy"></a>
            <a href="refund.html" class="footer__link" data-i18n="nav.refund"></a>
          </div>
        </div>
        <div>
          <div class="footer__title" data-i18n="footer.support"></div>
          <div class="footer__links">
            <a href="contact.html" class="footer__link" data-i18n="nav.contact"></a>
            <a href="mailto:researchvaultagent.ai@gmail.com" class="footer__link">researchvaultagent.ai@gmail.com</a>
            <a href="https://t.me/Ata_Mahmoudinezhad" target="_blank" rel="noopener" class="footer__link">@Ata_Mahmoudinezhad</a>
          </div>
        </div>
      </div>
      <div class="footer__bottom">
        <div>© 2026 ResearchVaultAgent — <span data-i18n="footer.rights"></span></div>
        <div>
          Mojavez: <code>I17879267</code>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(footer);
}

// ==================== UI Actions ====================
function toggleLang() {
  const current = getLang();
  setLang(current === "fa" ? "en" : "fa");
}

function toggleMobileMenu() {
  document.getElementById("main-nav")?.classList.toggle("nav--open");
}

// ==================== Init ====================
document.addEventListener("DOMContentLoaded", () => {
  injectHeader();
  injectFooter();
  applyLang();
});