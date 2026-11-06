import { nowSec, sha256Hex } from '../../patent-api/src/security.js';
import { ensure, labels, settle } from './state.js';
import { caseById, save } from './repository.js';

const TRONGRID = 'https://api.trongrid.io';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TX = /^[a-f0-9]{64}$/;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const usdtEnabled = env => env.PCT_USDT_ENABLED === 'true' &&
  Boolean(env.PCT_USDT_ADDRESSES?.trim() && env.PCT_TRONGRID_API_KEY?.trim());

export async function tronAddressHex(address) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return null;
  let number = 0n;
  for (const character of address) number = number * 58n + BigInt(BASE58.indexOf(character));
  const hex = number.toString(16).padStart(50, '0');
  if (hex.length !== 50 || !hex.startsWith('41')) return null;
  const bytes = Uint8Array.from(hex.match(/../g), pair => parseInt(pair,16));
  const hash = await crypto.subtle.digest('SHA-256', await crypto.subtle.digest('SHA-256',bytes.slice(0,21)));
  if (!new Uint8Array(hash).slice(0,4).every((byte,index)=>byte===bytes[index+21])) return null;
  return hex.slice(2,42);
}

async function addresses(env) {
  const pool = [...new Set(env.PCT_USDT_ADDRESSES.trim().split(/[\s,]+/))];
  ensure(pool.length <= 500, 'USDT checkout is unavailable. Contact ResearchVault.',503,'checkout_unavailable');
  const valid = await Promise.all(pool.map(tronAddressHex));
  ensure(valid.every(Boolean), 'USDT checkout is unavailable. Contact ResearchVault.',503,'checkout_unavailable');
  return pool;
}

function findCheckout(db,id,key) {
  return db.prepare('SELECT * FROM pct_usdt_checkouts WHERE case_id=? AND milestone=?').bind(id,key).first();
}

function publicCheckout(checkout) {
  return { address:checkout.address, amount_cents:checkout.amount_cents, network:'TRON (TRC20)',
    status:checkout.review_required ? 'review_required' : 'awaiting_transfer' };
}

export async function openCheckout(env,row,key,at=nowSec()) {
  ensure(usdtEnabled(env), 'USDT checkout is currently unavailable.',503,'checkout_unavailable');
  const invoice = Object.hasOwn(labels,key) && row.state.invoices[key];
  ensure(invoice, 'Invoice not found.',404,'not_found');
  if (invoice.status==='paid') return {status:'paid'};
  ensure(invoice.status==='issued' && !invoice.receipt, 'This invoice is unavailable for automatic checkout.',409,'checkout_unavailable');
  const db = env.PCT_DB;
  const previous = await findCheckout(db,row.id,key);
  if (previous) return publicCheckout(previous);
  const pool = await addresses(env);
  const created = await db.prepare(`INSERT INTO pct_usdt_checkouts(case_id,milestone,address,amount_cents,started_at,next_check_at)
    SELECT ?,?,pool.value,?,?,? FROM json_each(?) pool
    WHERE NOT EXISTS (SELECT 1 FROM pct_usdt_used_addresses used WHERE used.address=pool.value)
    AND EXISTS (SELECT 1 FROM pct_cases WHERE id=? AND revision=? AND stage<>'wipe_pending')
    ORDER BY pool.key LIMIT 1 ON CONFLICT(case_id,milestone) DO NOTHING RETURNING *`)
    .bind(row.id,key,invoice.amount_cents,at,at,JSON.stringify(pool),row.id,row.revision).first();
  const checkout = created || await findCheckout(db,row.id,key);
  ensure(checkout, 'No USDT checkout address is available. Contact ResearchVault before sending funds.',503,'checkout_unavailable');
  return publicCheckout(checkout);
}

export function matchingReceipt(receipt,txid,checkout,recipient) {
  if (receipt?.id?.toLowerCase() !== txid || !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber <= 0 ||
      !Number.isSafeInteger(receipt.blockTimeStamp) || receipt.blockTimeStamp < checkout.started_at*1000 ||
      receipt.receipt?.result !== 'SUCCESS' || (receipt.result && receipt.result !== 'SUCCESS') ||
      !Array.isArray(receipt.log)) return false;
  const amount=BigInt(checkout.amount_cents)*10000n;
  const matches=receipt.log.filter(log=>log?.address?.toLowerCase() === USDT_HEX &&
    Array.isArray(log.topics) && log.topics.length === 3 && log.topics[0]?.toLowerCase() === TRANSFER &&
    /^[a-f0-9]{64}$/i.test(log.topics[1] || '') && log.topics[2]?.toLowerCase() === recipient.padStart(64,'0') &&
    /^[a-f0-9]{64}$/i.test(log.data || '') && BigInt('0x'+log.data)===amount);
  return matches.length===1;
}

async function tronJSON(env,url,fetcher,body) {
  const headers={'TRON-PRO-API-KEY':env.PCT_TRONGRID_API_KEY};
  const options={headers,signal:AbortSignal.timeout(4500),redirect:'error'};
  if (body) {
    headers['content-type']='application/json';
    options.method='POST';
    options.body=JSON.stringify(body);
  }
  const response=await fetcher(url,options);
  if (!response.ok || !response.body) throw new Error('tron_unavailable');
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let size=0, text='';
  for (;;) {
    const {done,value}=await reader.read();
    if (done) break;
    size+=value.length;
    if (size>262144) {
      await reader.cancel();
      throw new Error('tron_response_limit');
    }
    text+=decoder.decode(value,{stream:true});
  }
  return JSON.parse(text+decoder.decode());
}

