import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { strToU8, zipSync } from 'fflate';
import { connectAdmin, installRelease, prepareRelease } from '../scripts/release.mjs';

async function localRelease(t) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'rv-pct-release-test-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const pdf = await PDFDocument.create();
  pdf.setTitle('Confidentiality Undertaking');
  pdf.addPage().drawText('Synthetic test data. No signature or legal commitment.');
  const fields = 'CASE_REF QUOTE_ID ISSUE_DATE PCT_TOTAL PCT_START PCT_READY PCT_COMPLETION CLIENT_NAME CLIENT_ROLE CLIENT_ADDRESS CLIENT_EMAIL CLIENT_REGISTRATION CLIENT_SIGNATURE CLIENT_DATE'.split(' ');
  const xml = `<w:document><w:body>${fields.map(x => `<w:p><w:r><w:t>{{${x}}}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  const docx = zipSync({ 'word/document.xml': strToU8(xml), 'word/media/image1.png': Uint8Array.of(137,80,78,71,13,10,26,10) });
  const nda = path.join(tmp, 'undertaking.pdf'), agreement = path.join(tmp, 'agreement.docx');
  await Promise.all([writeFile(nda, await pdf.save()), writeFile(agreement, docx)]);
  const dir = await prepareRelease(nda, agreement, path.join(tmp, 'release'));
  return { tmp, dir, nda, agreement };
}

const ok = value => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value ?? {}), stderr: '' });
const missingWorker = { status: 1, stderr: 'Worker does not exist [code: 10007]', stdout: '' };
const credentials = { B2_KEY_ID: 'SCOPED_KEY_ID', B2_APPLICATION_KEY: 'SCOPED_KEY_SECRET' };
const auth = () => ({ accountId: 'test-account', authorizationToken: 'test-token', storage: {
  apiUrl: 'https://api001.backblazeb2.com', downloadUrl: 'https://f001.backblazeb2.com',
  allowed: { buckets: [{ id: 'existing-private-bucket-id', name: 'existing-private-bucket' }],
    namePrefix: 'pct-workflow/', capabilities: ['readFiles','writeFiles'] },
} });

test('first install uses the new D1 and writes only encrypted objects to the scoped Backblaze prefix', async t => {
  const { dir, nda, agreement } = await localRelease(t);
  const contents = await Promise.all([readFile(nda), readFile(agreement)]);
  const config = JSON.parse(await readFile(path.join(dir, 'wrangler.json'), 'utf8'));
  assert.equal(config.vars.PCT_ENABLED, 'false');
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, []);
  assert.equal(config.r2_buckets, undefined);
  assert.doesNotMatch(JSON.stringify(config), /B2_APPLICATION_KEY|PCT_FILE_KEY/);
  assert.equal(config.d1_databases[0].database_name, 'researchvault-pct-workflow-db');
  const calls = [], objects = new Map();
  const run = (args, conf, secretInput) => {
    assert.equal(conf, path.join(dir, 'wrangler.json'));
    calls.push(args.slice(0, 3).join(' '));
    if (args[0] === 'd1' && args[1] === 'info') return ok({ uuid: config.d1_databases[0].database_id, name: config.d1_databases[0].database_name });
    if (args[0] === 'deployments') return missingWorker;
    if (args[0] === 'secret') {
      assert.deepEqual(args, ['secret', 'bulk']);
      const v = JSON.parse(secretInput);
      assert.match(v.PCT_FILE_KEY, /^[a-f0-9]{64}$/);
      assert.equal(v.B2_BUCKET_ID, 'existing-private-bucket-id');
      assert.equal(v.B2_APPLICATION_KEY, credentials.B2_APPLICATION_KEY);
    }
    return ok();
  };
  await installRelease(dir, { credentials, authorize: auth, run,
    upload: async (env, key, bytes) => {
      assert.equal(env.B2_BUCKET_NAME, 'existing-private-bucket');
      assert.match(key, /^pct-workflow\/legal\//);
      assert.ok(contents.every(original => !bytes.equals(original) && !bytes.includes(original)));
      objects.set(key, bytes);
    },
    download: async (_env, key) => objects.get(key) ?? null,
    fetcher: async (url, options) => {
      assert.match(url, /^https:\/\/f001\.backblazeb2\.com\/file\/existing-private-bucket\/pct-workflow\/legal\//);
      assert.equal(options.method, 'HEAD');
      assert.equal(options.headers, undefined);
      return new Response(null, { status: 401 });
    },
  });
  assert.equal(objects.size, 2);
  assert.deepEqual(calls, ['d1 info PCT_DB', 'deployments list --name', 'd1 migrations apply', 'deploy', 'secret bulk']);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'install-complete.json'), 'utf8')).enabled, false);
});

