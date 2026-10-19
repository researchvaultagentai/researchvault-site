import { USDT } from '../../payments-config.js';

const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOKEN_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';
// Base58Check-decoded recipient payload, excluding TRON's 41 prefix.
const RECIPIENT_HEX = '893e11ea707a206521458f5a7fbc5cd735502d5d';
const RPC = 'https://api.trongrid.io/walletsolidity/gettransactioninfobyid';

export function inspectReceipt(receipt, txid, quote, invoiceCreatedAt) {
  if (!receipt || !Object.keys(receipt).length) return 'not_solidified';
  if (receipt.Error || receipt.error) return 'unavailable';
  if (receipt.id !== txid || !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber <= 0 ||
      !Number.isSafeInteger(receipt.blockTimeStamp)) return 'unavailable';
  if (receipt.receipt?.result !== 'SUCCESS' || (receipt.result && receipt.result !== 'SUCCESS')) return 'failed';
  // A historical transaction must not be used for a newly issued invoice.
  const createdAt = Number(invoiceCreatedAt);
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) return 'unavailable';
  if (receipt.blockTimeStamp < createdAt * 1000) return 'predates_invoice';
  const logs = Array.isArray(receipt.log) ? receipt.log : [];
  for (const log of logs) {
    if (log.address?.toLowerCase() !== TOKEN_HEX || log.topics?.length !== 3 ||
        log.topics[0]?.toLowerCase() !== TRANSFER ||
        !/^[0-9a-f]{64}$/i.test(log.topics[1] || '') ||
        log.topics[2]?.toLowerCase() !== '0'.repeat(24) + RECIPIENT_HEX ||
        !/^[0-9a-f]{64}$/i.test(log.data || '')) continue;
    if (BigInt('0x' + log.data) === BigInt(quote.microUsdt)) return 'matching_transfer';
  }
  return 'no_matching_transfer';
}

export async function checkTransfer(env, txid, quote, invoiceCreatedAt, fetcher = fetch) {
  // No public polling or unkeyed production calls. Missing key keeps the
  // working manual-review flow available without pretending to verify a chain.
  if (!env.TRONGRID_API_KEY) return 'not_checked';
  try {
    const response = await fetcher(RPC, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000),
      headers: { 'content-type': 'application/json', 'TRON-PRO-API-KEY': env.TRONGRID_API_KEY },
      body: JSON.stringify({ value: txid }),
    });
    if (!response.ok) return 'unavailable';
    const reader = response.body?.getReader();
    if (!reader) return 'unavailable';
    let total = 0; const chunks = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 262144) { await reader.cancel(); return 'unavailable'; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    return inspectReceipt(JSON.parse(new TextDecoder().decode(bytes)), txid, quote, invoiceCreatedAt);
  } catch { return 'unavailable'; }
}

export const chainDescription = Object.freeze({
  not_checked: 'Not checked automatically; administrator must verify on TRON.',
  unavailable: 'Automatic lookup unavailable; administrator must verify on TRON.',
  not_solidified: 'No solidified receipt found yet; not a payment confirmation.',
  matching_transfer: `Matching ${USDT.symbol} transfer found in a solidified receipt; payer/invoice attribution and unique use still require administrator review.`,
  failed: 'The chain receipt reports failed execution; administrator review required.',
  predates_invoice: 'Transaction predates the invoice; administrator review required.',
  no_matching_transfer: 'No exact approved-token transfer to the receiving address for the invoiced amount was found; administrator review required.',
});
