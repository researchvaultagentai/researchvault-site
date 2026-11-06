import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { checkedLegalBytes, legalVersion, putObject } from '../src/files.js';
import { providerImage, verifyAgreementTemplate } from '../src/agreement.js';
import { sha256Hex } from '../../patent-api/src/security.js';
import { authorizeB2, downloadB2, uploadB2 } from '../../patent-api/src/b2.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const workerDir = fileURLToPath(new URL('../', import.meta.url));
const wrangler = path.join(workerDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const account = '36c3a32f4feac9d764c4f82b66c3a9d5';
const service = 'researchvault-pct-workflow';
const database = 'researchvault-pct-workflow-db';
const databaseId = '72378bc6-cd1b-46a9-955f-62cc30ec9346';
const prefix = 'pct-workflow/';
const origin = 'https://researchvault-patent.pages.dev';
const botUsername = 'researchvaultagentbot';
const sample = /(?:^|[.\s_-])(?:test|sample|demo|fixture)(?:$|[.\s_-])/i;
const documents = [
  ['undertaking', 'RV-CONF-EN-v1', 'undertaking-rv-conf-en-v1.pdf'],
  ['agreement', 'PCT-INT-v3', 'agreement-pct-int-v3.docx'],
];
const json = (dir, name) => readFile(path.join(dir, name), 'utf8').then(JSON.parse);
const save = (dir, name, value) => writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

function check(condition, message) { if (!condition) throw new Error(message); }

async function outsideRepository(directory, existing) {
  const resolved = path.resolve(directory);
  const dir = existing ? await realpath(resolved) : path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
  const relative = path.relative(await realpath(repository), dir);
  check(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Use a private release folder outside the Git repository.');
  return dir;
}

function config(vars) {
  return {
    account_id: account, name: service, main: path.join(workerDir, 'src', 'index.js'),
    compatibility_date: '2026-10-18', workers_dev: false, preview_urls: false, routes: [],
    vars: { ...vars, ENVIRONMENT: 'production', PCT_ORIGIN: origin, PCT_ENABLED: 'false' },
    services: [{ binding: 'PATENT_API', service: 'researchvault-patent-api' }],
    d1_databases: [{ binding: 'PCT_DB', database_name: database, database_id: databaseId, migrations_dir: path.join(workerDir, 'migrations') }],
  };
}

function encryptedEnv(dir, vars, secrets) {
  check(Object.keys(secrets).length === 1 && /^[a-f0-9]{64}$/.test(secrets.PCT_FILE_KEY || ''), 'Invalid release key.');
  check(Object.keys(vars).length === documents.length * 3, 'Unexpected legal document settings.');
  for (const [kind, version, filename] of documents) {
    const doc = legalVersion(vars, kind);
    check(doc.version === version && doc.key === 'pct-workflow/legal/' + filename, 'Unexpected private document version.');
  }
  return { ...vars, ...secrets, PCT_STORE: {
    async get(key) {
      const file = await readFile(path.join(dir, path.posix.basename(key) + '.encrypted'));
      return { arrayBuffer: async () => new Uint8Array(file).buffer };
    },
  } };
}

async function verifyFiles(dir, vars, secrets) {
  const env = encryptedEnv(dir, vars, secrets);
  const pdf = await PDFDocument.load(await checkedLegalBytes(env, legalVersion(env, 'undertaking')));
  check(pdf.getPageCount() > 0 && !sample.test(pdf.getTitle() || ''), 'Use the approved undertaking PDF, not a sample.');
  const agreement = legalVersion(env, 'agreement');
  await verifyAgreementTemplate(env, agreement);
  await providerImage(env, { state: { quote: { agreement } } });
}

export async function prepareRelease(nda, agreement, directory) {
  check(!sample.test(path.basename(nda)) && !sample.test(path.basename(agreement)), 'Use the approved production documents.');
  const dir = await outsideRepository(directory, false);
  const payloads = await Promise.all([readFile(nda), readFile(agreement)]);
  check(payloads.every(b => b.length > 0 && b.length <= 5 * 1024 * 1024), 'Unexpected legal file size.');
  const pdf = await PDFDocument.load(payloads[0]);
  check(pdf.getPageCount() > 0 && !sample.test(pdf.getTitle() || ''), 'Use the approved undertaking PDF, not a sample.');
  const secrets = { PCT_FILE_KEY: randomBytes(32).toString('hex') }, vars = {};
  const sealed = new Map();
  for (const [i, [kind, version, filename]] of documents.entries()) {
    const key = 'pct-workflow/legal/' + filename;
    const prefix = 'PCT_' + kind.toUpperCase();
    vars[prefix + '_KEY'] = key;
    vars[prefix + '_VERSION'] = version;
    vars[prefix + '_SHA256'] = await sha256Hex(payloads[i]);
    await putObject({ ...secrets, PCT_STORE: { put: async (_key, bytes) => sealed.set(filename, bytes) } }, key, payloads[i]);
  }
  // Validate the live rendering template before creating a release folder.
  const source = { ...vars, ...secrets, PCT_STORE: { get: async key => ({
    arrayBuffer: async () => sealed.get(path.posix.basename(key)).buffer,
  }) } };
  const doc = legalVersion(source, 'agreement');
  await verifyAgreementTemplate(source, doc);
  await providerImage(source, { state: { quote: { agreement: doc } } });
  await mkdir(dir, { mode: 0o700 });
  for (const [filename, bytes] of sealed) await writeFile(path.join(dir, filename + '.encrypted'), bytes, { mode: 0o600, flag: 'wx' });
  await save(dir, 'wrangler.json', config(vars));
  await save(dir, 'vars.json', vars);
  await save(dir, 'worker-secrets.json', secrets);
  await verifyFiles(dir, vars, secrets);
  console.log('Prepared and verified two encrypted legal documents. The Worker is configured OFF.');
  return dir;
}

function command(args, conf, input = '') {
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0', CI: 'true' };
  delete env.B2_KEY_ID;
  delete env.B2_APPLICATION_KEY;
  delete env.PCT_TELEGRAM_NOTIFY_TOKEN;
  return spawnSync(process.execPath, [wrangler, ...args, '--config', conf], {
    cwd: workerDir, encoding: 'utf8', windowsHide: true, timeout: 120000, input, env,
  });
}

function backblazeOrigin(address) {
  const url = new URL(address);
  check(url.protocol === 'https:' && url.hostname.endsWith('.backblazeb2.com') && url.origin === url.href.replace(/\/$/, ''), 'Unexpected Backblaze endpoint.');
  return url.origin;
}

async function backblazeAccess({ credentials, authorize, fetcher }) {
  check(credentials.B2_KEY_ID && credentials.B2_APPLICATION_KEY, 'Provide the scoped Backblaze key locally in B2_KEY_ID and B2_APPLICATION_KEY.');
  let access;
  try { access = await authorize(credentials); }
  catch { throw new Error('Backblaze authorization failed. Check the two values locally.'); }
  const allowed = access.storage?.allowed;
  const [bucket] = allowed?.buckets ?? [];
  check(allowed?.buckets?.length === 1 && bucket?.id && bucket?.name && allowed.namePrefix === prefix &&
    ['readFiles', 'writeFiles'].every(cap => allowed.capabilities?.includes(cap)), 'Use a Read and Write key restricted to one private bucket and file prefix pct-workflow/.');
  const api = backblazeOrigin(access.storage.apiUrl);
  const download = backblazeOrigin(access.storage.downloadUrl);
  if (allowed.capabilities.includes('listBuckets')) {
    const response = await fetcher(`${api}/b2api/v4/b2_list_buckets`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { authorization: access.authorizationToken, 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: access.accountId, bucketId: bucket.id }),
    });
    check(response.ok, 'Could not read the Backblaze bucket privacy setting.');
    const { buckets } = await response.json();
    check(buckets?.length === 1 && buckets[0].bucketId === bucket.id && buckets[0].bucketType === 'allPrivate', 'Use the existing private Backblaze bucket.');
  }
  return { env: { ...credentials, B2_BUCKET_ID: bucket.id, B2_BUCKET_NAME: bucket.name }, download };
}