test('an unscoped key or an existing Worker prevents deployment before any remote writes', async t => {
  const { dir } = await localRelease(t);
  const config = JSON.parse(await readFile(path.join(dir, 'wrangler.json'), 'utf8'));
  const upload = () => assert.fail('no upload permitted');
  await assert.rejects(installRelease(dir, { credentials, upload, run: () => assert.fail('no Cloudflare call permitted'),
    authorize: () => { const a = auth(); a.storage.allowed.namePrefix = ''; return a; },
  }), /restricted to one private bucket/);
  await assert.rejects(installRelease(dir, { credentials, upload, authorize: auth, run: args => {
    if (args[0] === 'd1' && args[1] === 'info') return ok({ uuid: config.d1_databases[0].database_id, name: config.d1_databases[0].database_name });
    if (args[0] === 'deployments') return ok([]);
    assert.fail('no remote mutation permitted');
  } }), /new Worker name is unused/);
});

test('Telegram setup checks the active private deployment without reaching the public site', async t => {
  const {dir}=await localRelease(t);
  await writeFile(path.join(dir,'install-complete.json'),JSON.stringify({worker:'researchvault-pct-workflow',enabled:false}));
  const admin='77777', token='123456:synthetic_test_token_only';
  const conf=path.join(dir,'wrangler.json');
  const config=JSON.parse(await readFile(conf,'utf8'));
  const id='7ab8cd12-e345-4f67-a890-abcdef012345';
  const calls=[];
  const updates=[];
  const run=({enabled='false',percentage=100,database=config.d1_databases[0].database_id}={})=>(args,configPath,input)=>{
    assert.equal(configPath,conf);
    calls.push(args.slice(0,2).join(' '));
    if (args[0]==='deployments') {
      assert.deepEqual(args,['deployments','status','--name',config.name,'--json']);
      return ok({versions:[{version_id:id,percentage}]});
    }
    if (args[0]==='versions') {
      assert.deepEqual(args,['versions','view',id,'--name',config.name,'--json']);
      return ok({id,resources:{bindings:[
        ...Object.entries({...config.vars,PCT_ENABLED:enabled}).map(([name,text])=>({name,text,type:'plain_text'})),
        {name:'PCT_DB',type:'d1',id:database},
        {name:'PATENT_API',type:'service',service:config.services[0].service},
        ...['PCT_FILE_KEY','B2_KEY_ID','B2_APPLICATION_KEY','B2_BUCKET_ID','B2_BUCKET_NAME'].map(name=>({name,type:'secret_text'})),
      ]}});
    }
    assert.equal(enabled,'false');
    assert.equal(percentage,100);
    assert.equal(database,config.d1_databases[0].database_id);
    if (args[0]==='deploy') assert.deepEqual(args,['deploy','--keep-vars']);
    else {
      assert.deepEqual(args,['secret','bulk']);
      updates.push(JSON.parse(input));
    }
    return ok();
  };
  const noNetwork=async()=>assert.fail('No public network calls without a notification token');
  for (const [settings,error] of [
    [{enabled:'true'},/Enrollment is not confirmed closed/],
    [{percentage:80},/one active version/],
    [{database:'unexpected'},/does not match the dedicated PCT release/],
  ]) await assert.rejects(connectAdmin(dir,{admin,run:run(settings),fetcher:noNetwork}),error);
  assert.equal(updates.length,0);
  assert.equal(calls.some(value=>value.startsWith('deploy ')),false);
  calls.length=0;
  await connectAdmin(dir,{admin,token,run:run(),fetcher:async url=>{
    assert.equal(url,`https://api.telegram.org/bot${token}/getMe`);
    return Response.json({ok:true,result:{username:'ResearchVaultAgentBot'}});
  }});
  assert.deepEqual(calls,['deployments status','versions view','deploy --keep-vars','secret bulk']);
  assert.deepEqual(updates[0],{PCT_TELEGRAM_ADMIN_IDS:admin,PCT_NOTIFY_CHAT_ID:admin,PCT_TELEGRAM_NOTIFY_TOKEN:token});
  await connectAdmin(dir,{admin,token,run:run(),fetcher:async()=>{throw new TypeError('Network unavailable');}});
  assert.deepEqual(updates[1],{PCT_TELEGRAM_ADMIN_IDS:admin,PCT_NOTIFY_CHAT_ID:admin});
});
