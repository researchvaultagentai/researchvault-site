import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox } from 'playwright';
import { build, ORIGIN } from '../build.mjs';

const output = await build();
const engine = process.argv.includes('--firefox') ? firefox : chromium;
// Use the runner's Google Chrome for H.264/AAC playback.
const channel = engine === chromium && process.env.GITHUB_ACTIONS === 'true' ? 'chrome' : undefined;
const browser = await engine.launch({ channel });
const mime = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4', '.vtt': 'text/vtt',
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
  const dialogs = [];
  const guest = null;
  const client = { full_name: 'Sample Client', email: 'sample@example.test' };
  let session = options.signedIn ? client : guest;
  let failVideo = options.failVideoOnce;
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    requests.push(url.pathname);
    if (options.block?.some(suffix => url.pathname.endsWith(suffix))) return route.abort();
    if (failVideo && url.pathname.endsWith('pct-portal-walkthrough.mp4')) {
      failVideo = false;
      return route.abort();
    }
    if (url.pathname === '/api/me') return route.fulfill({ json: { user: session } });
    if (url.pathname === '/api/pct/status') return route.fulfill({ json: { enabled: false } });
    if (url.pathname === '/api/cases') return route.fulfill({ json: { cases: [] } });
    if (url.pathname === '/api/auth/request-otp') {
      assert.deepEqual(route.request().postDataJSON(), { destination: client.email, channel: 'email' });
      return route.fulfill({ json: { challenge_id: 'sample-challenge' } });
    }
    if (url.pathname === '/api/auth/verify-otp') {
      assert.deepEqual(route.request().postDataJSON(), { challenge_id: 'sample-challenge', code: '123456' });
      session = client;
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === '/support/config') return route.fulfill({ json: { configured: false } });
    const relative = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    const body = await readFile(path.join(output, relative));
    await route.fulfill({ contentType: mime[path.extname(relative)], body });
  });
  if (options.blockAutoplay) {
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        HTMLMediaElement.prototype.play = play;
        return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
      };
    });
  }
  await page.clock.install();
  await page.goto(ORIGIN + '/');
  const count = page.locator('[data-pct-count]');
  const image = page.locator('[data-pct-robot]');
  const rotation = page.locator('[data-pct-rotate]');
  const next = page.getByRole('button', { name: 'Next slide' });
  const video = page.locator('[data-pct-video]');
  return { context, page, count, image, rotation, next, video, requests, errors, dialogs };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;
const width = (page, value) => page.waitForFunction(n => document.querySelector('[data-pct-robot]').naturalWidth === n, value);
const active = page => page.locator('[data-pct-status][aria-live="off"]').waitFor();
const advance = page => page.clock.fastForward(20_100);
const videoPlaying = page => page.waitForFunction(() => {
  const video = document.querySelector('[data-pct-video]');
  return !video.paused && video.currentTime > .1;
});
const finishVideo = async (page, video) => {
  await video.evaluate(el => { el.currentTime = el.duration - .2; });
  await page.locator('[data-pct-count]').filter({ hasText: '1 / 2' }).waitFor();
};

