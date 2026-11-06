import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyGoogleIdToken } from '../src/accounts.js';

test('Google sign-in requires a valid signature, intended audience and verified email tied to Google', async () => {
  const algorithm={name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:Uint8Array.of(1,0,1),hash:'SHA-256'};
  const pair=await crypto.subtle.generateKey(algorithm,true,['sign','verify']);
  const key=await crypto.subtle.exportKey('jwk',pair.publicKey);
  const now=120000, clientId='test.apps.googleusercontent.com', kid='TEST-KEY-123', nonce='synthetic';
  const claims={iss:'https://accounts.google.com',aud:clientId,sub:'test-subject',email:'test-user@gmail.com',
    email_verified:true,iat:now-3,exp:now+120,nonce};
  const verify=token=>verifyGoogleIdToken(token,{clientId,nonce,now,findKey:async requested=>requested===kid?key:null});
  const encode=b=>Buffer.from(JSON.stringify(b)).toString('base64url');
  const make=async c=>{
    const head=encode({alg:'RS256',kid})+'.'+encode(c);
    return head+'.'+Buffer.from(await crypto.subtle.sign(algorithm,pair.privateKey,Buffer.from(head))).toString('base64url');
  };
  const token=await make(claims);
  assert.deepEqual(await verify(token),{email:'test-user@gmail.com',subject:'test-subject'});
  for(const patch of [{aud:'other-app'},{nonce:'not-this-login'},{email_verified:false},{exp:now-1},{email:'someone@example.test'}]){
    await assert.rejects(verify(await make({...claims,...patch})));
  }
  await assert.rejects(verify(token.slice(0,-10)+'AAAAAAAAAA'));
});
