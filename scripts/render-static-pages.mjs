// Keep the initial page readable if scripts, stylesheets or remote badges fail.
// Runtime dictionaries/templates remain the source for the generated HTML.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const articles = ['index.html', 'about.html', 'contact.html', 'pricing.html', 'privacy.html', 'refund.html', 'terms.html', '404.html'];
const revision = '20261021-loading';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// Critical artwork travels in the initial document, so a stalled image request
// cannot leave a broken hero. Encoding keeps the original art and dimensions.
const manifest = JSON.parse(await readFile(resolve(root, 'assets/page-images/manifest.json'), 'utf8'));
const pageImages = new Map();
for (const entry of manifest.images) {
  const source = await readFile(resolve(root, entry.source));
  const bytes = await readFile(resolve(root, entry.file));
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  if (sha256(source) !== entry.source_sha256 || sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
    throw new Error(`Page image manifest is stale: ${entry.file}`);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' ||
      bytes.readUInt32LE(4) + 8 !== bytes.length)
    throw new Error(`Incomplete WebP asset: ${entry.file}`);
  pageImages.set(entry.source, { ...entry, uri: `data:image/webp;base64,${bytes.toString('base64')}` });
}

function inlinePageImages(html) {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const marker = tag.match(/\bdata-rv-page-image="([^"]+)"/i);
    const src = tag.match(/\bsrc="([^"]+)"/i);
    const entry = pageImages.get((marker?.[1] || src?.[1] || '').replace(/^\//, ''));
    if (!entry) return tag;
    let result = tag.replace(/\bsrc="[^"]*"/i, `src="${entry.uri}"`);
    if (!marker) result = result.replace('<img', `<img data-rv-page-image="${entry.source}"`);
    for (const [key, value] of Object.entries({ width: entry.width, height: entry.height, decoding: 'async' }))
      if (!new RegExp(`\\b${key}=`).test(result)) result = result.replace('<img', `<img ${key}="${value}"`);
    return result;
  });
}

