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

async function prepare({ javaScriptEnabled = true, pendingMain = false, pendingFont = false, denyStorage = false, failImages = false, language = 'fa', width = 390 } = {}) {
  const context = await browser.newContext({ javaScriptEnabled, viewport: { width, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(15_000);
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
    if (failImages && route.request().resourceType() === 'image') return route.abort();
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
  const key = file === 'index.html' ? 'hero.title1' : `pages.${file.replace('.html', '')}.title`;
  const heading = file === '404.html' ? page.locator('h1') : page.locator(`[data-i18n="${key}"]`);
  await heading.waitFor({ state: 'visible' });
  assert.ok((await heading.innerText()).trim().length > 2, `${file}: visible heading cannot be empty`);
  assert.equal(await page.locator('#main-nav').count(), 1);
  if (!await page.locator('#main-nav').isVisible()) {
    await page.locator('.mobile-toggle').click();
    assert.equal(await page.locator('#main-nav').isVisible(), true);
    await page.locator('.mobile-toggle').click();
  }
  assert.equal(await page.locator('#main-nav a').count(), 4);
  assert.equal(await page.locator('body > header').count(), 1);
  assert.equal(await page.locator('body > footer').count(), 1);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(10, 22, 40)');
  assert.deepEqual(await page.locator('[data-i18n]').evaluateAll(els => els.filter(e => !e.textContent.trim()).map(e => e.getAttribute('data-i18n'))), []);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
}

async function visualProof(page, name) {
  if (!process.env.GITHUB_ACTIONS) return;
  const bytes = await page.screenshot({ type: 'jpeg', quality: 65 });
  console.log(`RVA_LOADING_PROOF:${name}:${bytes.toString('base64')}:END_RVA_LOADING_PROOF`);
}

try {
  // A failed image request is the reported production symptom. Critical art
  // must actually decode with every network image blocked, even without JS.
  for (const path of ['/', '/patent/', '/patent/en/']) for (const width of [390, 1440]) for (const javaScriptEnabled of [false, true]) {
    const t = await prepare({ failImages: true, javaScriptEnabled, width });
    await t.page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    const images = t.page.locator('[data-rv-page-image]');
    assert.equal(await images.count(), path === '/' ? 2 : 1);
    await images.evaluateAll(els => Promise.all(els.map(img => img.decode())));
    assert.ok((await images.evaluateAll(els => els.map(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0))).every(Boolean));
    assert.equal(t.requests.some(u => /\/(?:logo|banner|patent-hero-robot)\.(?:png|webp)$/.test(u.pathname)), false,
      'Critical art cannot depend on a separate network request');
    assert.equal(await t.page.locator('h1').isVisible(), true);
    assert.ok(await t.page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), 'Images cannot overflow the mobile viewport');
    assert.deepEqual(t.errors, []);
    await t.context.close(); checks++;
  }
  // Keep the self-contained HTML much smaller than the previous PNG payloads.
  for (const file of ['index.html', 'patent/index.html', 'patent/en/index.html']) {
    assert.ok((await readFile(resolve(root, file))).length < 210_000, `${file}: page payload exceeded 210 kB`);
  }
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
      if (file === 'index.html') {
        // Screenshot tooling waits for document.fonts.ready even when swap
        // already paints readable fallback text. Keep main JS held for proof.
        t.releaseFont();
        await visualProof(t.page, 'article-delayed-scripts');
      }
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
    assert.equal(await t.page.locator('[data-i18n="pages.pricing.title"]').innerText(), 'Pricing');
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
      const background = await t.page.locator('.btn-primary').first().evaluate(e => {
        const s = getComputedStyle(e); return { color: s.backgroundColor, image: s.backgroundImage };
      });
      assert.ok(background.color !== 'rgba(0, 0, 0, 0)' || background.image !== 'none',
        'The primary action must retain its styled color or gradient when external CSS fails');
      assert.equal(await t.page.evaluate(() => getComputedStyle(document.body).margin), '0px');
      if (path.includes('/en/')) {
        assert.equal(await t.page.locator('a[href="/patent/en/wizard.html"]').count(), 1);
        assert.equal(await t.page.locator('.topbar a[href="/patent/en/account/"]').count(), 0);
      }
      assert.deepEqual(t.errors, []);
      if (path === '/patent/' && !javaScriptEnabled) {
        t.releaseFont();
        await visualProof(t.page, 'patent-without-js');
      }
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
      let badgeTimeout;
      try {
        await Promise.race([requested, new Promise((_, reject) => {
          badgeTimeout = setTimeout(() => reject(new Error('The lazy trust frame did not request its vendor script')), 10_000);
        })]);
      } finally { clearTimeout(badgeTimeout); }
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
