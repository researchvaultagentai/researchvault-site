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
    assert.match(file, /^(?:index\.html|404\.html|_(?:headers|redirects|routes\.json)|robots\.txt|sitemap\.xml|assets\/patent-hero-robot\.png|patent\/(?:en\/|assets\/|contracts\/(?:nda-en|pct-en)\.html))/);
    if (file.endsWith('.html') && !file.startsWith('patent/contracts/')) {
      const html = await readFile(path.join(output, file), 'utf8');
      assert.match(html, /<html lang="en" dir="ltr">/);
    }
  }
  for (const missing of ['index.html', 'patent/en/account/index.html', 'patent/en/dashboard/index.html', 'patent/en/intake/index.html', 'patent/en/contract/index.html']) {
    assert.ok(emitted.includes(missing), missing);
  }
  assert.ok(!emitted.some(file => /(?:patent-api|admin\/|nda-fa|pct-fa|engagement-fa|\.env|wrangler|migrations)/.test(file)));
});

test('every static local link and asset resolves after moving the English home page to root', async () => {
  for (const file of emitted.filter(file => file.endsWith('.html'))) {
    const source = await readFile(path.join(output, file), 'utf8');
    const base = ORIGIN + '/' + file.replace(/index\.html$/, '');
    for (const [, value] of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (value.startsWith('#')) continue;
      const url = new URL(value.replaceAll('&amp;', '&'), base);
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
});

test('copied agreements and shared runtime remain byte-identical to the existing site', async () => {
  for (const file of ['patent/contracts/nda-en.html', 'patent/contracts/pct-en.html', 'patent/assets/patent.js', 'assets/patent-hero-robot.png']) {
    assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(root, file)), file);
  }
  for (const file of emitted.filter(file => /^patent\/en\/.*\.html$/.test(file))) {
    const html = await readFile(path.join(output, file), 'utf8');
    const config = html.indexOf('src="/patent/assets/english-host.js"');
    assert.ok(config > 0 && config < html.indexOf('/patent.js"'), file);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(output, '_routes.json'), 'utf8')), { version: 1, include: ['/api/*'], exclude: [] });
});

test('English header keeps service links on the new host and Persian/admin links on .ir', async () => {
  const values = [
    ['/patent/en/', true], ['/patent/en/', false], ['/patent/en/account/', false],
    ['/patent/', false], ['/patent/admin/', false], ['/', false],
  ];
  const links = values.map(([href, brand]) => ({
    href, getAttribute: () => href, classList: { contains: value => brand && value === 'brand' },
  }));
  let listener, queued;
  const window = { location: { origin: ORIGIN } };
  const document = {
    addEventListener: (event, callback) => { assert.equal(event, 'DOMContentLoaded'); listener = callback; },
    querySelectorAll: () => links,
  };
  vm.runInNewContext(await readFile(path.join(output, 'patent/assets/english-host.js'), 'utf8'), {
    window, document, queueMicrotask: callback => { queued = callback; },
  });
  assert.equal(window.PATENT_API_BASE, ORIGIN);
  listener();
  queued();
  assert.deepEqual(links.map(link => link.href), [
    '/', '/', '/patent/en/account/', 'https://researchvaultagent.ir/patent/',
    'https://researchvaultagent.ir/patent/admin/', 'https://researchvaultagent.ir/',
  ]);
});
