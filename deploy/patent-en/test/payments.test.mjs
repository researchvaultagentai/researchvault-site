import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { USDT, INTERNATIONAL_ORIGIN as ORIGIN, RECEIPT_MARKER, invoiceQuote } from '../payments-config.js';
import { onRequest } from '../functions/api/[[path]].js';
import { inspectReceipt, checkTransfer } from '../functions/_lib/tron-receipt.js';
import { submitInternationalReceipt } from '../functions/_lib/international-payments.js';
import { sanitizeText } from '../../../patent-api/src/security.js';

const TX = '1'.repeat(64);
const CREATED = 1792380000;
const NOW = (CREATED + 600) * 1000;
const invoice = (changes = {}) => ({ id: 'inv_1', case_id: 'case_1', amount_minor: 1111,
  milestone: 'stage1_deposit', label: 'Stage 1 patentability', status: 'issued', currency: 'USD',
  provider: 'manual', is_refundable: 0, created_at: CREATED, meta_json: '{}', ...changes });
const input = (changes = {}) => ({ case_id: 'case_1', invoice_id: 'inv_1', transaction_id: TX, acknowledged: true, ...changes });
const request = (data = input(), changes = {}) => new Request(ORIGIN + '/api/international-payments/receipts', {
  method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: 'patent_session=test' },
  body: JSON.stringify(data), ...changes,
});
const receipt = () => ({ id: TX, blockNumber: 123, blockTimeStamp: (CREATED + 60) * 1000,
  receipt: { result: 'SUCCESS' }, log: [{ address: 'a614f803b6fd780986a42c78ec9c7f77e6ded13c', topics: [
    'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0'.repeat(24) + '1'.repeat(40), '0'.repeat(24) + '893e11ea707a206521458f5a7fbc5cd735502d5d',
  ], data: BigInt(1111_000000).toString(16).padStart(64, '0') }] });

function portal({ caseRow = { id: 'case_1', pricing_market: 'international' }, invoices = [invoice()],
  messages = [], authStatus = 200, saveStatus = 200 } = {}) {
  const calls = []; const saved = [];
  return { calls, saved, env: { PATENT_API: { fetch: async req => {
    calls.push(req); const url = new URL(req.url);
    assert.equal(url.origin, ORIGIN);
    assert.equal(req.headers.get('cookie'), 'patent_session=test');
    if (req.method === 'GET' && url.pathname === '/api/cases/case_1') return Response.json({ case: caseRow, invoices, messages }, { status: authStatus });
    assert.equal(req.method, 'POST'); assert.equal(url.pathname, '/api/cases/case_1/messages');
    // Match the real shared case-message writer, including its newline removal.
    saved.push(sanitizeText((await req.json()).body, 4000)); return Response.json({ ok: saveStatus === 200 }, { status: saveStatus });
  } } } };
}

function base58Payload(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) { const digit = alphabet.indexOf(character); assert.ok(digit >= 0); number = number * 58n + BigInt(digit); }
  const bytes = Buffer.from(number.toString(16).padStart(50, '0'), 'hex');
  const payload = bytes.subarray(0, -4);
  const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  assert.deepEqual(bytes.subarray(-4), checksum); assert.equal(payload[0], 0x41);
  return payload.subarray(1).toString('hex');
}

test('published addresses have valid TRON checksums and match the receipt decoder', () => {
  assert.equal(base58Payload(USDT.address), receipt().log[0].topics[2].slice(24));
  assert.equal(base58Payload(USDT.contract), receipt().log[0].address);
  assert.equal(USDT.decimals, 6);
});

