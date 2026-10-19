import { directIntent } from '../workers/support/service.js';

function deadline(task, ms) {
  let timer;
  return Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('support_timeout')), ms); })])
    .finally(() => clearTimeout(timer));
}

// Call only after the existing webhook authentication, deduplication and user
// state checks. Returning handled:false means run the ORIGINAL handler unchanged.
// Never change setWebhook/getUpdates, existing commands, queue logic or payments.
export async function routeTelegramSupport({ update, support, mode = '', language, onArticle, onReply, onPatents, timeoutMs = 2500 }) {
  const message = update?.message;
  if (!message || message.chat?.type !== 'private' || typeof message.text !== 'string' || !message.text.trim()) {
    return { handled: false };
  }
  const text = message.text.trim();
  const locale = ['fa', 'en'].includes(language) ? language : (/[\u0600-\u06ff]/u.test(text) ? 'fa' : 'en');
  const immediate = directIntent(text, mode);
  if (immediate?.kind === 'passthrough') return { handled: false };
  // Existing DOI/title handling has priority and does not depend on model uptime.
  if (['article_doi', 'article_title'].includes(immediate?.kind)) {
    if (!onArticle) return { handled: false };
    return { handled: true, result: await onArticle({ update, query: immediate.query, kind: immediate.kind }) };
  }
  let intent = immediate;
  if (!intent) {
    if (!support?.classify) return { handled: false };
    try { intent = await deadline(support.classify({ text, mode, language: locale }), timeoutMs); }
    catch { return { handled: false }; }
  }
  if (intent?.kind === 'passthrough' || !intent) return { handled: false };
  if (['article_doi', 'article_title'].includes(intent.kind)) {
    if (!onArticle) return { handled: false };
    return { handled: true, result: await onArticle({ update, query: text, kind: intent.kind }) };
  }
  if (intent.kind === 'patent' && onPatents) {
    return { handled: true, result: await onPatents({ update }) };
  }
  if (!support?.chat || !onReply) return { handled: false };
  let response;
  try { response = await deadline(support.chat({ message: text, language: locale }), Math.max(timeoutMs, 8000)); }
  catch { return { handled: false }; }
  // Do not swallow onReply failure after a send attempt and re-run the original
  // handler: a lost response could otherwise cause duplicate/conflicting replies.
  return { handled: true, result: await onReply({ update, reply: response.reply, links: response.links }) };
}
