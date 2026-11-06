import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { build, ORIGIN } from '../build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = await build();
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative));
    else result.push(relative);
  }
  return result;
}
const emitted = await files(output);

test('output includes only English pages, required public assets and deployment metadata', async () => {
  for (const file of emitted) {
    assert.match(file, /^(?:index\.html|404\.html|_(?:headers|redirects|routes\.json)|robots\.txt|sitemap\.xml|assets\/(?:patent-hero-robot\.png|rv-support-(?:widget|faq|context)\.js|rv-pct-support\.js)|patent\/(?:en\/|assets\/|contracts\/(?:nda-en|pct-en)\.html))/);
    if (file.endsWith('.html') && !file.startsWith('patent/contracts/')) {
      const html = await readFile(path.join(output, file), 'utf8');
      assert.match(html, /<html lang="en" dir="ltr">/);
    }
  }
  for (const missing of ['index.html', 'patent/en/account/index.html', 'patent/en/dashboard/index.html', 'patent/en/intake/index.html', 'patent/en/contract/index.html']) {
    assert.ok(emitted.includes(missing), missing);
  }
  assert.ok(!emitted.some(file => /(?:patent-api|(?:^|\/)admin\/|nda-fa|pct-fa|engagement-fa|\.env|wrangler|migrations)/.test(file)));
});

test('every static local link and asset resolves after moving the English home page to root', async () => {
  for (const file of emitted.filter(file => file.endsWith('.html'))) {
    const source = await readFile(path.join(output, file), 'utf8');
    const base = ORIGIN + '/' + file.replace(/index\.html$/, '');
    for (const [, value] of source.matchAll(/(?:href|src|poster)="([^"]+)"/g)) {
      if (value.startsWith('#')) continue;
      const url = new URL(value.replaceAll('&amp;', '&'), base);
      assert.doesNotMatch(url.hostname, /(?:^|\.)researchvaultagent\.ir$/i, file + ' -> ' + value);
      if (url.origin !== ORIGIN) continue;
      const local = path.join(output, url.pathname);
      const info = await stat(local).catch(() => null);
      assert.ok(info, file + ' -> ' + value);
      if (info.isDirectory()) assert.ok((await stat(path.join(local, 'index.html'))).isFile());
    }
  }
  const home = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.ok(home.includes(`rel="canonical" href="${ORIGIN}/"`));
  assert.ok(home.includes('href="/patent/en/account/?next=/patent/en/intake/"'));
  assert.match(home, /data-pct-client-portal href="\/patent\/en\/account\/\?next=\/patent\/en\/dashboard\/"/);
});

test('copied agreements and shared runtime remain byte-identical to the existing site', async () => {
  for (const file of ['patent/contracts/nda-en.html', 'patent/contracts/pct-en.html', 'patent/assets/patent.js', 'assets/patent-hero-robot.png']) {
    assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(root, file)), file);
  }
  for (const file of emitted.filter(file => /^patent\/en\/.*\.html$/.test(file))) {
    const html = await readFile(path.join(output, file), 'utf8');
    if (file === 'patent/en/filing-guide/index.html') continue;
    if (/\/(?:workflow|case-admin)\//.test(file)) {
      assert.match(html, /noindex,nofollow/);
      assert.match(html, /\/patent\/assets\/pct-workflow\//);
      continue;
    }
    const config = html.indexOf('src="/patent/assets/english-host.js"');
    assert.ok(config > 0 && config < html.indexOf('/patent.js"'), file);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(output, '_routes.json'), 'utf8')), { version: 1, include: ['/api/*', '/support/*'], exclude: [] });
});

test('the English landing includes the original walkthrough and its English captions', async () => {
  for (const suffix of ['mp4', 'jpg', 'vtt']) {
    const file = 'patent/assets/pct-portal-walkthrough.' + suffix;
    assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(root, file)), file);
  }
  const home = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.match(home, /<video[^>]+controls playsinline muted preload="none"/);
  assert.match(home, /<track kind="captions" src="\/patent\/assets\/pct-portal-walkthrough\.vtt" srclang="en" label="English" default>/);
});

test('portal entry uses login for guests, preserves an older case, and rejects open redirects', async () => {
  const link = { href: '' };
  const window = { location: { origin: ORIGIN } };
  const document = { querySelectorAll: () => [link] };
  vm.runInNewContext(await readFile(path.join(output, 'patent/assets/english-host.js'), 'utf8'), {
    window, document, URL,
  });
  assert.equal(window.PATENT_API_BASE, ORIGIN);
  const routes = window.PatentEnglish;
  routes.applySession(null);
  assert.equal(new URL(link.href, ORIGIN).pathname, routes.account);
  assert.equal(new URL(link.href, ORIGIN).searchParams.get('next'), routes.dashboard);
  routes.applySession({ email: 'demo@example.test' });
  assert.equal(link.href, routes.dashboard);
  assert.equal(routes.safeDestination(routes.dashboard + '?case=demo-case_1'), routes.dashboard + '?case=demo-case_1');
  assert.equal(routes.safeDestination(routes.payments + '?case=demo-case_1'), routes.payments + '?case=demo-case_1');
  for (const url of ['https://researchvaultagent.ir/patent/', '//researchvaultagent.ir/', '/patent/en/../../../patent/admin/',
    routes.dashboard + '?case=demo&redirect=https://researchvaultagent.ir/', routes.dashboard + '?case=../../api']) {
    assert.equal(routes.safeDestination(url), null, url);
  }
  const login = await readFile(path.join(output, 'patent/en/account/index.html'), 'utf8');
  assert.match(login, /Use a one-time code sent to your email/);
  assert.doesNotMatch(login, /contracted SMS provider|Phone-number sign-in|active production sign-in/i);
});