test('invoice amount follows the actual existing admin units, with explicit future cents support', () => {
  assert.equal(invoiceQuote(invoice(), 'case_1').usdt, '1111.00');
  assert.equal(invoiceQuote(invoice({ amount_minor: 111100, meta_json: '{"usd_amount_unit":"cents"}' }), 'case_1').usdt, '1111.00');
  assert.equal(invoiceQuote(invoice({ amount_minor: 111, milestone: 'stage1_revision' }), 'case_1').usdt, '111.00');
  assert.equal(invoiceQuote(invoice({ amount_minor: 111100 }), 'case_1'), null);
  assert.equal(invoiceQuote(invoice({ amount_minor: 1500 }), 'case_1'), null);
  for (const changes of [
    { currency: 'IRT' }, { case_id: 'another' }, { status: 'paid' }, { status: 'partially_paid' },
    { status: 'draft' }, { status: 'expired' }, { amount_minor: 0 }, { amount_minor: 1.1 },
    { provider: 'paypal' }, { provider: 'zarinpal' }, { meta_json: 'invalid' },
    { meta_json: '{"usd_amount_unit":"unknown"}' },
  ]) assert.equal(invoiceQuote(invoice(changes), 'case_1'), null, JSON.stringify(changes));
});

test('receipt route refuses preview, domestic-host and CSRF requests before touching cases', async () => {
  const mock = portal();
  for (const req of [
    new Request('https://www.researchvaultagent.ir/api/international-payments/receipts', { method: 'POST', body: '{}' }),
    new Request('https://preview.researchvault-patent.pages.dev/api/international-payments/receipts', { method: 'POST', body: '{}' }),
    request(input(), { headers: { origin: 'https://other.example', 'content-type': 'application/json' } }),
    request(input(), { headers: { 'content-type': 'application/json' } }),
  ]) assert.equal((await onRequest({ request: req, env: mock.env })).status, 403);
  assert.equal(mock.calls.length, 0);
});

test('malformed, oversized, unacknowledged and non-JSON receipts cannot create case messages', async () => {
  const mock = portal();
  const bad = [
    [request(input({ transaction_id: 'fake' })), 400],
    [request(input({ case_id: ['case_1'] })), 400],
    [request(input({ case_id: '../admin' })), 400],
    [request(input({ acknowledged: false })), 422],
    [request(input(), { body: '{' }), 400],
    [request(input({ data: 'x'.repeat(3000) })), 413],
    [request(input(), { headers: { origin: ORIGIN, 'content-type': 'text/plain' } }), 415],
  ];
  for (const [req, status] of bad) assert.equal((await onRequest({ request: req, env: mock.env })).status, status);
  assert.equal(mock.calls.length, 0);
});

test('existing patent authentication and ownership are required; no admin token is used', async () => {
  for (const status of [401, 403, 404]) {
    const mock = portal({ authStatus: status });
    assert.equal((await onRequest({ request: request(), env: mock.env })).status, status);
    assert.equal(mock.saved.length, 0);
  }
});

test('even an authenticated Iranian case, IRT invoice or another-case invoice is ineligible on the English host', async () => {
  for (const mock of [
    portal({ caseRow: { id: 'case_1', pricing_market: 'iran' } }),
    portal({ invoices: [invoice({ currency: 'IRT' })] }),
    portal({ invoices: [invoice({ case_id: 'case_2' })] }),
    portal({ invoices: [invoice({ status: 'paid' })] }),
  ]) {
    const response = await onRequest({ request: request(), env: mock.env });
    assert.ok([403, 409].includes(response.status)); assert.equal(mock.saved.length, 0);
  }
});

test('a real invoice stores a pending client receipt without any settlement, release, or RPC call', async () => {
  const mock = portal(); let externalCalls = 0;
  const response = await submitInternationalReceipt(request(input({ amount: 1, wallet: 'attacker', paid: true })), mock.env, {
    fetcher: async () => { externalCalls++; throw new Error('must not be called without key'); },
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, status: 'pending_review', invoice_paid: false, blockchain_check: 'not_checked' });
  assert.equal(externalCalls, 0); assert.equal(mock.saved.length, 1);
  assert.ok(mock.saved[0].includes('Expected receipt: 1111.00 USDT'));
  assert.ok(mock.saved[0].includes('Receiving address: ' + USDT.address));
  assert.ok(mock.saved[0].includes('NOT a settled payment'));
  assert.ok(mock.saved[0].includes('payer/invoice attribution'));
  assert.ok(!mock.saved[0].includes('attacker'));
  assert.deepEqual(mock.calls.map(req => req.method), ['GET', 'POST']);
});

