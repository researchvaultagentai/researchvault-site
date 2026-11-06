import { json, normalizeEmail, nowSec, parseCookie, randomToken, sha256Hex, uid } from '../../patent-api/src/security.js';
import { ensure } from './state.js';

const PORTAL = '/patent/en/workflow/';
const CALLBACK = '/api/pct/auth/google/callback';
const ITERATIONS = 600000;
const enc = new TextEncoder();
const decoder = new TextDecoder();
const b64 = a => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const local = env => env.ENVIRONMENT==='test';
const cookieName = env => local(env) ? 'pct_session' : '__Host-pct-session';
const secureCookie = (name, value, max, sameSite = 'Strict', secure = true) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${max}${secure?'; Secure':''}`;
const pepperOk = env => typeof env.PCT_AUTH_PEPPER==='string' && env.PCT_AUTH_PEPPER.length>=32;
const googleOk = env => pepperOk(env) && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(env.PCT_GOOGLE_CLIENT_ID || '') &&
  Boolean(env.PCT_GOOGLE_CLIENT_SECRET) && /^https:\/\//.test(env.PCT_ORIGIN || '');
const passwordOk = env => pepperOk(env) && env.PCT_PASSWORD_ENABLED === 'true';
const validEmail = email => /^[^\s@]{1,160}@[^\s@]{1,160}\.[^\s@]{2,63}$/.test(email) && email.length<=254;
const fp = (env, token) => sha256Hex(env.PCT_AUTH_PEPPER + ':' + token);

export async function accountForEmail(env, email, existingId) {
  email=normalizeEmail(email);
  const db=env.PCT_DB;
  const get=()=>db.prepare('SELECT id,email,google_subject,password_salt,password_hash FROM pct_accounts WHERE email=?').bind(email).first();
  const existing=await get();
  if(existing)return existing;
  await db.prepare('INSERT OR IGNORE INTO pct_accounts(id,email,created_at) VALUES(?,?,?)')
    .bind(existingId || uid('pctusr'),email,nowSec()).run();
  return get();
}

export async function localSession(req,env) {
  if(!pepperOk(env)) return null;
  const token=parseCookie(req,cookieName(env));
  if(!/^[a-f0-9]{64}$/.test(token || ''))return null;
  const row=await env.PCT_DB.prepare(`SELECT a.id,a.email FROM pct_sessions s JOIN pct_accounts a ON a.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>=?`).bind(await fp(env,token),nowSec()).first();
  return row ? { ...row, is_admin:false } : null;
}

async function newSession(env,profile) {
  const token=randomToken(32), t=nowSec(), ttl=14*86400;
  await env.PCT_DB.batch([
    env.PCT_DB.prepare('DELETE FROM pct_sessions WHERE expires_at<?').bind(t),
    env.PCT_DB.prepare('INSERT INTO pct_sessions VALUES(?,?,?)').bind(await fp(env,token),profile.id,t+ttl),
  ]);
  return secureCookie(cookieName(env),token,ttl,'Strict',!local(env));
}

async function throttle(req,env,kind,email='') {
  const t=nowSec(), db=env.PCT_DB;
  const ip=req.headers.get('cf-connecting-ip') || 'local';
  await db.prepare('DELETE FROM pct_auth_attempts WHERE expires_at<=?').bind(t).run();
  for(const [scope,limit] of [[kind+':ip:'+ip,24], ...(email?[[kind+':email:'+email,8]]:[])]) {
    const key=await fp(env,scope);
    const row=await db.prepare(`INSERT INTO pct_auth_attempts VALUES(?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).bind(key,t+900).first();
    ensure(row.attempts<=limit,'Please wait before trying again, or use an email code.',429,'auth_rate_limit');
  }
}

