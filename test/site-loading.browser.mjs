import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://www.researchvaultagent.ir';
const articlePages = ['index.html', 'about.html', 'contact.html', 'pricing.html', 'privacy.html', 'refund.html', 'terms.html', '404.html'];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const browser = await chromium.launch();
let checks = 0;

async function prepare({ javaScriptEnabled = true, pendingMain = false, pendingFont = false, denyStorage = false, language = 'fa', width = 390 } = {}) {
  const context = await browser.newContext({ javaScriptEnabled, viewport: { width, height: 844 } });
  const page = await context.newPage();
  const errors = [], requests = [];
  let releaseMain, releaseFont;
  const mainGate = new Promise(resolve => { releaseMain = resolve; });
  const fontGate = new Promise(resolve => { releaseFont = resolve; });
  page.on('pageerror', e => errors.push(e.message));
  if (javaScriptEnabled) await page.addInitScript(({ denyStorage, language }) => {
    if (denyStorage) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
    else localStorage.setItem('rva-lang', language);
  }, { denyStorage, language });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.origin !== origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/support/')) return route.abort();
    if (url.pathname.endsWith('.css')) return route.abort(); // HTML must carry its own layout.
    if (pendingMain && url.pathname === '/js/main.js') await mainGate;
    if (pendingFont && url.pathname.endsWith('.woff2')) await fontGate;
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    if (!extname(path)) path += '.html';
    const filename = resolve(root, '.' + path);
    if (!filename.startsWith(root)) return route.abort();
    try {
      const body = await readFile(filename);
      return route.fulfill({ status: path === '/404.html' ? 404 : 200, contentType: types[extname(path)] || 'application/octet-stream', body });
    } catch { return route.abort(); }
  });
  return { page, context, errors, requests, releaseMain, releaseFont };
}

async function assertArticleReadable(page, file) {
  const key = file === 'index.html' ? 'hero.title1' : file === 'pricing.html' ? 'pricing.title' : `pages.${file.replace('.html', '')}.title`;
  const heading = file === '404.html' ? page.locator('h1') : page.locator(`[data-i18n="${key}"]`);
  await heading.waitFor({ state: 'visible' });
  assert.ok((await heading.innerText()).trim().length > 2, `${file}: visible heading cannot be empty`);
  assert.equal(await page.locator('#main-nav').count(), 1);
  assert.equal(await page.locator('#main-nav').isVisible(), true);
  assert.equal(await page.locator('#main-nav a').count(), 4);
  assert.equal(await page.locator('body > header').count(), 1);
  assert.equal(await page.locator('body > footer').count(), 1);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(10, 22, 40)');
  assert.deepEqual(await page.locator('[data-i18n]').evaluateAll(els => els.filter(e => !e.textContent.trim()).map(e => e.getAttribute('data-i18n'))), []);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
}