export async function installRelease(directory, { run = command, authorize = authorizeB2, upload = uploadB2,
  download = downloadB2, fetcher = fetch, credentials = { B2_KEY_ID: process.env.B2_KEY_ID, B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY } } = {}) {
  const dir = await outsideRepository(directory, true);
  const conf = path.join(dir, 'wrangler.json');
  const [vars, secrets, saved] = await Promise.all(['vars.json', 'worker-secrets.json', 'wrangler.json'].map(name => json(dir, name)));
  check(JSON.stringify(saved) === JSON.stringify(config(vars)), 'The prepared Worker configuration changed.');
  await verifyFiles(dir, vars, secrets);
  function get(args, label, input) {
    const result = run(args, conf, input);
    check(result.status === 0, `${label} failed. Check the selected Cloudflare account, Wrangler login and resource settings.`);
    return result.stdout;
  }
  const storage = await backblazeAccess({ credentials, authorize, fetcher });
  const d1 = JSON.parse(get(['d1', 'info', 'PCT_DB', '--json'], 'Read the dedicated D1 database'));
  check(d1.uuid === databaseId && d1.name === database, 'The Cloudflare D1 database is not the dedicated PCT database.');
  const prior = run(['deployments', 'list', '--name', service, '--json'], conf);
  check(prior.status !== 0 && /\bcode:\s*10007\b/i.test(`${prior.stderr}\n${prior.stdout}`), 'Could not verify that the new Worker name is unused. Do not overwrite an existing Worker.');
  await save(dir, 'install-started.json', { worker: service, database, storage: 'backblaze', at: new Date().toISOString() });
  for (const [, , filename] of documents) {
    const key = prefix + 'legal/' + filename;
    const bytes = await readFile(path.join(dir, filename + '.encrypted'));
    let existing, uploaded;
    try {
      existing = await download(storage.env, key);
      if (!existing) {
        await upload(storage.env, key, bytes);
        uploaded = await download(storage.env, key);
      }
    } catch { throw new Error('Could not write and read the encrypted document on Backblaze.'); }
    check(!existing, 'A legal object already exists at this version. Keep the original key and review before replacing it.');
    check(uploaded && bytes.equals(Buffer.from(uploaded)), 'Backblaze did not return the exact encrypted object.');
    // A prefix key need not list any bucket names. Verify the encrypted object
    // actually requires authorization before configuring the live service.
    const publicUrl = `${storage.download}/file/${encodeURIComponent(storage.env.B2_BUCKET_NAME)}/${key}`;
    const probe = await fetcher(publicUrl, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(12000) });
    check([401, 403].includes(probe.status), 'The Backblaze file did not require private access. Check the bucket type.');
  }
  get(['d1', 'migrations', 'apply', 'PCT_DB', '--remote'], 'Initialize the dedicated PCT database');
  get(['deploy'], 'Deploy the disabled private PCT Worker');
  get(['secret', 'bulk'], 'Set the private encryption and Backblaze keys', JSON.stringify({ ...secrets, ...storage.env }));
  await save(dir, 'install-complete.json', { worker: service, enabled: false, at: new Date().toISOString() });
  console.log('Installed the private PCT Worker with enrollment disabled. No customer routes were switched.');
}