try {
  {
    const { context, page, count, rotation, next, video, requests, errors } = await open();
    await width(page, 1672);
    const launcher = page.getByRole('button', { name: 'Ask ResearchVault' });
    await launcher.waitFor();
    for (const button of [rotation, next, page.getByRole('button', { name: 'Previous slide' })]) {
      assert.ok(!overlaps(await button.boundingBox(), await launcher.boundingBox()), 'gallery controls must clear the launcher');
    }
    await active(page);
    const field = page.locator('.pct-stars-page');
    const drift = () => field.evaluate(el => getComputedStyle(el, '::after').animationPlayState);
    assert.equal(await count.textContent(), '1 / 2');
    assert.equal(await drift(), 'running', 'lights drift without scroll');
    await page.clock.fastForward(19_000);
    assert.equal(await count.textContent(), '1 / 2', 'the first slide remains visible before 20 seconds');
    assert.ok(!requests.some(p => p.endsWith('.mp4')), 'the video does not load while the robot is displayed');
    await page.clock.fastForward(1100);
    assert.equal(await count.textContent(), '2 / 2');
    await videoPlaying(page);
    assert.deepEqual(await video.evaluate(el => [el.muted, el.playsInline, el.duration, el.videoWidth, el.videoHeight]),
      [true, true, 45, 1080, 1920]);
    await page.waitForFunction(() => [...document.querySelector('[data-pct-video]').textTracks]
      .some(track => track.mode === 'showing' && track.cues?.length === 8));
    const bounds = await video.boundingBox();
    assert.ok(Math.abs(bounds.width / bounds.height - 9 / 16) < .002);
    assert.ok(!overlaps(bounds, await rotation.boundingBox()), 'the video clears the carousel controls');
    await page.clock.fastForward(60_000);
    assert.equal(await count.textContent(), '2 / 2', 'the video has no slide timer');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.ok(await video.evaluate(el => el.paused), 'hiding the tab pauses the walkthrough');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await videoPlaying(page);
    await finishVideo(page, video);
    await page.clock.fastForward(19_000);
    assert.equal(await count.textContent(), '1 / 2', 'the robot has a fresh 20-second timer after the video');
    await page.clock.fastForward(1100);
    await videoPlaying(page);
    await finishVideo(page, video);

    await page.locator('[data-pct-media]').hover({ position: { x: 1050, y: 270 } });
    await advance(page);
    assert.equal(await count.textContent(), '1 / 2', 'hover stops rotation');
    await rotation.click();
    assert.equal(await rotation.getAttribute('aria-label'), 'Start slideshow');
    assert.equal(await drift(), 'paused', 'the pause control also stops ambient drift');
    await page.mouse.move(10, 20);
    await advance(page);
    assert.equal(await count.textContent(), '1 / 2', 'explicit pause survives mouse leave');
    await rotation.click();
    await page.keyboard.press('Tab');
    assert.equal(await rotation.getAttribute('aria-label'), 'Start slideshow', 'keyboard focus stops automatic rotation');
    await next.click();
    assert.equal(await count.textContent(), '2 / 2');

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
    const { context, page, count, video, rotation, errors } = await open({ blockAutoplay: true, failVideoOnce: true });
    await active(page);
    await advance(page);
    assert.equal(await count.textContent(), '2 / 2');
    assert.deepEqual(await video.evaluate(el => [el.paused, el.controls]), [true, true]);
    await video.evaluate(el => { void el.play().catch(() => {}); });
    const retry = page.getByRole('button', { name: 'Try again' });
    await retry.waitFor();
    await retry.click();
    await videoPlaying(page);
    await rotation.click();
    assert.ok(await video.evaluate(el => el.paused), 'pausing the slideshow also pauses the video');
    await advance(page);
    assert.equal(await count.textContent(), '2 / 2');
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
    const { context, page, image, count, rotation, next, video, requests, errors } = await open({
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
    const bounds = await video.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
    assert.ok(Math.abs(bounds.width / bounds.height - 9 / 16) < .002);
    assert.ok(await video.evaluate(el => el.paused), 'manual selection does not autoplay with reduced motion');
    await video.evaluate(async el => {
      await el.play();
      el.muted = false;
    });
    await videoPlaying(page);
    assert.equal(await video.evaluate(el => el.muted), false);
    await page.getByRole('button', { name: 'Previous slide' }).click();
    assert.ok(await video.evaluate(el => el.paused), 'leaving the walkthrough stops its audio');
    await page.evaluate(() => scrollTo(0, 600));
    assert.deepEqual(await page.locator('.pct-stars-page').evaluate(el => {
      const style = getComputedStyle(el, '::after');
      return [style.transform, style.animationName];
    }), ['none', 'none']);
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
  {
    const { context, page, errors, dialogs } = await open();
    const noIranLinks = () => page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .filter(a => /(?:^|\.)researchvaultagent\.ir$/i.test(new URL(a.href).hostname)).map(a => a.href));
    assert.deepEqual(await noIranLinks(), []);
    await page.locator('.pct-header [data-pct-client-portal]').click();
    await page.waitForURL(/\/patent\/en\/account\/\?next=/);
    await page.getByRole('heading', { name: 'Sign in / create an account' }).waitFor();
    assert.deepEqual(await noIranLinks(), []);
    assert.equal(await page.getByText(/contracted SMS provider|Phone-number sign-in/).count(), 0);
    await page.getByLabel('Email', { exact: true }).fill('sample@example.test');
    await page.getByRole('button', { name: 'Send verification code' }).click();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await page.waitForURL(ORIGIN + '/patent/en/dashboard/');
    await page.getByRole('heading', { name: 'My cases' }).waitFor();
    assert.deepEqual(await noIranLinks(), []);
    assert.deepEqual(dialogs, []);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { context, page, errors, requests } = await open({ signedIn: true });
    await page.waitForFunction(() => document.querySelector('.pct-header [data-pct-client-portal]').pathname === '/patent/en/dashboard/');
    await page.locator('.pct-header [data-pct-client-portal]').click();
    await page.waitForURL(ORIGIN + '/patent/en/dashboard/');
    assert.ok(!requests.includes('/patent/en/account/'), 'an active session skips the login page');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Passed PCT landing browser checks in ' + engine.name() + '.');
} finally {
  await browser.close();
}