async function verifiedTransfer(env,checkout,fetcher) {
  const url=new URL(`/v1/accounts/${checkout.address}/transactions/trc20`,TRONGRID);
  url.search=new URLSearchParams({only_confirmed:'true',only_to:'true',contract_address:USDT,
    min_timestamp:String(checkout.started_at*1000),limit:'20'});
  const history=await tronJSON(env,url,fetcher);
  if (history?.success!==true || !Array.isArray(history.data)) throw new Error('tron_unavailable');
  const incoming=history.data.filter(entry=>entry?.type==='Transfer' && entry.to===checkout.address &&
    entry.token_info?.address===USDT && Number.isSafeInteger(entry.block_timestamp) &&
    entry.block_timestamp>=checkout.started_at*1000 && TX.test(entry.transaction_id || '') &&
    /^\d{1,30}$/.test(entry.value || ''));
  const exact=incoming.filter(entry=>BigInt(entry.value)===BigInt(checkout.amount_cents)*10000n);
  const txids=[...new Set(exact.map(entry=>entry.transaction_id))];
  if (txids.length!==1 || history.data.length>=20) {
    return {review:incoming.length>0 || history.data.length>=20};
  }
  const recipient=await tronAddressHex(checkout.address);
  if (!recipient) throw new Error('invalid_checkout_address');
  const txid=txids[0];
  const receipt=await tronJSON(env,TRONGRID+'/walletsolidity/gettransactioninfobyid',fetcher,{value:txid});
  return matchingReceipt(receipt,txid,checkout,recipient) ? {txid} : {};
}

function nextCheck(db,at,caseId,key) {
  return db.prepare(`UPDATE pct_usdt_checkouts SET next_check_at=? WHERE address=(
    SELECT p.address FROM pct_usdt_checkouts p JOIN pct_cases c ON c.id=p.case_id
    WHERE p.next_check_at<=? AND c.stage<>'wipe_pending'
    AND (? IS NULL OR p.case_id=?) AND (? IS NULL OR p.milestone=?)
    AND json_extract(c.state_json,'$.invoices.'||p.milestone||'.status')='issued'
    AND json_extract(c.state_json,'$.invoices.'||p.milestone||'.receipt') IS NULL
    ORDER BY p.next_check_at,p.address LIMIT 1) RETURNING *`)
    .bind(at+45,at,caseId,caseId,key,key).first();
}

async function flagReview(db,checkout,at) {
  const row=await caseById(db,checkout.case_id), invoice=row.state.invoices[checkout.milestone];
  if (invoice?.status!=='issued') return;
  if (!invoice.usdt_review_at) {
    invoice.usdt_review_at=at;
    await save(db,row,'tron_usdt','usdt_payment_review',{milestone:checkout.milestone},true);
  }
  await db.prepare('UPDATE pct_usdt_checkouts SET review_required=1 WHERE address=?').bind(checkout.address).run();
}

export async function reconcileCheckout(env,{caseId=null,key=null,at=nowSec(),fetcher=fetch}={}) {
  if (!usdtEnabled(env)) return;
  const db=env.PCT_DB, checkout=await nextCheck(db,at,caseId,key);
  if (!checkout) return;
  try {
    const result=await verifiedTransfer(env,checkout,fetcher);
    if (!result.txid) {
      if (result.review) await flagReview(db,checkout,at);
      return;
    }
    const row=await caseById(db,checkout.case_id), invoice=row.state.invoices[checkout.milestone];
    if (invoice?.status!=='issued' || invoice.receipt || invoice.amount_cents!==checkout.amount_cents) return;
    const payment_evidence_key=await sha256Hex('usdt_trc20:'+result.txid);
    if (await db.prepare(`SELECT 1 FROM pct_verified_payment_refs WHERE evidence_key=?
      UNION ALL SELECT 1 FROM pct_spent_payment_digests WHERE evidence_key=?`)
      .bind(payment_evidence_key,payment_evidence_key).first()) {
      await flagReview(db,checkout,at);
      return;
    }
    settle(row.state,checkout.milestone,{mode:'verified_on_tron',method:'usdt_trc20',reference:result.txid},at);
    const type=checkout.milestone==='consultation'?'consultation_requested':'payment_confirmed';
    await save(db,row,'tron_usdt',type,{milestone:checkout.milestone,amount_cents:invoice.amount_cents,payment_evidence_key},true);
  } catch (error) {
    // A provider timeout, competing case mutation or delayed finality is
    // retried on the next check. Never store provider bodies or credentials.
    if (/pct_payment_already_consumed|UNIQUE constraint failed: pct_verified_payment_refs/.test(error?.message || '')) {
      await flagReview(db,checkout,at);
    }
  }
}

export async function checkCheckout(env,row,key) {
  ensure(Object.hasOwn(labels,key) && row.state.invoices[key], 'Invoice not found.',404,'not_found');
  if (row.state.invoices[key].status==='paid') return {status:'paid'};
  const checkout=await findCheckout(env.PCT_DB,row.id,key);
  ensure(checkout, 'Open the USDT checkout first.',409,'checkout_unavailable');
  await reconcileCheckout(env,{caseId:row.id,key});
  const current=await caseById(env.PCT_DB,row.id,row.user_id);
  if (current.state.invoices[key].status==='paid') return {status:'paid'};
  const updated=await findCheckout(env.PCT_DB,row.id,key);
  ensure(updated, 'This checkout is unavailable.',409,'checkout_unavailable');
  return publicCheckout(updated);
}