function activeWorkerSecrets(run, conf, expected) {
  const read = (args, label) => {
    const result = run(args, conf);
    check(result.status === 0, `${label} failed. Check the existing Cloudflare login.`);
    try { return JSON.parse(result.stdout); }
    catch { throw new Error(`${label} did not return valid configuration. No Worker changes were made.`); }
  };
  const deployment = read(['deployments','status','--name',service,'--json'], 'Read the active PCT deployment');
  const versions = deployment?.versions;
  const versionId = versions?.[0]?.version_id;
  check(Array.isArray(versions) && versions.length === 1 && versions[0].percentage === 100 &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(versionId || ''),
  'The PCT Worker must have one active version receiving all traffic before setup.');
  const version = read(['versions','view',versionId,'--name',service,'--json'], 'Read the active PCT configuration');
  const bindings = version?.resources?.bindings;
  check(version?.id === versionId && Array.isArray(bindings), 'Could not verify the active private Worker configuration.');
  const get = (name, type) => {
    const matched = bindings.filter(item => item?.name === name);
    return matched.length === 1 && matched[0].type === type ? matched[0] : null;
  };
  check(get('PCT_ENABLED','plain_text')?.text === 'false', 'Enrollment is not confirmed closed on the active PCT Worker. No changes were made.');
  check(Object.entries(expected.vars).every(([name,text]) => get(name,'plain_text')?.text === text) &&
    get('PCT_DB','d1')?.id === databaseId && get('PATENT_API','service')?.service === expected.services[0].service,
  'The active Worker does not match the dedicated PCT release and document settings.');
  check(['PCT_FILE_KEY','B2_KEY_ID','B2_APPLICATION_KEY','B2_BUCKET_ID','B2_BUCKET_NAME'].every(name => get(name,'secret_text')),
    'The active private Worker is missing an encryption or Backblaze secret. Do not replace the original key.');
  return { hasNotificationToken: Boolean(get('PCT_TELEGRAM_NOTIFY_TOKEN','secret_text')) };
}