try {
  // All article pages remain complete with JavaScript and external CSS unavailable.
  for (const width of [390, 1440]) for (const file of articlePages) {
    const t = await prepare({ javaScriptEnabled: false, width });
    await t.page.goto(origin + (file === 'index.html' ? '/' : '/' + file), { waitUntil: 'domcontentloaded' });
    await assertArticleReadable(t.page, file);
    assert.equal(t.requests.some(u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com'), false);
    await t.context.close(); checks++;
  }
  // Hold the real main script and font indefinitely, rather than returning a fast failure.
  for (const file of ['index.html', 'pricing.html']) {
    const t = await prepare({ pendingMain: true, pendingFont: true });
    try {
      await t.page.goto(origin + (file === 'index.html' ? '/' : '/' + file), { waitUntil: 'commit' });
      await assertArticleReadable(t.page, file);
      assert.equal(await t.page.evaluate(() => document.readyState), 'loading');
    } finally { t.releaseMain(); t.releaseFont(); await t.context.close(); }
    checks++;
  }
  // Storage restrictions cannot abort initialization or the language switcher.
  for (const denyStorage of [false, true]) {
    const t = await prepare({ denyStorage });
    await t.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await assertArticleReadable(t.page, 'index.html');
    await t.page.locator('.lang-toggle').click();
    assert.equal(await t.page.locator('[data-i18n="hero.title1"]').innerText(), 'Easy access to');
    await t.page.locator('.lang-toggle').click();
    assert.equal(await t.page.locator('[data-i18n="hero.title1"]').innerText(), 'دسترسی آسان به');
    assert.deepEqual(t.errors, []);
    await t.context.close(); checks++;
  }
  // Preserve saved English preference and the existing Iranian credit prices.
  {
    const t = await prepare({ language: 'en' });
    await t.page.goto(origin + '/pricing.html', { waitUntil: 'domcontentloaded' });
    assert.equal(await t.page.locator('[data-i18n="pricing.title"]').innerText(), 'Choose your plan');
    assert.equal(await t.page.locator('#main-nav').count(), 1);
    assert.deepEqual(t.errors, []);
    await t.context.close(); checks++;
  }
  // Patent headings, navigation and styling also survive unavailable assets/scripts.
  for (const path of ['/patent/', '/patent/en/']) for (const javaScriptEnabled of [false, true]) {
    const t = await prepare({ javaScriptEnabled, pendingFont: true });
    try {
      await t.page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await t.page.locator('h1').waitFor({ state: 'visible' });
      assert.equal(await t.page.locator('body > .topbar').count(), 1);
      assert.equal(await t.page.locator('body > .footer').count(), 1);
      assert.equal(await t.page.locator('.topbar .nav').isVisible(), true);
      const background = await t.page.locator('.btn-primary').first().evaluate(e => getComputedStyle(e).backgroundColor);
      assert.notEqual(background, 'rgba(0, 0, 0, 0)');
      assert.equal(await t.page.evaluate(() => getComputedStyle(document.body).margin), '0px');
      if (path.includes('/en/')) {
        assert.equal(await t.page.locator('a[href="/patent/en/wizard.html"]').count(), 1);
        assert.equal(await t.page.locator('.topbar a[href="/patent/en/account/"]').count(), 0);
      }
      assert.deepEqual(t.errors, []);
    } finally { t.releaseFont(); await t.context.close(); }
    checks++;
  }
  // The slow official document.write badge must not hold the parent DOM ready event.
  {
    const t = await prepare();
    let releaseBadge, sawBadge;
    const gate = new Promise(resolve => { releaseBadge = resolve; });
    const requested = new Promise(resolve => { sawBadge = resolve; });
    await t.page.route('https://www.zarinpal.com/webservice/TrustCode', async route => {
      sawBadge(); await gate;
      return route.fulfill({ contentType: 'text/javascript', body: `document.write('<a href="javascript:showZPTrust()"><img alt="Official badge"></a>');function showZPTrust(){return true;}` });
    });
    try {
      await t.page.goto(origin, { waitUntil: 'domcontentloaded' });
      await assertArticleReadable(t.page, 'index.html');
      assert.equal(await t.page.locator('iframe[title="نماد درگاه زرین‌پال"]').getAttribute('loading'), 'lazy');
      await t.page.locator('iframe[title="نماد درگاه زرین‌پال"]').scrollIntoViewIfNeeded();
      await requested; // Hold the real child request while using the parent page.
      assert.notEqual(await t.page.evaluate(() => document.readyState), 'loading');
      await t.page.locator('.lang-toggle').click();
      assert.equal(await t.page.locator('[data-i18n="hero.title1"]').innerText(), 'Easy access to');
      releaseBadge();
      await t.page.frameLocator('iframe[title="نماد درگاه زرین‌پال"]').getByRole('img', { name: 'Official badge' }).waitFor();
      assert.deepEqual(t.errors, []);
    } finally { releaseBadge(); await t.context.close(); }
    checks++;
  }
  console.log(`Passed ${checks} loading scenarios: readable HTML without JS/CSS, delayed main script and font, denied storage, preserved English preference, Iranian patent scope, and isolated official trust badge.`);
} finally { await browser.close(); }
