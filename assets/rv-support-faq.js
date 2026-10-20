import { isSupportScope, outsideSupportScope } from './rv-support-context.js';

export const SUPPORT_LINKS = Object.freeze({
  human: 'https://t.me/Ata_Mahmoudinezhad',
  articles: 'https://t.me/ResearchVaultAgentBot',
  patent_en: 'https://researchvault-patent.pages.dev/',
  patent_fa: 'https://www.researchvaultagent.ir/patent/',
});

const ANSWERS = {
  start: {
    en: 'For a patent case, create an account, review the confidentiality agreement, then upload your documents in the private portal. For research papers, send the DOI or exact title to our Telegram bot.',
    fa: 'برای پرونده اختراع، حساب بسازید، توافق‌نامه محرمانگی را بررسی کنید و مدارک را در کارتابل خصوصی بارگذاری کنید. برای دریافت مقاله، DOI یا عنوان دقیق را به ربات تلگرام بفرستید.',
  },
  documents: {
    en: 'Technical drawings: PDF, JPG or PNG. Descriptions: Word or PDF. Video: up to 20 MB and 7 minutes, reviewed by the patent agent. Audio and narration must be in English. Submit confidential technical material only inside the private case portal after the confidentiality agreement.',
    fa: 'نقشه فنی: PDF، JPG یا PNG. شرح و توضیحات: Word یا PDF. ویدیو: حداکثر ۲۰ مگابایت و ۷ دقیقه، برای بررسی کارگزار. صوت و گفتار باید انگلیسی باشد. مدارک فنی محرمانه را فقط پس از توافق‌نامه محرمانگی در کارتابل خصوصی ارسال کنید.',
  },
  confidentiality: {
    en: 'Please keep confidential invention details and documents out of this public support chat. Review the confidentiality agreement and use the private case portal for technical disclosures.',
    fa: 'جزئیات محرمانه اختراع و مدارک فنی را در چت عمومی پشتیبانی نفرستید. توافق‌نامه محرمانگی را بررسی و برای افشای فنی از کارتابل خصوصی پرونده استفاده کنید.',
  },
  tracking: {
    en: 'Sign in to your client portal to see the recorded status of your case. Public support cannot verify identity, payment or private case status. Contact the patent agent if you need help.',
    fa: 'برای مشاهده وضعیت ثبت‌شده پرونده، وارد کارتابل خود شوید. پشتیبانی عمومی به اطلاعات هویتی، پرداخت یا وضعیت خصوصی پرونده دسترسی ندارد. در صورت نیاز با کارگزار تماس بگیرید.',
  },
  articles: {
    en: 'Send a DOI such as 10.1000/example, a DOI link, or the exact paper title to ResearchVaultAgentBot. Availability is checked by the paper service; a file cannot be guaranteed in advance.',
    fa: 'DOI، لینک DOI یا عنوان دقیق مقاله را به ResearchVaultAgentBot بفرستید. دسترسی به فایل را سرویس مقاله بررسی می‌کند و دریافت هر مقاله از قبل تضمین نمی‌شود.',
  },
  human: {
    en: 'You can contact the patent agent on Telegram: @Ata_Mahmoudinezhad. A reply is subject to availability.',
    fa: 'برای گفت‌وگو با کارگزار اختراع در تلگرام به @Ata_Mahmoudinezhad پیام بدهید. پاسخ‌گویی به زمان حضور کارگزار بستگی دارد.',
  },
  pricing: {
    en: 'The international first-stage report is USD 1,111 and can be purchased separately from later services. A submitted revision requiring a new run after work begins is USD 111 per revision package. Draft edits and corrections to our mistakes are free. The invoice and accepted terms govern payment; ask the agent to confirm current availability and fees.',
    fa: 'قیمت گزارش مرحله اول برای مشتری بین‌المللی ۱۱۱۱ دلار است و مستقل از مراحل بعدی ارائه می‌شود. بازبینی نیازمند اجرای دوباره پس از شروع کار، برای هر بسته تغییرات ۱۱۱ دلار است. ویرایش پیش‌نویس و اصلاح خطای ما رایگان است. هزینه خدمات ایران را کارگزار در پیش‌فاکتور مشخص می‌کند.',
  },
};

export function faqAnswer(topic, language = 'en', scope = 'legacy') {
  const answers = scope === 'legacy' ? ANSWERS : SCOPED_ANSWERS[scope];
  return answers?.[topic]?.[language === 'fa' ? 'fa' : 'en'] || null;
}