test('sequential retry does not duplicate a receipt; reuse for another invoice is blocked within the case', async () => {
  const first = portal(); await submitInternationalReceipt(request(), first.env);
  const body = first.saved[0];
  const again = portal({ messages: [{ body, created_at: CREATED }] });
  const response = await submitInternationalReceipt(request(), again.env);
  assert.equal((await response.json()).already_submitted, true); assert.equal(again.saved.length, 0);
  const other = portal({ invoices: [invoice({ id: 'inv_2' })], messages: [{ body }] });
  assert.equal((await submitInternationalReceipt(request(input({ invoice_id: 'inv_2' })), other.env)).status, 409);
  assert.equal(other.saved.length, 0);
});

test('receipt bursts are limited and save failures never report receipt success', async () => {
  const limited = portal({ messages: [1, 2, 3].map(() => ({ body: RECEIPT_MARKER + ' | other', created_at: NOW / 1000 })) });
  assert.equal((await submitInternationalReceipt(request(), limited.env, { now: () => NOW })).status, 429);
  assert.equal(limited.saved.length, 0);
  const failed = portal({ saveStatus: 503 });
  const response = await onRequest({ request: request(), env: failed.env });
  assert.equal(response.status, 503); assert.match((await response.json()).message, /not saved/);
});

test('optional chain inspection checks exact token, transfer event, recipient, amount, success and invoice date', () => {
  const quote = invoiceQuote(invoice(), 'case_1');
  assert.equal(inspectReceipt(receipt(), TX, quote, CREATED), 'matching_transfer');
  assert.equal(inspectReceipt({}, TX, quote, CREATED), 'not_solidified');
  for (const mutate of [
    r => r.log[0].address = 'f'.repeat(40),
    r => r.log[0].topics[0] = 'f'.repeat(64),
    r => r.log[0].topics[2] = 'f'.repeat(64),
    r => r.log[0].data = '0'.repeat(63) + '1',
    r => r.log[0].data = 'not a number',
  ]) { const r = receipt(); mutate(r); assert.equal(inspectReceipt(r, TX, quote, CREATED), 'no_matching_transfer'); }
  const failed = receipt(); failed.receipt.result = 'REVERT';
  assert.equal(inspectReceipt(failed, TX, quote, CREATED), 'failed');
  const stale = receipt(); stale.blockTimeStamp = (CREATED - 1) * 1000;
  assert.equal(inspectReceipt(stale, TX, quote, CREATED), 'predates_invoice');
  const wrongTx = receipt(); wrongTx.id = '2'.repeat(64);
  assert.equal(inspectReceipt(wrongTx, TX, quote, CREATED), 'unavailable');
});

test('optional lookup is bounded, fixed to mainnet solidity API, and sends only the RPC key and txid', async () => {
  let calls = 0; const quote = invoiceQuote(invoice(), 'case_1');
  const result = await checkTransfer({ TRONGRID_API_KEY: 'test-key' }, TX, quote, CREATED, async (url, options) => {
    calls++; assert.equal(url, 'https://api.trongrid.io/walletsolidity/gettransactioninfobyid');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers['TRON-PRO-API-KEY'], 'test-key');
    assert.equal(Object.keys(options.headers).length, 2); assert.deepEqual(JSON.parse(options.body), { value: TX });
    return Response.json(receipt());
  });
  assert.equal(result, 'matching_transfer'); assert.equal(calls, 1);
  assert.equal(await checkTransfer({ TRONGRID_API_KEY: 'test' }, TX, quote, CREATED, async () => new Response(null, { status: 429 })), 'unavailable');
  assert.equal(await checkTransfer({ TRONGRID_API_KEY: 'test' }, TX, quote, CREATED, async () => new Response('x'.repeat(262145))), 'unavailable');
});

test('even a matching solidified transfer remains pending until independent administrator verification', async () => {
  const mock = portal(); mock.env.TRONGRID_API_KEY = 'test';
  const response = await submitInternationalReceipt(request(), mock.env, { fetcher: async () => Response.json(receipt()) });
  const result = await response.json();
  assert.equal(result.blockchain_check, 'matching_transfer');
  assert.equal(result.invoice_paid, false); assert.equal(result.status, 'pending_review');
  assert.ok(mock.saved[0].includes('unique use still require administrator review'));
  assert.ok(mock.calls.every(req => !/mark-paid|documents|password|admin/.test(req.url)));
});
