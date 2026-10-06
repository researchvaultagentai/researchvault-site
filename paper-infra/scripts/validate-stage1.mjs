import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const configs = [
  'wrangler.doi-resolver.jsonc',
  'wrangler.pdf-finder.jsonc',
  'wrangler.source-01.jsonc',
  'wrangler.source-02.jsonc',
  'wrangler.source-03.jsonc',
  'wrangler.source-04.jsonc',
  'wrangler.source-05.jsonc',
  'wrangler.source-06.jsonc',
  'wrangler.source-07.jsonc',
];

const protectedServices = new Set([
  'researchvault-bot',
  'researchvault-marketing',
  'rv-shadow',
  'researchvault-proxy',
]);

const expectedPdfBindings = new Map([
  ['SOURCE_01_OA', 'rv-source-01-oa'],
  ['SOURCE_02_BIOMED', 'rv-source-02-biomed'],
  ['SOURCE_03_PREPRINTS', 'rv-source-03-preprints'],
  ['SOURCE_04_PUBLISHERS_A', 'rv-source-04-publishers-a'],
  ['SOURCE_05_PUBLISHERS_B', 'rv-source-05-publishers-b'],
  ['SOURCE_06_SOCIETY_TECH', 'rv-source-06-society-tech'],
  ['SOURCE_07_LONGTAIL', 'rv-source-07-longtail'],
]);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function readJson(relative) {
  const filename = path.join(root, relative);
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`);
    return null;
  }
}

const parsed = new Map();
for (const relative of configs) {
  const cfg = readJson(relative);
  if (cfg) parsed.set(relative, cfg);
}

const names = new Set();
for (const [relative, cfg] of parsed) {
  if (!cfg.name) fail(`${relative}: missing Worker name`);
  if (names.has(cfg.name)) fail(`${relative}: duplicate Worker name ${cfg.name}`);
  names.add(cfg.name);

  if (protectedServices.has(cfg.name)) fail(`${relative}: attempts to reuse protected production service ${cfg.name}`);
  if (cfg.workers_dev !== false) fail(`${relative}: workers_dev must be false in Stage 1`);
  if (cfg.preview_urls !== false) fail(`${relative}: preview_urls must be false in Stage 1`);
  if ('route' in cfg || 'routes' in cfg) fail(`${relative}: public routes are forbidden in Stage 1`);
  if (cfg.vars?.WORKER_ID !== cfg.name) fail(`${relative}: vars.WORKER_ID must equal Worker name`);
  if (cfg.vars?.SCAFFOLD_VERSION !== 'stage1') fail(`${relative}: SCAFFOLD_VERSION must remain stage1`);
}

const doi = parsed.get('wrangler.doi-resolver.jsonc');
if (doi) {
  if (doi.main !== 'src/doi-resolver.js') fail('DOI resolver main entrypoint changed unexpectedly');
  const services = doi.services || [];
  if (services.length !== 1 || services[0]?.binding !== 'PDF_FINDER' || services[0]?.service !== 'rv-pdf-finder') {
    fail('DOI resolver must bind only PDF_FINDER -> rv-pdf-finder');
  }
}

const pdf = parsed.get('wrangler.pdf-finder.jsonc');
if (pdf) {
  if (pdf.main !== 'src/pdf-finder.js') fail('PDF finder main entrypoint changed unexpectedly');
  const services = new Map((pdf.services || []).map((item) => [item.binding, item.service]));
  if (services.size !== expectedPdfBindings.size) fail('PDF finder must expose exactly seven source bindings');
  for (const [binding, service] of expectedPdfBindings) {
    if (services.get(binding) !== service) fail(`PDF finder binding mismatch: ${binding} -> ${service}`);
  }
}

for (let index = 1; index <= 7; index += 1) {
  const relative = `wrangler.source-${String(index).padStart(2, '0')}.jsonc`;
  const cfg = parsed.get(relative);
  if (!cfg) continue;
  if (cfg.main !== 'src/source-worker.js') fail(`${relative}: unexpected entrypoint`);
  if ((cfg.services || []).length) fail(`${relative}: source workers may not have downstream service bindings in Stage 1`);
  if (!cfg.vars?.SOURCE_GROUP) fail(`${relative}: SOURCE_GROUP is required`);
}

for (const relative of ['contracts/request.schema.json', 'contracts/response.schema.json', 'contracts/telemetry.schema.json']) {
  readJson(relative);
}

for (const relative of ['src/common.js', 'src/doi-resolver.js', 'src/pdf-finder.js', 'src/source-worker.js']) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const match of text.matchAll(/https?:\/\/[^'"`\s)]+/g)) {
    const url = match[0];
    if (!url.startsWith('https://rv.internal/')) fail(`${relative}: unexpected external URL in Stage 1 source: ${url}`);
  }
  for (const service of protectedServices) {
    if (text.includes(service)) fail(`${relative}: protected production service name referenced in executable source: ${service}`);
  }
}

const resolverSource = fs.readFileSync(path.join(root, 'src/doi-resolver.js'), 'utf8');
const finderSource = fs.readFileSync(path.join(root, 'src/pdf-finder.js'), 'utf8');
const sourceWorkerSource = fs.readFileSync(path.join(root, 'src/source-worker.js'), 'utf8');
if (!resolverSource.includes("url.pathname === '/v1/resolve'") || !resolverSource.includes('notImplemented(')) fail('DOI Stage 1 blocker is missing');
if (!finderSource.includes("url.pathname === '/v1/find'") || !finderSource.includes('notImplemented(')) fail('PDF Stage 1 blocker is missing');
if (!sourceWorkerSource.includes("url.pathname === '/v1/probe'") || !sourceWorkerSource.includes('notImplemented(')) fail('Source Stage 1 blocker is missing');

if (!process.exitCode) {
  console.log('PASS: Stage 1 paper infrastructure is internally routed, isolated, and production-disabled.');
}
