const encoder=new TextEncoder();
export function nowSec(){return Math.floor(Date.now()/1000)}
export function uid(prefix='id'){return `${prefix}_${crypto.randomUUID().replaceAll('-','')}`}
export function normalizeEmail(v=''){return String(v).trim().toLowerCase()}
export function sanitizeText(v='',max=500){return String(v).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max)}
export function sanitizeFilename(v='file'){const n=String(v).normalize('NFKC').replace(/[\\/\0\r\n\t<>:"|?*]/g,'_').replace(/\s+/g,' ').trim();return(n||'file').slice(0,160)}
export async function sha256Hex(value){const bytes=value instanceof ArrayBuffer?value:value instanceof Uint8Array?value:encoder.encode(String(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}
export async function hmacHex(secret,value){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,encoder.encode(String(value)));return[...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}
export function randomDigits(len=6){const a=new Uint32Array(1);crypto.getRandomValues(a);return String(a[0]%(10**len)).padStart(len,'0')}
export function randomToken(bytes=32){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return[...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function parseCookie(req,name){const raw=req.headers.get('cookie')||'';for(const part of raw.split(';')){const[k,...rest]=part.trim().split('=');if(k===name)return decodeURIComponent(rest.join('='))}return null}
export function sessionCookie(token,maxAge,secure=true){return `patent_session=${encodeURIComponent(token)}; Path=/; HttpOnly; ${secure?'Secure; ':''}SameSite=Strict; Max-Age=${maxAge}`}
export function clearSessionCookie(secure=true){return `patent_session=; Path=/; HttpOnly; ${secure?'Secure; ':''}SameSite=Strict; Max-Age=0`}
export function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}})}
export function error(message,status=400,code='bad_request'){return json({ok:false,error:code,message},status)}
export function clientIp(req){return req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown'}
export function allowedOrigin(req,env){const origin=req.headers.get('origin');if(!origin)return null;const allowed=String(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);return allowed.includes(origin)?origin:null}
export function corsHeaders(req,env){const origin=allowedOrigin(req,env);return origin?{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,x-admin-action,x-requested-with','vary':'Origin'}:{}}
export function securityHeaders(extra={}){return{'x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()','x-frame-options':'DENY','cache-control':'no-store',...extra}}
export function isAdminEmail(email,env){const admins=String(env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);return admins.includes(String(email||'').toLowerCase())}
export async function ipHash(req,env){return sha256Hex(`${clientIp(req)}:${env.OTP_PEPPER||env.SESSION_PEPPER||'pepper'}`)}
export async function uaHash(req){return sha256Hex(req.headers.get('user-agent')||'unknown')}