async function passwordDigest(env,password,salt) {
  // Include a server secret so a database dump is not enough to try guesses.
  const key=await crypto.subtle.importKey('raw',enc.encode(password+'\u0000'+env.PCT_AUTH_PEPPER),'PBKDF2',false,['deriveBits']);
  return b64(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unb64(salt),iterations:ITERATIONS},key,256));
}
const constantEqual = (a,b) => a.length===b.length && [...a].reduce((d,c,i)=>d | (c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
function passwordInput(password, create) {
  ensure(typeof password==='string' && !password.includes('\u0000') && enc.encode(password).length<=512 &&
    password.length >= (create?12:1), create ? 'Use a password of at least 12 characters.' : 'Email or password is incorrect.', 422,'invalid_password');
}

function jump(location,cookies=[]) {
  const headers=new Headers({location,'cache-control':'no-store','referrer-policy':'no-referrer'});
  for(const cookie of cookies)headers.append('set-cookie',cookie);
  return new Response(null,{status:303,headers});
}

export async function verifyGoogleIdToken(token,{clientId,nonce,findKey,now=nowSec()}) {
  ensure(typeof token==='string' && token.length<=12000,'Google sign-in could not be verified.',403,'invalid_google_token');
  const parts=token.split('.');
  let h, p, sig;
  try {
    if(parts.length!==3 || !parts.every(s=>/^[a-zA-Z0-9_-]+$/.test(s))) throw new Error();
    h=JSON.parse(decoder.decode(unb64(parts[0]))); p=JSON.parse(decoder.decode(unb64(parts[1]))); sig=unb64(parts[2]);
  }catch{ ensure(false,'Google sign-in could not be verified.',403,'invalid_google_token'); }
  ensure(h?.alg==='RS256' && /^[\w-]{8,100}$/.test(h.kid || ''),'Google sign-in could not be verified.',403,'invalid_google_token');
  const jwk=await findKey(h.kid);
  ensure(jwk?.kty==='RSA','Google sign-in could not be verified.',403,'invalid_google_token');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  ensure(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,sig,enc.encode(parts[0]+'.'+parts[1])),
    'Google sign-in could not be verified.',403,'invalid_google_token');
  const email=normalizeEmail(p?.email || '');
  const domain=email.split('@').at(-1);
  ensure(['https://accounts.google.com','accounts.google.com'].includes(p?.iss) && p.aud===clientId &&
    (!p.azp || p.azp===clientId) && Number.isInteger(p.exp) && p.exp>now && Number.isInteger(p.iat) &&
    p.iat<=now+60 && p.iat>=now-600 && p.nonce===nonce && p.email_verified===true && validEmail(email) &&
    typeof p.sub==='string' && p.sub.length>0 && p.sub.length<=100 &&
    (domain==='gmail.com' || (typeof p.hd==='string' && p.hd.toLowerCase()===domain)),
  'Google sign-in could not be verified. You can use your email code.',403,'invalid_google_token');
  return { email,subject:p.sub };
}

async function googleStart(req,env) {
  ensure(googleOk(env),'Use your email to sign in.',404,'not_found');
  await throttle(req,env,'google-start');
  const state=randomToken(24), nonce=randomToken(24), verifier=randomToken(32), t=nowSec();
  await env.PCT_DB.batch([
    env.PCT_DB.prepare('DELETE FROM pct_oauth_attempts WHERE expires_at<?').bind(t),
    env.PCT_DB.prepare('INSERT INTO pct_oauth_attempts VALUES(?,?,?,?)').bind(await fp(env,state),verifier,nonce,t+600),
  ]);
  const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  target.search=new URLSearchParams({client_id:env.PCT_GOOGLE_CLIENT_ID,redirect_uri:env.PCT_ORIGIN+CALLBACK,
    response_type:'code',scope:'openid email',nonce,state,code_challenge:b64(await crypto.subtle.digest('SHA-256',enc.encode(verifier))),
    code_challenge_method:'S256',prompt:'select_account'}).toString();
  return jump(target.toString(),[secureCookie('__Host-pct-oauth',state,600,'Lax')]);
}

async function googleCallback(req,env) {
  const clear=secureCookie('__Host-pct-oauth','',0,'Lax');
  try {
    ensure(googleOk(env),'Google sign-in is unavailable.',404);
    const url=new URL(req.url), state=url.searchParams.get('state'), code=url.searchParams.get('code');
    ensure(/^[a-f0-9]{48}$/.test(state || '') && constantEqual(state,parseCookie(req,'__Host-pct-oauth') || '') &&
      typeof code==='string' && code.length>0 && code.length<4096,'Invalid login state.',403);
    const attempt=await env.PCT_DB.prepare('DELETE FROM pct_oauth_attempts WHERE state_hash=? AND expires_at>=? RETURNING verifier,nonce')
      .bind(await fp(env,state),nowSec()).first();
    ensure(attempt,'Expired login state.',403);
    const token=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),
      headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
        grant_type:'authorization_code',client_id:env.PCT_GOOGLE_CLIENT_ID,client_secret:env.PCT_GOOGLE_CLIENT_SECRET,
        redirect_uri:env.PCT_ORIGIN+CALLBACK,code_verifier:attempt.verifier,code,
      })});
    ensure(token.ok,'Google sign-in was not confirmed.',403);
    const data=await token.json();
    const identity=await verifyGoogleIdToken(data.id_token,{clientId:env.PCT_GOOGLE_CLIENT_ID,nonce:attempt.nonce,findKey:async kid=>{
      const r=await fetch('https://www.googleapis.com/oauth2/v3/certs',{redirect:'error',signal:AbortSignal.timeout(5000)});
      ensure(r.ok,'Google sign-in was not confirmed.',403);
      return (await r.json()).keys?.find(k=>k.kid===kid);
    }});
    const profile=await accountForEmail(env,identity.email);
    if (!profile.google_subject) {
      const link=await env.PCT_DB.prepare('UPDATE pct_accounts SET google_subject=? WHERE id=? AND google_subject IS NULL RETURNING id')
        .bind(identity.subject,profile.id).first();
      ensure(link,'Google sign-in was not confirmed.',403);
    } else ensure(profile.google_subject===identity.subject,'Google sign-in was not confirmed.',403);
    return jump(PORTAL,[clear,await newSession(env,profile)]);
  } catch { return jump(PORTAL+'?sign-in=email',[clear]); }
}