function renderer(language = 'fa') {
  const output = { header: '', footer: '', styles: [] };
  const nodes = new Map();
  const element = tag => ({ tag, id: '', className: '', innerHTML: '', textContent: '', dataset: {},
    setAttribute() {}, append() {}, appendChild() {} });
  const outer = e => `<${e.tag}${e.id ? ` id="${e.id}"` : ''}${e.className ? ` class="${e.className}"` : ''}>${e.innerHTML || e.textContent}</${e.tag}>`;
  const document = {
    documentElement: { lang: language, dataset: {} }, body: null,
    getElementById(id) { return nodes.get(id) || null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, createElement: element,
    head: { append() {}, appendChild(e) { if (e.id) nodes.set(e.id, e); if (e.tag === 'style') output.styles.push(outer(e)); } },
  };
  const body = {
    classList: { add() {} },
    insertBefore(e) { output.header += outer(e); },
    appendChild(e) { output.footer += outer(e); },
    insertAdjacentHTML(position, html) { output[position === 'afterbegin' ? 'header' : 'footer'] += html; },
  };
  const context = vm.createContext({ document, window: {}, location: { hostname: 'www.researchvaultagent.ir' },
    localStorage: { getItem() { return null; }, setItem() {} }, FormData,
    fetch: async () => ({ ok: true, json: async () => ({ user: null }) }),
  });
  return { output, context, body, document };
}

const articleRenderer = renderer();
vm.runInContext(await readFile(resolve(root, 'js/main.js'), 'utf8') +
  '\n globalThis.staticSite = { I18N, injectHeader, injectFooter };', articleRenderer.context);
articleRenderer.document.body = articleRenderer.body;
articleRenderer.context.staticSite.injectHeader();
articleRenderer.context.staticSite.injectFooter();
const dictionary = articleRenderer.context.staticSite.I18N;

const patentScript = await readFile(resolve(root, 'patent/assets/patent.js'), 'utf8');
const patentShell = {};
for (const language of ['fa', 'en']) {
  const r = renderer(language);
  r.document.body = r.body;
  vm.runInContext(patentScript, r.context);
  if (language === 'en') {
    r.output.header = r.output.header.replace('>PCT Services</a>', '>Patent Services</a><a href="/patent/en/wizard.html">PCT Guide</a>')
      .replaceAll('/patent/en/account/', '/patent/account/').replaceAll('/patent/en/intake/', '/patent/intake/')
      .replaceAll('/patent/en/dashboard/', '/patent/dashboard/');
    r.output.footer = '<footer class="footer no-print"><div class="wrap">ResearchVault Patent · Patent cases are managed confidentially and independently of the research-paper service.</div></footer>';
  }
  patentShell[language] = r.output;
}

async function htmlFiles(directory) {
  const output = [];
  for (const e of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${e.name}`;
    if (e.isDirectory()) output.push(...await htmlFiles(path));
    else if (e.name.endsWith('.html')) output.push(path);
  }
  return output;
}

function block(name, content) { return `<!-- rv-static-${name}:start -->\n${content}\n<!-- rv-static-${name}:end -->`; }
function withBlock(html, name, content, insert) {
  const pattern = new RegExp(`<!-- rv-static-${name}:start -->[\\s\\S]*?<!-- rv-static-${name}:end -->`);
  const next = block(name, content);
  return pattern.test(html) ? html.replace(pattern, () => next) : insert(html, next);
}
const outdated = [];
let pages = 0;
for (const file of [...articles, ...await htmlFiles('patent')]) {
  const filename = resolve(root, file);
  const original = await readFile(filename, 'utf8');
  // Agreement templates are fragments consumed by the contract UI. Do not
  // alter their text, version, hash, or DOM by adding page-level markup.
  if (!/<body\b/i.test(original)) continue;
  pages++;
  let html = original;
  const article = articles.includes(file);
  const language = /<html\b[^>]*\blang=["']en/.test(html) ? 'en' : 'fa';
  const shell = article ? articleRenderer.output : patentShell[language];
  html = withBlock(html, 'header', shell.header, (page, markup) => page.replace(/(<body\b[^>]*>)/i, `$1\n${markup}\n`));
  // Place the footer before the existing scripts, preserving their order.
  html = withBlock(html, 'footer', shell.footer, (page, markup) => {
    const bodyStart = page.indexOf('<body');
    const scripts = /<script\b/i.exec(page.slice(bodyStart));
    const position = scripts ? bodyStart + scripts.index : page.search(/<\/body>/i);
    return page.slice(0, position) + markup + '\n' + page.slice(position);
  });
  if (shell.styles.length) html = withBlock(html, 'trust-styles', shell.styles.join('\n'),
    (page, markup) => page.replace(/<\/head>/i, `${markup}\n</head>`));
  if (article) {
    html = html.replace(/<([a-z][a-z0-9]*)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi, (_all, tag, attrs, key, previous) => {
      if (previous.includes('<')) throw new Error(`Expected a text-only translation: ${file}: ${key}`);
      if (!dictionary[key]?.fa) throw new Error(`Missing Persian translation: ${file}: ${key}`);
      return `<${tag}${attrs}>${escape(dictionary[key].fa)}</${tag}>`;
    });
  }
  // Eliminate third-party font connections. A delayed local font falls back
  // immediately because the bundled @font-face uses font-display: swap.
  html = html.replace(/[ \t]*<link\b[^>]*\bhref=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/gi, '');
  // TrustCode uses document.write, so async would silently break the badge.
  // Keep the official code in a lazy frame whose parser cannot stall this page.
  html = html.replace(/<script\b[^>]*\bsrc=["']https:\/\/www\.zarinpal\.com\/webservice\/TrustCode["'][^>]*>\s*<\/script>/gi,
    '<iframe class="rv-trust-frame" title="نماد درگاه زرین‌پال" src="/assets/zarinpal-trust.html" loading="lazy" style="display:block;border:0;width:160px;height:160px;margin:16px auto;background:transparent"></iframe>');
  const localCSS = /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>|<style\b[^>]*\bdata-rv-page-css=["']([^"']+)["'][^>]*>[\s\S]*?<\/style>/gi;
  const matches = [...html.matchAll(localCSS)];
  for (const m of matches.reverse()) {
    const href = m[1] || m[2];
    if (/^https?:/.test(href)) continue;
    const cssFile = href.startsWith('/') ? resolve(root, href.slice(1)) : resolve(dirname(filename), href);
    if (!cssFile.startsWith(root)) throw new Error('Stylesheet must be inside the site');
    const css = await readFile(cssFile, 'utf8');
    if (/<\/style/i.test(css)) throw new Error(`Unexpected style terminator in ${relative(root, cssFile)}`);
    html = html.slice(0, m.index) + `<style data-rv-page-css="${href}">\n${css.trimEnd()}\n</style>` + html.slice(m.index + m[0].length);
  }
  html = html.replace(/(<script\b[^>]*\bsrc=")([^"]+)("[^>]*>)/gi, (all, before, src, after) => {
    if (!/(?:^|\/)(?:main|patent|iran-en)\.js(?:\?|$)/.test(src)) return all;
    const tail = after.includes('data-cfasync=') ? after : after.replace('>', ' data-cfasync="false">');
    return `${before}${src.split('?')[0]}?v=${revision}${tail}`;
  });
  html = inlinePageImages(html);
  if (html !== original) {
    outdated.push(file);
    if (!check) await writeFile(filename, html);
  }
}
if (check && outdated.length) {
  console.error('Regenerate the initial HTML with node scripts/render-static-pages.mjs:\n' + outdated.join('\n'));
  process.exitCode = 1;
} else console.log(`${check ? 'Verified' : 'Rendered'} static content and inline page CSS for ${pages} pages.`);
