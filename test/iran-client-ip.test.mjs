import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from '../patent-api/src/security.js';
const request=headers=>new Request('https://patent-api.researchvaultagent.ir/api/me',{headers});
test('an ordinary visitor cannot override the Cloudflare address',()=>{
  assert.equal(clientIp(request({'cf-connecting-ip':'198.51.100.12','x-rv-client-ip':'203.0.113.7','x-forwarded-for':'203.0.113.8'})),'198.51.100.12');
});
test('the known VPS may preserve a single valid IPv4 or IPv6 client address',()=>{
  for(const ip of ['203.0.113.7','2001:db8::1234','::ffff:192.0.2.1']){
    const expected=ip.includes(':')?new URL(`http://[${ip}]/`).hostname.slice(1,-1):ip;
    assert.equal(clientIp(request({'cf-connecting-ip':'89.44.241.208','x-rv-client-ip':ip})),expected);
  }
});
test('invalid or chained proxy addresses never replace the known VPS address',()=>{
  for(const ip of ['','203.0.113.7, 198.51.100.2','999.1.1.1','1.2.3','010.1.1.1','2001:db8::1:garbage','[::1]','::1%eth0','host.example','https://evil.example']){
    assert.equal(clientIp(request({'cf-connecting-ip':'89.44.241.208','x-rv-client-ip':ip})),'89.44.241.208');
  }
});
test('the existing no-Cloudflare fallback remains available',()=>{
  assert.equal(clientIp(request({'x-forwarded-for':'198.51.100.7, 203.0.113.2'})),'198.51.100.7');
  assert.equal(clientIp(request({})),'unknown');
});
