// Service scope is determined by the production hostname and page path.
// Language is presentation only: /patent/en on .ir remains the Iranian service.
export const SUPPORT_SCOPES = Object.freeze(['articles', 'patent_iran', 'patent_pct']);

export function supportScopeForPage(origin, pathname = '/') {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//') ||
      pathname.length > 500 || /[?#\\\x00-\x20]/u.test(pathname) || /%(?:2f|5c)/iu.test(pathname)) return null;
  if (origin === 'https://researchvault-patent.pages.dev') return 'patent_pct';
  if (origin === 'https://researchvaultagent.ir' || origin === 'https://www.researchvaultagent.ir') {
    return /^\/patent(?:\/|$)/u.test(pathname) ? 'patent_iran' : 'articles';
  }
  return null;
}

export function isSupportScope(scope) {
  return SUPPORT_SCOPES.includes(scope);
}

const PATENT = /اختراع|پتنت|ادعانامه|\b(?:patents?|inventions?|pct)\b/iu;
const ARTICLE = /مقاله|\b(?:doi|papers?|articles?)\b|ResearchVaultAgentBot/iu;
const DOMESTIC = /تومان|تومن|ریال|\b(?:toman|rials?|irr|irt)\b|(?:مشتری|تعرفه|ثبت).{0,15}ایران|Iran(?:ian)?\s+(?:clients?|fees?|filing|prices?)/iu;
const INTERNATIONAL = /\b(?:usd|usdt|trc20|paypal)\b|دلار|مشتری.{0,15}خارج|(?:international|foreign)\s+(?:clients?|fees?|prices?)|researchvault-patent\.pages\.dev/iu;

export function outsideSupportScope(text, scope) {
  if (!isSupportScope(scope) || typeof text !== 'string') return false;
  if (scope === 'articles') return PATENT.test(text) || /\b(?:usdt|trc20|paypal)\b/iu.test(text);
  if (ARTICLE.test(text) && !PATENT.test(text) && !/prior.?art|پیشینه|literature|non.patent/iu.test(text)) return true;
  if (scope === 'patent_iran') return INTERNATIONAL.test(text);
  return DOMESTIC.test(text);
}

// A model cannot introduce another branch's sales content, links or currency.
// This is a final conservative guard in addition to separate facts and prompts.
export function supportReplyInScope(text, scope) {
  if (!isSupportScope(scope) || typeof text !== 'string' || !text.trim()) return false;
  if (scope === 'articles') return !PATENT.test(text) &&
    !/\b(?:usdt|trc20|paypal)\b|1[,\s]?111|۱[٬,\s]?۱۱۱|\/patent(?:\/|\b)/iu.test(text);
  if (/ResearchVaultAgentBot|(?:find|retrieve|download)\s+(?:a\s+|research\s+)?(?:papers?|articles?)|(?:دریافت|یافتن|دانلود)\s+مقاله/iu.test(text)) return false;
  if (scope === 'patent_iran') return !INTERNATIONAL.test(text) &&
    !/\$\s*\d|1[,\s]?111|۱[٬,\s]?۱۱۱|\b111\b|۱۱۱/iu.test(text);
  return !DOMESTIC.test(text) && !/https?:\/\/(?:www\.)?researchvaultagent\.ir(?:[\/\s]|$)/iu.test(text);
}
