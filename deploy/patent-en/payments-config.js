// This module is emitted only by the independent international Pages build.
export const INTERNATIONAL_ORIGIN = 'https://researchvault-patent.pages.dev';
export const USDT = Object.freeze({
  symbol: 'USDT',
  network: 'TRON (TRC20)',
  address: 'TNUsw39WLVAYgRozHwGWJUtYV3RK2nXhPp',
  contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  decimals: 6,
});
export const RECEIPT_MARKER = '[RV-USDT-RECEIPT v1]';

export function receiptReference(body) {
  if (typeof body !== 'string' || !body.startsWith(RECEIPT_MARKER + ' | ')) return null;
  const invoiceId = body.match(/(?:^| \| )Invoice ID: ([a-zA-Z0-9_-]{1,100})(?= \| |$)/)?.[1];
  const transactionId = body.match(/(?:^| \| )Transaction ID: ([a-f0-9]{64})(?= \| |$)/)?.[1];
  return invoiceId && transactionId ? { invoiceId, transactionId } : null;
}

export function invoiceQuote(invoice, caseId) {
  if (!invoice || invoice.case_id !== caseId || invoice.currency !== 'USD' ||
      !['manual', 'usdt'].includes(invoice.provider) ||
      !['issued', 'pending'].includes(invoice.status)) return null;
  const stored = Number(invoice.amount_minor);
  if (!Number.isSafeInteger(stored) || stored <= 0) return null;
  let meta;
  try { meta = JSON.parse(invoice.meta_json || '{}'); } catch { return null; }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  // The existing admin form stores/displays whole USD, despite the legacy
  // column name amount_minor. Never silently divide those invoices by 100.
  // A future cents-based issuer must explicitly declare usd_amount_unit=cents.
  const unit = meta.usd_amount_unit || 'dollars';
  if (!['dollars', 'cents'].includes(unit)) return null;
  const cents = unit === 'cents' ? stored : stored * 100;
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) return null;
  const milestone = String(invoice.milestone || '');
  if (['stage1', 'stage1_deposit'].includes(milestone) && cents !== 111_100) return null;
  if (['stage1_revision', 'revision'].includes(milestone) && cents !== 11_100) return null;
  return Object.freeze({
    invoiceId: invoice.id,
    usd: (cents / 100).toFixed(2),
    usdt: (cents / 100).toFixed(2),
    microUsdt: String(BigInt(cents) * 10_000n),
    nonRefundable: Number(invoice.is_refundable) === 0,
  });
}
