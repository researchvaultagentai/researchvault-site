import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const widget = await readFile(new URL('../assets/rv-support-widget.js', import.meta.url), 'utf8');
const context = await readFile(new URL('../assets/rv-support-context.js', import.meta.url), 'utf8');
const faq = await readFile(new URL('../assets/rv-support-faq.js', import.meta.url), 'utf8');
const browser = await chromium.launch();
let checks = 0;
async function setup(language, viewport, configured = true, origin = 'https://researchvault-patent.pages.dev', pathname = '/') {
  const page = await browser.newPage({ viewport });
  const errors = []; const calls = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.turnstile = { render(_element, options) { queueMicrotask(() => options.callback('TEST_CHALLENGE')); return 1; }, remove() {} };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/assets/rv-support-widget.js') return route.fulfill({ contentType: 'text/javascript', body: widget });
    if (url.pathname === '/assets/rv-support-context.js') return route.fulfill({ contentType: 'text/javascript', body: context });
    if (url.pathname === '/assets/rv-support-faq.js') return route.fulfill({ contentType: 'text/javascript', body: faq });
    if (url.pathname === '/support/config') return route.fulfill({ json: configured
      ? { configured: true, turnstileSiteKey: '0x4_TEST_PUBLIC_KEY' } : { configured: false } });
    if (url.pathname === '/support/chat') {
      const body = route.request().postDataJSON();
      assert.equal(body.turnstileToken, 'TEST_CHALLENGE'); assert.equal(body.language, language);
      assert.equal(route.request().headers()['x-rv-support-page'], pathname);
      assert.equal(body.historyScope, origin.includes('pages.dev') ? 'patent_pct' : pathname.startsWith('/patent') ? 'patent_iran' : 'articles');
      calls.push(body);
      return route.fulfill({ json: { reply: 'Helpful reply <img src=x onerror=alert(1)>', source: 'assistant' } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="' + language +
      '" dir="' + (language === 'fa' ? 'rtl' : 'ltr') + '"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body><main><h1>ResearchVault</h1><p>Existing website content</p></main><script type="module" src="/assets/rv-support-widget.js"></script></body></html>' });
  });
  await page.goto(origin + pathname);
  await page.locator('.launcher').click();
  return { page, errors, calls };
}
try {
  for (const language of ['fa', 'en']) for (const viewport of [
    { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 },
  ]) {
    const { page, errors, calls } = await setup(language, viewport);
    const box = await page.locator('.panel').boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
    const hostDirection = await page.locator('#rv-support-widget').getAttribute('dir');
    assert.equal(hostDirection, language === 'fa' ? 'rtl' : 'ltr');
    await page.locator('textarea').fill(language === 'fa' ? 'قیمت' : 'pricing');
    await page.locator('.send').click();
    await page.waitForFunction(() => document.querySelector('#rv-support-widget').shadowRoot.querySelector('.assistant'));
    const reply = await page.locator('.assistant').last().textContent();
    assert.match(reply, language === 'fa' ? /۱۱۱۱/ : /1,111/);
    assert.equal(calls.length, 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.launcher').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(errors, []);
    await page.close(); checks++;
  }
  {
    const { page, errors, calls } = await setup('en', { width: 390, height: 844 });
    await page.locator('textarea').fill('Please explain my next step');
    await page.locator('.send').click();
    await page.locator('.assistant').filter({ hasText: 'Helpful reply' }).waitFor();
    assert.equal(calls.length, 1);
    assert.equal(await page.locator('.messages img').count(), 0);
    assert.deepEqual(errors, []);
    await page.evaluate(() => { document.documentElement.lang = 'fa'; document.documentElement.dir = 'rtl'; });
    await page.locator('.launcher').filter({ hasText: 'گفت‌وگو با پشتیبانی' }).waitFor();
    assert.equal(await page.locator('#rv-support-widget').count(), 1);
    assert.equal(await page.locator('#rv-support-widget').getAttribute('dir'), 'rtl');
    await page.close(); checks++;
  }
  {
    const { page, errors, calls } = await setup('fa', { width: 390, height: 844 }, false);
    await page.locator('textarea').fill('یک راهنمایی بیشتر می‌خواهم');
    await page.locator('.send').click();
    await page.locator('.assistant').filter({ hasText: '@Ata_Mahmoudinezhad' }).waitFor();
    assert.equal(calls.length, 0); assert.deepEqual(errors, []);
    await page.close(); checks++;
  }

  for (const [origin, pathname, language, expectedScope, heading, pricePattern, forbidden, absentChip] of [
    ['https://researchvaultagent.ir', '/', 'fa', 'articles', 'پشتیبانی دریافت مقاله', /پلن‌های اعتبار/, /۱۱۱۱|اختراع|PCT/, 'مدارک و ویدیو'],
    ['https://www.researchvaultagent.ir', '/pricing.html', 'en', 'articles', 'Paper support', /credit plans/, /1,111|patent|PCT/i, 'Documents & video'],
    ['https://www.researchvaultagent.ir', '/patent/', 'fa', 'patent_iran', 'مشتری ایرانی', /۶۰ تا ۱۲۰ میلیون تومان/, /۱۱۱۱|دلار|ResearchVaultAgentBot/, 'دریافت مقاله'],
    ['https://www.researchvaultagent.ir', '/patent/en/', 'en', 'patent_iran', 'Iran · Patent support', /60–120 million toman/, /1,111|USD|ResearchVaultAgentBot/, 'Find a paper'],
  ]) {
    const { page, calls, errors } = await setup(language, { width: 390, height: 844 }, true, origin, pathname);
    assert.equal(await page.locator('#rv-support-widget').getAttribute('data-support-scope'), expectedScope);
    assert.match(await page.locator('#rv-support-title').textContent(), new RegExp(heading));
    assert.equal(await page.locator('.chip').filter({ hasText: absentChip }).count(), 0);
    await page.locator('textarea').fill(language === 'fa' ? 'قیمت' : 'pricing');
    await page.locator('.send').click();
    await page.locator('.assistant').waitFor();
    const reply = await page.locator('.assistant').last().textContent();
    assert.match(reply, pricePattern); assert.doesNotMatch(reply, forbidden); assert.equal(calls.length, 0);
    await page.locator('textarea').fill('Please explain my next step');
    await page.locator('.send').click();
    await page.locator('.assistant').filter({ hasText: 'Helpful reply' }).waitFor();
    assert.equal(calls.length, 1); assert.deepEqual(errors, []);
    await page.close(); checks++;
  }
  {
    const { page } = await setup('en', { width: 390, height: 844 }, true, 'https://www.researchvaultagent.ir', '/patent/en/');
    await page.locator('textarea').fill('pricing');
    await page.locator('.send').click(); await page.locator('.assistant').waitFor();
    await page.evaluate(() => { document.documentElement.lang = 'fa'; });
    await page.locator('#rv-support-widget[data-support-scope="patent_iran"]').waitFor();
    await page.locator('.launcher').click();
    assert.equal(await page.locator('.assistant').count(), 0);
    await page.locator('textarea').fill('قیمت');
    await page.locator('.send').click();
    await page.locator('.assistant').filter({ hasText: '۶۰ تا ۱۲۰ میلیون تومان' }).waitFor();
    await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.locator('#rv-support-widget[data-support-scope="articles"]').waitFor();
    assert.equal(await page.locator('.assistant').count(), 0);
    await page.locator('.launcher').click();
    await page.locator('textarea').fill('قیمت');
    await page.locator('.send').click();
    await page.locator('.assistant').filter({ hasText: 'پلن‌های اعتبار' }).waitFor();
    await page.close(); checks++;
  }
  console.log('Passed ' + checks + ' browser scenarios: three service branches, language and history isolation, bilingual viewports, safe rendering and unavailable-AI fallback.');
} finally { await browser.close(); }
