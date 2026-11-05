import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox } from 'playwright';
import { build, ORIGIN } from '../build.mjs';

const output = await build();
const engine = process.argv.includes('--firefox') ? firefox : chromium;
const browser = await engine.launch();
const mime = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png',
};

async function open(options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1520, height: 712 },
    reducedMotion: options.reducedMotion ?? 'no-preference',
    javaScriptEnabled: options.javaScriptEnabled ?? true,
    hasTouch: options.hasTouch ?? false,
  });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    requests.push(url.pathname);
    if (options.block?.some(suffix => url.pathname.endsWith(suffix))) return route.abort();
    if (url.pathname === '/api/me') return route.fulfill({ json: { user: null } });
    if (url.pathname === '/support/config') return route.fulfill({ json: { configured: false } });
    const relative = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    const body = await readFile(path.join(output, relative));
    await route.fulfill({ contentType: mime[path.extname(relative)], body });
  });
  await page.clock.install();
  await page.goto(ORIGIN + '/');
  const count = page.locator('[data-pct-count]');
  const image = page.locator('[data-pct-robot]');
  const rotation = page.locator('[data-pct-rotate]');
  const next = page.getByRole('button', { name: 'Next illustration' });
  return { context, page, count, image, rotation, next, requests, errors };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;
const width = (page, value) => page.waitForFunction(n => document.querySelector('[data-pct-robot]').naturalWidth === n, value);
const active = page => page.locator('[data-pct-status][aria-live="off"]').waitFor();
const advance = page => page.clock.fastForward(7100);

try {
  {
    const { context, page, count, rotation, next, errors } = await open();
    await width(page, 1672);
    const launcher = page.getByRole('button', { name: 'Ask ResearchVault' });
    await launcher.waitFor();
    for (const button of [rotation, next, page.getByRole('button', { name: 'Previous illustration' })]) {
      assert.ok(!overlaps(await button.boundingBox(), await launcher.boundingBox()), 'gallery controls must clear the launcher');
    }
    await active(page);
    assert.equal(await count.textContent(), '1 / 2');
    await advance(page);
    assert.equal(await count.textContent(), '2 / 2');
    await advance(page);
    assert.equal(await count.textContent(), '1 / 2');

    await page.locator('[data-pct-media]').hover({ position: { x: 1050, y: 270 } });
    await advance(page);
    assert.equal(await count.textContent(), '1 / 2', 'hover stops rotation');
    await rotation.click();
    assert.equal(await rotation.getAttribute('aria-label'), 'Start slideshow');
    await page.mouse.move(10, 20);
    await advance(page);
    assert.equal(await count.textContent(), '1 / 2', 'explicit pause survives mouse leave');
    await rotation.click();
    await page.keyboard.press('Tab');
    assert.equal(await rotation.getAttribute('aria-label'), 'Start slideshow', 'keyboard focus stops automatic rotation');
    await next.click();
    assert.equal(await count.textContent(), '2 / 2');

    const field = page.locator('.pct-stars-page');
    const before = await field.evaluate(el => [getComputedStyle(el, '::before').transform, getComputedStyle(el, '::after').transform]);
    await page.mouse.move(13, 300);
    await page.mouse.wheel(0, 460);
    await page.waitForFunction(() => window.scrollY > 100);
    await page.clock.runFor(35);
    const after = await field.evaluate(el => [getComputedStyle(el, '::before').transform, getComputedStyle(el, '::after').transform]);
    assert.notEqual(after[0], before[0], 'the far layer moves when the user scrolls');
    assert.notEqual(after[1], before[1], 'the near layer moves when the user scrolls');
    assert.notEqual(after[0], after[1], 'the two layers move at different depths');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { context, page, image, requests, errors } = await open({ block: ['pct-patent-agent.webp'] });
    await width(page, 1672);
    assert.match(await image.getAttribute('src'), /patent-hero-robot\.png$/);
    assert.ok(requests.some(p => p.endsWith('pct-patent-agent.webp')));
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { context, page, image, count, rotation, next, requests, errors } = await open({
      block: ['pct-patent-agent.webp', 'patent-hero-robot.png'], reducedMotion: 'reduce',
      viewport: { width: 320, height: 640 }, hasTouch: true,
    });
    await width(page, 640);
    assert.match(await image.getAttribute('src'), /^data:image\/jpeg;base64,/);
    await rotation.waitFor();
    assert.ok(requests.some(p => p.endsWith('patent-hero-robot.png')));
    assert.equal(await rotation.getAttribute('aria-label'), 'Start slideshow');
    await advance(page);
    assert.equal(await count.textContent(), '1 / 2', 'reduced motion stays on the first slide');
    const start = page.getByRole('link', { name: 'Start a confidential case' }).first();
    const launcher = page.getByRole('button', { name: 'Ask ResearchVault' });
    await launcher.waitFor();
    assert.ok(!overlaps(await start.boundingBox(), await launcher.boundingBox()), 'small-screen CTA must clear the launcher');
    await next.click();
    assert.equal(await count.textContent(), '2 / 2', 'manual controls work with reduced motion');
    await page.evaluate(() => scrollTo(0, 600));
    assert.equal(await page.locator('.pct-stars-page').evaluate(el => getComputedStyle(el, '::after').transform), 'none');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { context, page, image, next } = await open({ javaScriptEnabled: false });
    await width(page, 640);
    assert.match(await image.getAttribute('src'), /^data:image\/jpeg;base64,/);
    assert.ok(await next.isHidden());
    await context.close();
  }
  console.log('Passed PCT landing browser checks in ' + engine.name() + '.');
} finally {
  await browser.close();
}
