import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const output = path.join(here, 'dist');
export const ORIGIN = 'https://researchvault-patent.pages.dev';
const assets = [
  'patent/assets/patent.css', 'patent/assets/patent.js',
  'patent/assets/account.js', 'patent/assets/dashboard-en.js',
  'patent/assets/intake-en.js', 'patent/assets/signature.js',
  'assets/patent-hero-robot.png',
  'patent/contracts/nda-en.html', 'patent/contracts/pct-en.html',
];

async function write(relative, content) {
  const target = path.join(output, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function copyEnglishPages(directory = 'patent/en') {
  for (const entry of await readdir(path.join(repository, directory), { withFileTypes: true })) {
    const source = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      await copyEnglishPages(source);
      continue;
    }
    if (!source.endsWith('.html')) throw new Error('Unexpected English source: ' + source);
    let html = await readFile(path.join(repository, source), 'utf8');
    if (!/<html\b[^>]*lang="en"/i.test(html)) throw new Error('Non-English page: ' + source);
    const isHome = source === 'patent/en/index.html';
    const target = isHome ? 'index.html' : source;
    const pagePath = isHome ? '/' : '/' + source.replace(/index\.html$/, '');
    if (isHome) {
      // The home page moves to /. Resolve its original relative asset/link URLs
      // against its old directory; the remaining portal routes retain their paths.
      html = html.replace(/\b(href|src)="([^"]+)"/g, (all, attr, value) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) return all;
        const resolved = new URL(value.replaceAll('&amp;', '&'), ORIGIN + '/patent/en/');
        return `${attr}="${(resolved.pathname + resolved.search + resolved.hash).replaceAll('&', '&amp;')}"`;
      });
    }
    const privatePage = /\/en\/(?:account|intake|dashboard|contract)\//.test(source);
    const metadata = privatePage
      ? (html.includes('name="robots"') ? '' : '<meta name="robots" content="noindex,nofollow">')
      : `<link rel="canonical" href="${ORIGIN}${pagePath}">`;
    html = html.replace('</head>', metadata + '</head>');
    const runtime = /<script src="[^"]*\/patent\.js"><\/script>/;
    if (!runtime.test(html)) throw new Error('Missing Patent runtime: ' + source);
    html = html.replace(runtime, '<script src="/patent/assets/english-host.js"></script>$&');
    await write(target, html);
  }
}

export async function build() {
  // Clean only this isolated generated directory. Never touch source files.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const asset of assets) {
    const target = path.join(output, asset);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repository, asset), target);
  }
  await cp(path.join(here, 'english-host.js'), path.join(output, 'patent/assets/english-host.js'));
  await copyEnglishPages();
  await write('_redirects', '/patent/en / 302\n/patent/en/ / 302\n/patent/en/index.html / 302\n');
  await write('_headers', '/*\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n');
  await write('_routes.json', JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2) + '\n');
  await write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /patent/en/account/\nDisallow: /patent/en/intake/\nDisallow: /patent/en/dashboard/\nDisallow: /patent/en/contract/\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/patent/en/privacy.html</loc></url></urlset>\n`);
  await write('404.html', '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — ResearchVault Patent</title><link rel="stylesheet" href="/patent/assets/patent.css"></head><body class="en-page"><main class="section"><div class="wrap card"><h1>Page not found</h1><p><a href="/">Return to ResearchVault Patent</a></p></div></main></body></html>\n');
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
  console.log('Built English-only Pages output in deploy/patent-en/dist');
}