export function faqTopic(text) {
  if (/(محرمان|افشا|nda|confidential|privacy)/iu.test(text)) return 'confidentiality';
  if (/(مدارک|نقشه|آپلود|بارگذار|ویدیو|ویدئو|documents?|drawings?|upload|video)/iu.test(text)) return 'documents';
  if (/(پیگیری|وضعیت|پرداخت.*موفق|tracking|case status|payment status)/iu.test(text)) return 'tracking';
  if (/(هزینه|قیمت|تعرفه|price|pricing|fees?|cost)/iu.test(text)) return 'pricing';
  if (/(انسان|کارگزار|اپراتور|تماس|human|contact|agent|person)/iu.test(text)) return 'human';
  if (/(مقاله|doi|papers?|articles?)/iu.test(text)) return 'articles';
  if (/(شروع|خدمات|start|services?)/iu.test(text)) return 'start';
  return null;
}

export function supportFacts(language = 'en', scope = 'legacy') {
  const answers = scope === 'legacy' ? ANSWERS : SCOPED_ANSWERS[scope];
  return Object.keys(answers || {}).map(topic => `${topic}: ${faqAnswer(topic, language, scope)}`).join('\n');
}

const SCOPED_ANSWERS = {
  articles: {
    start: {
      en: 'This is research-paper retrieval support. Send a DOI, DOI link or exact paper title to ResearchVaultAgentBot. Check the bot response for availability and the next step.',
      fa: 'این بخش پشتیبانی دریافت مقاله است. DOI، لینک DOI یا عنوان دقیق مقاله را به ResearchVaultAgentBot بفرستید و نتیجه بررسی دسترسی و مرحله بعد را در ربات دنبال کنید.',
    },
    articles: ANSWERS.articles,
    documents: {
      en: 'For a paper request, send its DOI, DOI link or exact title in ResearchVaultAgentBot. If the record is ambiguous, include the author, journal or year there.',
      fa: 'برای درخواست مقاله، DOI، لینک DOI یا عنوان دقیق آن را در ResearchVaultAgentBot ارسال کنید. اگر مشخصات مبهم است، نام نویسنده، نشریه یا سال انتشار را هم در همان ربات بنویسید.',
    },
    confidentiality: {
      en: 'Do not send account passwords, payment credentials or private documents in this public support chat. Use the article bot for your request.',
      fa: 'رمز حساب، اطلاعات حساس پرداخت یا مدارک خصوصی را در این چت عمومی نفرستید. درخواست دریافت مقاله را در ربات مقاله ثبت کنید.',
    },
    tracking: {
      en: 'Follow your paper request and the recorded delivery updates in ResearchVaultAgentBot. This public guide cannot inspect your account, balance, payment or a private order.',
      fa: 'درخواست مقاله و پیام‌های ثبت‌شده درباره تحویل را در ResearchVaultAgentBot دنبال کنید. این راهنمای عمومی به حساب، اعتبار، پرداخت یا سفارش خصوصی شما دسترسی ندارد.',
    },
    pricing: {
      en: 'Paper retrieval uses the article service credit plans. See the current plans on the Pricing page and in ResearchVaultAgentBot; confirm the final charge and payment instructions in the bot before paying.',
      fa: 'دریافت مقاله با پلن‌های اعتبار سرویس مقاله انجام می‌شود. تعرفه‌های جاری را در صفحه تعرفه‌ها و ResearchVaultAgentBot ببینید و مبلغ و روش پرداخت نهایی را پیش از پرداخت در ربات بررسی کنید.',
    },
    human: {
      en: 'For paper-service support, contact @Ata_Mahmoudinezhad on Telegram. Include the paper request reference, without passwords or payment credentials.',
      fa: 'برای پشتیبانی سرویس مقاله، در تلگرام به @Ata_Mahmoudinezhad پیام بدهید و شناسه درخواست مقاله را همراه داشته باشید؛ رمز یا اطلاعات حساس پرداخت را نفرستید.',
    },
  },
  patent_iran: {
    start: {
      en: 'This is the patent service for Iranian clients. Create an account, complete the required identity and confidentiality steps, then submit the technical disclosure in the private portal. Iran-only and Iran + PCT engagements follow the Iranian quotation and agreement.',
      fa: 'این بخش کارگزاری اختراع برای مشتری ایرانی است. حساب بسازید، مراحل لازم احراز هویت و محرمانگی را انجام دهید و سپس افشای فنی را در کارتابل خصوصی ثبت کنید. مسیر «فقط ایران» و «ایران + PCT» تابع پیش‌فاکتور و قرارداد مشتری ایرانی است.',
    },
    documents: {
      en: 'For your Iranian patent case, use PDF, JPG or PNG for technical drawings and Word or PDF for descriptions. Video is limited to 20 MB and 7 minutes for review by the agent. Follow the private portal requirements and submit confidential material only after the confidentiality steps.',
      fa: 'برای پرونده اختراع مشتری ایرانی، نقشه‌ها را با PDF، JPG یا PNG و شرح را با Word یا PDF ارائه کنید. ویدیو برای بررسی کارگزار، حداکثر ۲۰ مگابایت و ۷ دقیقه است. الزامات کارتابل را رعایت و مدارک محرمانه را فقط پس از مراحل محرمانگی در همان کارتابل ثبت کنید.',
    },
    confidentiality: ANSWERS.confidentiality,
    tracking: ANSWERS.tracking,
    pricing: {
      en: 'The Iranian service page lists indicative professional fees of 60–120 million toman for Iran-only filing and 150–350 million toman for Iran + PCT. The case-specific quotation sets the final scope, initial deposit and staged payments. Official and third-party fees are separate; national-phase entry is outside the base package.',
      fa: 'بازه راهنمای حق‌الزحمه در سایت مشتری ایرانی برای «فقط ایران» ۶۰ تا ۱۲۰ میلیون تومان و برای «ایران + PCT» ۱۵۰ تا ۳۵۰ میلیون تومان است. دامنه خدمات، بیعانه و پرداخت مرحله‌ای در پیش‌فاکتور همان پرونده تعیین می‌شود. هزینه‌های رسمی و ثالث جدا و فاز ملی خارج از بسته پایه است.',
    },
    human: {
      en: 'Contact the patent agent for your Iranian-client engagement on Telegram: @Ata_Mahmoudinezhad. Keep confidential technical documents in the private case portal.',
      fa: 'برای قرارداد و پرونده اختراع مشتری ایرانی، در تلگرام به کارگزار @Ata_Mahmoudinezhad پیام بدهید. مدارک فنی محرمانه را در کارتابل خصوصی پرونده نگه دارید.',
    },
  },
  patent_pct: {
    start: {
      en: 'This is the international PCT service. Create your account, complete the required identity and confidentiality steps, then submit the technical disclosure in the private portal. You can order the Stage 1 patentability and prior-art report on its own; drafting and filing are optional later engagements.',
      fa: 'این بخش خدمات بین‌المللی PCT است. حساب بسازید، مراحل لازم احراز هویت و محرمانگی را تکمیل و افشای فنی را در کارتابل خصوصی ثبت کنید. گزارش مرحله اول ارزیابی اختراع‌پذیری و پیشینه مستقل ارائه می‌شود و تدوین و ثبت، قراردادهای اختیاری بعدی هستند.',
    },
    documents: ANSWERS.documents,
    confidentiality: ANSWERS.confidentiality,
    tracking: ANSWERS.tracking,
    pricing: {
      en: 'International Stage 1 is USD 1,111 and can be purchased separately. A revision package requiring a new analysis run after work starts is USD 111. Draft edits before processing and corrections to our mistakes are free. The site lists PCT drafting and filing at USD 4,500–7,000, subject to a separate quotation; official fees, third-party costs and national-phase entry are separate.',
      fa: 'مرحله اول بین‌المللی ۱۱۱۱ دلار و مستقل از مراحل بعدی است. بسته ویرایش نیازمند اجرای دوباره تحلیل پس از شروع کار ۱۱۱ دلار است؛ ویرایش پیش‌نویس قبل از پردازش و اصلاح خطای ما رایگان است. بازه راهنمای تدوین و ثبت PCT در سایت ۴۵۰۰ تا ۷۰۰۰ دلار، تابع پیش‌فاکتور جداگانه است؛ هزینه رسمی، ثالث و فاز ملی جدا هستند.',
    },
    human: {
      en: 'Contact the international PCT agent on Telegram: @Ata_Mahmoudinezhad. Keep confidential invention documents in your private case portal.',
      fa: 'برای خدمات بین‌المللی PCT در تلگرام به کارگزار @Ata_Mahmoudinezhad پیام بدهید. مدارک محرمانه اختراع را در کارتابل خصوصی پرونده ارسال کنید.',
    },
  },
};

