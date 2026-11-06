import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { putObject } from '../src/files.js';
import { sha256Hex } from '../../patent-api/src/security.js';

const [nda, agreement, output]=process.argv.slice(2);
if (!nda || !agreement || !output || !/^[a-f0-9]{64}$/i.test(process.env.PCT_FILE_KEY || '')) {
  throw new Error('Provide NDA PDF, agreement DOCX, an output outside the repository and the PCT_FILE_KEY environment secret.');
}
const target=path.resolve(output);
await mkdir(target,{mode:0o700,recursive:true});
const manifest={};
for (const [kind,source,version,file] of [
  ['UNDERTAKING',nda,'RV-CONF-EN-v1','undertaking-rv-conf-en-v1.pdf'],
  ['AGREEMENT',agreement,'PCT-INT-v3','agreement-pct-int-v3.docx'],
]) {
  const bytes=await readFile(source), key='pct-workflow/legal/'+file;
  if (kind==='UNDERTAKING' && bytes.subarray(0,5).toString()!=='%PDF-') throw new Error('Expected the signed undertaking PDF.');
  if (kind==='AGREEMENT' && bytes.subarray(0,2).toString()!=='PK') throw new Error('Expected the editable agreement DOCX.');
  const destination=path.join(target,file+'.encrypted');
  await putObject({PCT_FILE_KEY:process.env.PCT_FILE_KEY,PCT_STORE:{put:(_key,packed)=>writeFile(destination,packed,{mode:0o600})}},key,bytes);
  manifest['PCT_'+kind+'_KEY']=key;
  manifest['PCT_'+kind+'_VERSION']=version;
  manifest['PCT_'+kind+'_SHA256']=await sha256Hex(bytes);
}
await writeFile(path.join(target,'vars.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
console.log('Prepared encrypted objects and deployment metadata outside the site output.');