export async function connectAdmin(directory, { admin, token, run = command, fetcher = fetch } = {}) {
  check(/^\d{1,20}$/.test(admin || ''), 'Enter the Telegram ID of the existing private bot administrator.');
  const dir = await outsideRepository(directory, true);
  const conf = path.join(dir, 'wrangler.json');
  const [vars, secrets, saved, installed] = await Promise.all(
    ['vars.json','worker-secrets.json','wrangler.json','install-complete.json'].map(name => json(dir,name)),
  );
  const expected = config(vars);
  check(JSON.stringify(saved) === JSON.stringify(expected) && installed.worker === service && installed.enabled === false,
    'This is not the completed disabled PCT installation. Use the original private release folder.');
  await verifyFiles(dir, vars, secrets);
  let verifiedToken = false;
  if (token && /^\d{6,15}:[a-zA-Z0-9_-]{20,100}$/.test(token)) {
    const r = await fetcher('https://api.telegram.org/bot'+token+'/getMe',
      { redirect:'error', signal:AbortSignal.timeout(12000) }).catch(()=>null);
    const info = r?.ok ? await r.json().catch(()=>null) : null;
    verifiedToken = info?.ok === true && String(info.result?.username || '').toLowerCase() === botUsername;
  }
  const { hasNotificationToken } = activeWorkerSecrets(run, conf, expected);
  check(run(['deploy','--keep-vars'], conf).status === 0, 'Could not update the private PCT Worker.');
  const updates = { PCT_TELEGRAM_ADMIN_IDS:admin, PCT_NOTIFY_CHAT_ID:admin, ...(verifiedToken ? {PCT_TELEGRAM_NOTIFY_TOKEN:token} : {}) };
  check(run(['secret','bulk'], conf, JSON.stringify(updates)).status === 0, 'Could not set the private Telegram administrator.');
  console.log('Configured the private Telegram administrator. Enrollment remains disabled.');
  if (token && !verifiedToken) console.log('Telegram could not verify the supplied token. The notification token was not changed.');
  if (!verifiedToken && !hasNotificationToken) console.log('The existing ResearchVault bot can deliver scheduled notices using its configured token.');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === 'prepare' && args.length === 3) await prepareRelease(...args);
    else if (mode === 'install' && args.length === 1) await installRelease(...args);
    else if (mode === 'bootstrap' && args.length === 3) await installRelease(await prepareRelease(...args));
    else if (mode === 'connect-admin' && args.length === 1) await connectAdmin(args[0], {
      admin:process.env.PCT_TELEGRAM_ADMIN_ID, token:process.env.PCT_TELEGRAM_NOTIFY_TOKEN,
    });
    else throw new Error('Use prepare or bootstrap with UNDERTAKING.pdf AGREEMENT.docx PRIVATE_DIRECTORY; or install or connect-admin with PRIVATE_DIRECTORY.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