export function supportLinks(scope = 'legacy') {
  if (scope === 'articles') return Object.freeze({
    human: SUPPORT_LINKS.human, articles: SUPPORT_LINKS.articles,
    home: 'https://www.researchvaultagent.ir/', pricing: 'https://www.researchvaultagent.ir/pricing.html',
  });
  if (scope === 'patent_iran') return Object.freeze({
    human: SUPPORT_LINKS.human, home: SUPPORT_LINKS.patent_fa,
    portal: 'https://www.researchvaultagent.ir/patent/account/',
  });
  if (scope === 'patent_pct') return Object.freeze({
    human: SUPPORT_LINKS.human, home: SUPPORT_LINKS.patent_en,
    portal: 'https://researchvault-patent.pages.dev/patent/en/account/',
    payments: 'https://researchvault-patent.pages.dev/patent/en/payments/',
  });
  return SUPPORT_LINKS;
}

export function scopedGuideAnswer(text, language, scope) {
  if (!isSupportScope(scope)) return null;
  if (outsideSupportScope(text, scope)) return faqAnswer('start', language, scope);
  const topic = faqTopic(text);
  // A patent literature question is about prior art, not the paper retrieval service.
  if (topic === 'articles' && scope !== 'articles') return null;
  return faqAnswer(topic, language, scope);
}
