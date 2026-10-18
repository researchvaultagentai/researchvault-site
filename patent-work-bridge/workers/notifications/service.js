import { requireValue } from '../../src/contracts.js';
import { metadata } from '../shared.js';

const LABELS = {
  'patent.intake_submitted': 'مدارک پرونده تکمیل شد؛ منتظر بررسی شماست.',
  'patent.checkpoint_ready': 'خروجی مرحله آماده است؛ تأیید شما لازم است.',
  'patent.pdf_finalized': 'نسخه نهایی گزارش تأیید شد.',
};

export function createPatentNotificationService(env, fetcher = fetch) {
  const configured = () => env.PATENT_TELEGRAM_ENABLED === 'true' &&
    Boolean(env.PATENT_TELEGRAM_BOT_TOKEN) && Boolean(env.PATENT_ADMIN_CHAT_ID);
  return {
    async health() {
      return { service: 'researchvault-patent-notifications', telegram_configured: configured() };
    },
    async notify(input) {
      const event = metadata(input);
      requireValue(event.destination === 'telegram_admin' && Object.hasOwn(LABELS, event.name), 'invalid_notification');
      if (!configured()) return { status: 'deferred', code: 'telegram_not_configured' };
      requireValue(/^\d+:[a-zA-Z0-9_-]{20,}$/.test(env.PATENT_TELEGRAM_BOT_TOKEN), 'invalid_bot_secret');
      requireValue(/^\d{1,20}$/.test(env.PATENT_ADMIN_CHAT_ID), 'private_admin_chat_required');
      // Metadata only. No filename, document, prompt, customer identity or password.
      const text = `Patent | ${event.case_id}\n${LABELS[event.name]}\n` +
        `Revision: ${event.input_revision}\nStage: ${event.stage || 'intake'}\nEvent: ${event.id}`;
      const response = await fetcher(`https://api.telegram.org/bot${env.PATENT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: env.PATENT_ADMIN_CHAT_ID, text, protect_content: true,
          disable_web_page_preview: true }),
      });
      let result;
      try { result = await response.json(); } catch { return { status: 'deferred', code: 'telegram_delivery_failed' }; }
      if (!response.ok || result.ok !== true || !Number.isSafeInteger(result.result?.message_id)) {
        return { status: 'deferred', code: 'telegram_delivery_failed' };
      }
      return { status: 'sent', provider_reference: String(result.result.message_id) };
    },
  };
}