test('a ready private workflow takes the current portal links while an earlier case keeps its route', async () => {
  const portal = { href: '' }, start = { href: '' };
  const copy = { textContent: 'Sign the NDA', dataset: { pctEnabledCopy: 'Receive the signed confidentiality undertaking' } };
  const window = { location: { origin: ORIGIN } };
  const targets = { '[data-pct-client-portal]': [portal], '[data-pct-workflow="start"]': [start], '[data-pct-enabled-copy]': [copy] };
  const document = { querySelectorAll: selector => targets[selector] ?? [] };
  let calls = 0;
  const fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/api/pct/status');
    assert.equal(options.credentials, 'omit');
    return { ok: true, json: async () => ({ enabled: true }) };
  };
  vm.runInNewContext(await readFile(path.join(output, 'patent/assets/english-host.js'), 'utf8'), {
    window, document, URL, AbortSignal, fetch,
  });
  const routes = window.PatentEnglish;
  routes.applySession(null);
  assert.match(portal.href, /\/account\/\?next=/);
  assert.equal(copy.textContent, 'Sign the NDA');
  assert.equal(await routes.workflowEnabled(), true);
  assert.equal(portal.href, '/patent/en/workflow/');
  assert.equal(start.href, '/patent/en/workflow/?new=1');
  assert.equal(copy.textContent, 'Receive the signed confidentiality undertaking');
  assert.equal(calls, 1);
  const earlier = new URL(routes.signIn(routes.dashboard + '?case=legacy-1', true), ORIGIN);
  assert.equal(earlier.searchParams.get('earlier'), '1');
  assert.equal(earlier.searchParams.get('next'), routes.dashboard + '?case=legacy-1');
});

test('English deployment includes the support modules and the agreed standalone Stage 1 fee', async () => {
  for (const file of ['assets/rv-support-widget.js', 'assets/rv-support-faq.js', 'assets/rv-support-context.js', 'assets/rv-pct-support.js']) {
    assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(root, file)));
  }
  const home = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.match(home, /US\$1,111/);
  assert.match(home, /<del[^>]+>US\$4,500–7,000<\/del>/);
  assert.match(home, /US\$3,500–5,500/);
  assert.match(home, /US\$111 per revision package/);
  assert.doesNotMatch(home, /1,500|2,500|Complex Stage 1/);
});

test('billing appears only in the isolated generated portal and leaves its source dashboard unchanged', async () => {
  const source = await readFile(path.join(root, 'patent/en/dashboard/index.html'), 'utf8');
  assert.doesNotMatch(source, /\/payments\//);
  const dashboard = await readFile(path.join(output, 'patent/en/dashboard/index.html'), 'utf8');
  const home = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.match(dashboard, /href="\/patent\/en\/payments\/"/);
  assert.match(home, /href="\/patent\/en\/payments\/"/);
  const page = await readFile(path.join(output, 'patent/en/payments/index.html'), 'utf8');
  assert.match(page, /name="robots" content="noindex,nofollow"/);
  assert.match(page, /TRON · TRC20 only/);
  assert.match(page, /PayPal/);
  assert.doesNotMatch(page, /paypal\.com|pay\.me|wise\.com/);
  assert.deepEqual(await readFile(path.join(output, 'patent/assets/dashboard-en.js')), await readFile(path.join(root, 'patent/assets/dashboard-en.js')));
});

test('international scope and the signing version agree across the published site and contract', async () => {
  const home = await readFile(path.join(output, 'index.html'), 'utf8');
  const agreement = await readFile(path.join(output, 'patent/contracts/pct-en.html'), 'utf8');
  const signing = await readFile(path.join(output, 'patent/en/contract/index.html'), 'utf8');
  const version = agreement.match(/Version:<\/b> (PCT-EN-v\d+)/)?.[1];
  assert.ok(version);
  assert.ok(signing.includes("'" + version + "'"), 'signing evidence must use the displayed agreement version');
  for (const html of [home, agreement]) {
    assert.match(html, /through completion of the international phase/i);
    assert.match(html, /National- or regional-phase entry and prosecution[^<]*outside the base agreement/i);
    assert.doesNotMatch(html, /scheduled international publication date|not required to remain engaged|unless separately engaged/);
  }
  assert.match(agreement, /standalone Stage 1 engagement is completed upon delivery of its agreed report/);
});
