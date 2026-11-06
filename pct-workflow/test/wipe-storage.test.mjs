import assert from 'node:assert/strict';
import test from 'node:test';
import { caseFileStore } from '../src/wipe-storage.js';

const id='pct_'+'a'.repeat(24), prefix=`pct-workflow/cases/${id}/`;
const env={B2_KEY_ID:'synthetic-key-id',B2_APPLICATION_KEY:'synthetic-key',B2_BUCKET_ID:'private-test-bucket'};
const auth=(capabilities=['listFiles','deleteFiles'])=>({authorizationToken:'test',apiInfo:{storageApi:{
  apiUrl:'https://api001.backblazeb2.com',allowed:{buckets:[{id:env.B2_BUCKET_ID}],namePrefix:'pct-workflow/',capabilities},
}}});

test('case wipe removes every B2 file version under its exact prefix and verifies emptiness',async()=>{
  const other={fileName:`pct-workflow/cases/${id}x/keep`,fileId:'keep'};
  const legal={fileName:'pct-workflow/legal/keep.pdf',fileId:'legal'};
  let files=[other,legal,...Array.from({length:26},(_,i)=>({fileName:prefix+(i<2?'same-file':'file'+i),fileId:'case-'+i}))];
  let deletes=0;
  const store=await caseFileStore(env,id,{fetcher:async (url,init)=>{
    assert.equal(init.redirect,'manual');
    if(url.endsWith('/b2_authorize_account')) return Response.json(auth());
    const b=JSON.parse(init.body);
    if(url.endsWith('/b2_list_file_versions')) {
      assert.equal(b.bucketId,env.B2_BUCKET_ID);
      assert.equal(b.prefix,prefix);
      const matching=files.filter(f=>f.fileName.startsWith(b.prefix));
      return Response.json({files:matching.slice(0,b.maxFileCount),nextFileName:matching[b.maxFileCount]?.fileName??null,
        nextFileId:matching[b.maxFileCount]?.fileId??null});
    }
    assert.ok(url.endsWith('/b2_delete_file_version'));
    assert.ok(b.fileName.startsWith(prefix));
    assert.equal(Object.hasOwn(b,'bypassGovernance'),false);
    deletes++;
    files=files.filter(f=>f.fileName!==b.fileName || f.fileId!==b.fileId);
    return Response.json(b);
  }});
  await store.check();
  assert.equal(deletes,0);
  assert.equal(await store.purge(),false);
  assert.equal(await store.purge(),true);
  assert.equal(deletes,26);
  assert.deepEqual(files,[other,legal]);
});

test('missing delete capability and a listing outside the selected prefix fail before deletion',async()=>{
  await assert.rejects(caseFileStore(env,id,{fetcher:async url=>{
    assert.ok(url.endsWith('/b2_authorize_account'));
    return Response.json(auth(['listFiles']));
  }}),{code:'wipe_storage_permission'});
  const store=await caseFileStore(env,id,{fetcher:async url=>{
    if(url.endsWith('/b2_authorize_account')) return Response.json(auth());
    assert.ok(url.endsWith('/b2_list_file_versions'));
    return Response.json({files:[{fileName:'pct-workflow/legal/keep.pdf',fileId:'outside'}]});
  }});
  await assert.rejects(store.purge(),/wipe_storage_invalid_listing/);
});