export async function authRoute(req,env,path,{input,upstream,account}) {
  if(path==='/api/pct/auth/options' && req.method==='GET')return json({google:googleOk(env),password:passwordOk(env)});
  if(path==='/api/pct/auth/me' && req.method==='GET')return json({user:await account(req,env)});
  if(path==='/api/pct/auth/google/start' && req.method==='GET')return googleStart(req,env);
  if(path===CALLBACK && req.method==='GET')return googleCallback(req,env);
  if(path==='/api/pct/auth/logout' && req.method==='POST') {
    const token=parseCookie(req,cookieName(env));
    if(pepperOk(env) && /^[a-f0-9]{64}$/.test(token || ''))await env.PCT_DB.prepare('DELETE FROM pct_sessions WHERE token_hash=?').bind(await fp(env,token)).run();
    const old=await upstream(req,env,'/api/auth/logout',{});
    const headers=new Headers({'content-type':'application/json'});
    const legacy=old.headers.get('set-cookie');if(legacy)headers.append('set-cookie',legacy);
    headers.append('set-cookie',secureCookie(cookieName(env),'',0,'Strict',!local(env)));
    return new Response('{"ok":true}',{headers});
  }
  if(['/api/pct/auth/password/login','/api/pct/auth/password/set'].includes(path) && req.method==='POST'){
    ensure(passwordOk(env),'Use your email code to sign in.',404,'not_found');
    const b=await input(req), email=normalizeEmail(b.email || ''), create=path.endsWith('/set');
    ensure(validEmail(email),'Enter a valid email address.',422,'invalid_email');
    passwordInput(b.password,create);
    await throttle(req,env,create?'set':'password',email);
    let profile;
    if(create){
      ensure(/^[a-zA-Z0-9_-]{8,100}$/.test(b.challenge_id || '') && /^\d{6}$/.test(b.code || ''),
        'Verify your email with the code first.',422,'otp_required');
      const verify=await upstream(req,env,'/api/auth/verify-otp',{challenge_id:b.challenge_id,code:b.code});
      const verified=await verify.json().catch(()=>null);
      ensure(verify.ok && verified?.user?.id && verified.user.email===email,'That email code was not accepted.',403,'otp_required');
      profile=await accountForEmail(env,email,verified.user.id);
      const salt=b64(crypto.getRandomValues(new Uint8Array(24)));
      const hash=await passwordDigest(env,b.password,salt);
      await env.PCT_DB.batch([
        env.PCT_DB.prepare('UPDATE pct_accounts SET password_salt=?,password_hash=? WHERE id=?').bind(salt,hash,profile.id),
        env.PCT_DB.prepare('DELETE FROM pct_sessions WHERE user_id=?').bind(profile.id),
      ]);
    }else{
      profile=await env.PCT_DB.prepare('SELECT * FROM pct_accounts WHERE email=?').bind(email).first();
      const hash=await passwordDigest(env,b.password,profile?.password_salt || b64(new Uint8Array(24)));
      ensure(profile?.password_hash && constantEqual(hash,profile.password_hash),'Email or password is incorrect.',401,'invalid_login');
    }
    return json({user:{id:profile.id,email:profile.email,is_admin:false}},200,{'set-cookie':await newSession(env,profile)});
  }
  ensure(false,'Not found.',404,'not_found');
}
