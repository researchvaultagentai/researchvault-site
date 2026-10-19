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

export function faqAnswer(topic, language = 'en') {
  return ANSWERS[topic]?.[language === 'fa' ? 'fa' : 'en'] || null;
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

export function supportFacts(language = 'en') {
  return Object.keys(ANSWERS).map(topic => `${topic}: ${faqAnswer(topic, language)}`).join('\n');
}
