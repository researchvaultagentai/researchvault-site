import { INTERNATIONAL_ORIGIN, USDT, RECEIPT_MARKER, invoiceQuote, receiptReference } from '../../payments-config.js';
import { chainDescription, checkTransfer } from './tron-receipt.js';

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const TXID = /^[0-9a-fA-F]{64}$/;
const reply = (status, body) => Response.json(body, { status, headers: {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
} });
const fail = (status, message) => reply(status, { ok: false, message });

function portalRequest(request, path, body) {
  const headers = new Headers(request.headers);
  headers.delete('content-length'); headers.delete('transfer-encoding');
  headers.set('origin', INTERNATIONAL_ORIGIN);
  if (body) headers.set('content-type', 'application/json');
  return new Request(INTERNATIONAL_ORIGIN + path, {
    method: body ? 'POST' : 'GET', headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

export async function submitInternationalReceipt(request, env, dependencies = {}) {
  // Defense in depth; this handler is also behind the English API proxy guard.
  if (new URL(request.url).origin !== INTERNATIONAL_ORIGIN ||
      request.headers.get('origin') !== INTERNATIONAL_ORIGIN) return fail(403, 'Same-origin request required');
  if (request.method !== 'POST') return fail(405, 'Method not allowed');
  if (!env.PATENT_API?.fetch) return fail(503, 'Patent portal is not connected yet');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail(415, 'JSON required');
  const reader = request.body?.getReader();
  if (!reader) return fail(400, 'Receipt request required');
  let size = 0; const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); return fail(413, 'Receipt request too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const value of chunks) { bytes.set(value, offset); offset += value.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  let input;
  try { input = JSON.parse(raw); } catch { return fail(400, 'Invalid JSON'); }
  if (!input || typeof input.case_id !== 'string' || typeof input.invoice_id !== 'string' ||
      typeof input.transaction_id !== 'string' || !ID.test(input.case_id) || !ID.test(input.invoice_id) ||
      !TXID.test(input.transaction_id)) return fail(400, 'Choose an invoice and enter its 64-character TRON transaction ID');
  if (input.acknowledged !== true) return fail(422, 'Please acknowledge the transfer and review terms');
  const txid = input.transaction_id.toLowerCase();
  const path = '/api/cases/' + encodeURIComponent(input.case_id);
  const snapshotResponse = await env.PATENT_API.fetch(portalRequest(request, path));
  if (!snapshotResponse.ok) return fail([401, 403, 404].includes(snapshotResponse.status) ? snapshotResponse.status : 503, 'Sign in and select a case you own');
  const snapshot = await snapshotResponse.json();
  if (snapshot.case?.id !== input.case_id || snapshot.case?.pricing_market !== 'international') {
    return fail(403, 'International cases only');
  }
  const invoice = snapshot.invoices?.find(item => item.id === input.invoice_id);
  const quote = invoiceQuote(invoice, input.case_id);
  if (!quote) return fail(409, 'This invoice is not eligible for a new USDT payment. Contact support before transferring.');
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const prior = messages.map(item => receiptReference(item.body)).find(item => item?.transactionId === txid);
  if (prior) {
    if (prior.invoiceId !== invoice.id) return fail(409, 'This transaction was already submitted for another invoice; contact support');
    return reply(200, { ok: true, status: 'pending_review', invoice_paid: false, already_submitted: true });
  }
  const now = dependencies.now ? dependencies.now() : Date.now();
  if (messages.filter(item => item.body?.startsWith(RECEIPT_MARKER + ' | ') &&
      Number(item.created_at) * 1000 > now - 600000).length >= 3) return fail(429, 'Please allow time for review before submitting another receipt');
  const chain = await checkTransfer(env, txid, quote, invoice.created_at, dependencies.fetcher);
  const body = [
    RECEIPT_MARKER,
    'Client payment-review request. NOT a settled payment or permission to release a report/password.',
    'Case ID: ' + input.case_id,
    'Invoice ID: ' + invoice.id,
    'Invoice amount: USD ' + quote.usd,
    'Expected receipt: ' + quote.usdt + ' USDT on TRON (TRC20)',
    'Receiving address: ' + USDT.address,
    'Token contract: ' + USDT.contract,
    'Transaction ID: ' + txid,
    'Explorer: https://tronscan.org/#/transaction/' + txid,
    'Chain lookup: ' + chainDescription[chain],
    'Customer acknowledged the receiving network, invoice amount and pending manual review.',
    'ADMIN: independently check the solidified successful USDT transfer, net amount, payer/invoice attribution and that the transaction has not settled another invoice. Client messages are not settlement evidence. Mark paid only after those checks.',
  ].join(' | ');
  // Store through the existing authenticated case-message API. Do not mutate
  // invoices/payments, grant admin privileges, or call the domestic adapters.
  const saved = await env.PATENT_API.fetch(portalRequest(request, path + '/messages', { body }));
  if (!saved.ok) return fail(503, 'Receipt was not saved. Keep your transaction ID and retry; do not send another transfer.');
  return reply(202, { ok: true, status: 'pending_review', invoice_paid: false, blockchain_check: chain });
}
