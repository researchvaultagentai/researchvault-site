import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { build } from '../build.mjs';
import { onRequest } from '../functions/api/[[path]].js';
import { USDT, INTERNATIONAL_ORIGIN as ORIGIN } from '../payments-config.js';
import { sanitizeText } from '../../../patent-api/src/security.js';

const output = await build();
const screenshots = process.env.PAYMENT_SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
let checks = 0;
async function setup(viewport, { signedIn = true, international = true, invoiceStatus = 'issued' } = {}) {
  const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addCookies([{ name: 'patent_session', value: 'browser-test', url: ORIGIN }]);
  const page = await context.newPage(); const errors = []; const mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  const caseRow = { id: 'case_test', public_ref: 'RV-TEST-01', title: 'Test invention <img src=x onerror=alert(1)>', pricing_market: international ? 'international' : 'iran' };
  const invoices = [{ id: 'inv_test', case_id: caseRow.id, label: 'Stage 1 — patentability report', amount_minor: 1111,
    milestone: 'stage1_deposit', status: invoiceStatus, provider: 'manual', currency: 'USD', is_refundable: 0,
    meta_json: '{}', created_at: Math.floor(Date.now() / 1000) - 300 }];
  const messages = [];
  const binding = { fetch: async req => {
    const url = new URL(req.url);
    if (url.pathname === '/api/cases/case_test' && req.method === 'GET') return Response.json({ case: caseRow, invoices, messages });
    if (url.pathname === '/api/cases/case_test/messages' && req.method === 'POST') {
      messages.push({ body: sanitizeText((await req.json()).body, 4000), created_at: Math.floor(Date.now() / 1000) });
      return Response.json({ ok: true });
    }
    throw new Error('Unexpected binding request: ' + req.method + ' ' + url.pathname);
  } };
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/api/me') return route.fulfill({ json: { user: signedIn ? { id: 'user_test' } : null } });
    if (url.pathname === '/api/cases') return route.fulfill({ json: { cases: [caseRow, { id: 'domestic', title: 'Domestic case', pricing_market: 'iran' }] } });
    if (url.pathname === '/api/cases/case_test') return route.fulfill({ json: { case: caseRow, invoices, messages } });
    if (url.pathname === '/api/international-payments/receipts') {
      mutations.push(request.postDataJSON());
      const response = await onRequest({ request: new Request(request.url(), {
        method: request.method(), headers: await request.allHeaders(), body: request.postData(),
      }), env: { PATENT_API: binding } });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    if (url.pathname === '/support/config') return route.fulfill({ json: { configured: false } });
    const file = path.join(output, url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname);
    try {
      const body = await readFile(file);
      const ext = path.extname(file);
      return route.fulfill({ body, contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[ext] || 'text/plain' });
    } catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  });
  await page.goto(ORIGIN + '/patent/en/payments/');
  await page.waitForFunction(() => !document.getElementById('paymentNotice').textContent.includes('Loading'));
  return { page, context, errors, messages, mutations };
}
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
    const { page, context, errors, messages, mutations } = await setup(viewport);
    await page.locator('#transferDetails:not(.hidden)').waitFor();
    assert.equal(await page.locator('#paymentCase option').count(), 1);
    assert.equal(await page.locator('#usdtAmount').textContent(), '1,111.00 USDT');
    assert.equal(await page.locator('#walletAddress').inputValue(), USDT.address);
    assert.equal(await page.locator('.paypal-placeholder a, .paypal-placeholder button').count(), 0);
    assert.equal(await page.locator('.billing-invoices img').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#copyWallet').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), USDT.address);
    const png = PNG.sync.read(await page.locator('.wallet-qr').screenshot());
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.equal(decoded?.data, USDT.address);
    if (screenshots && viewport.width !== 844) {
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(screenshots, `payment-${viewport.width}.png`), fullPage: true });
    }
    await page.locator('#transactionId').fill('a'.repeat(64));
    await page.locator('#receiptAcknowledged').check();
    await page.locator('#submitReceipt').click();
    await page.locator('#receiptStatus').filter({ hasText: 'Receipt saved' }).waitFor();
    assert.equal(mutations.length, 1); assert.equal(messages.length, 1);
    assert.match(messages[0].body, /NOT a settled payment/);
    assert.equal(await page.locator('.invoice-choice .small').textContent(), 'inv_test · issued');
    // Retry is safe: no second message and no second on-chain transfer.
    await page.locator('#transactionId').fill('a'.repeat(64));
    await page.locator('#receiptAcknowledged').check(); await page.locator('#submitReceipt').click();
    await page.locator('#receiptStatus').filter({ hasText: 'Receipt saved' }).waitFor();
    assert.equal(messages.length, 1);
    assert.deepEqual(errors, []); await context.close(); checks++;
  }
  for (const [options, expected] of [
    [{ signedIn: false }, 'Sign in to see your own cases'],
    [{ international: false }, 'No international case yet'],
    [{ invoiceStatus: 'paid' }, 'no invoice eligible'],
  ]) {
    const { page, context, mutations, errors } = await setup({ width: 390, height: 844 }, options);
    assert.ok((await page.locator('#paymentNotice').textContent()).includes(expected));
    assert.equal(await page.locator('#transferDetails').isVisible(), false);
    assert.equal(mutations.length, 0); assert.deepEqual(errors, []);
    await context.close(); checks++;
  }
  console.log(`Passed ${checks} international payment browser scenarios, including QR decoding, clipboard, pending receipts and domestic-case exclusion. No real payments or RPC calls were made.`);
} finally { await browser.close(); }
