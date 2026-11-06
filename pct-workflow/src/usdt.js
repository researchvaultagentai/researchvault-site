import { nowSec, randomToken, sha256Hex } from '../../patent-api/src/security.js';
import { ensure, labels, settle } from './state.js';
import { caseById, save } from './repository.js';
import { USDT } from '../../deploy/patent-en/payments-config.js';

const TRONGRID = 'https://api.trongrid.io';
const USDT_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const TRANSFER = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TX = /^[a-f0-9]{64}$/;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ADDRESS_CHECKOUTS = 'pct_usdt_checkouts';
const REFERENCE_CHECKOUTS = 'pct_usdt_reference_checkouts';

export const usdtEnabled = env => env.PCT_USDT_ENABLED === 'true' &&
  Boolean(env.PCT_TRONGRID_API_KEY?.trim());

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

async function findCheckout(db,id,key) {
  const read=table=>db.prepare(`SELECT * FROM ${table} WHERE case_id=? AND milestone=?`).bind(id,key).first();
  return await read(REFERENCE_CHECKOUTS) || await read(ADDRESS_CHECKOUTS);
}

function publicCheckout(checkout) {
  const {address,amount_cents,reference,txid,issue,review_required}=checkout;
  return {address,amount_cents,network:USDT.network,
    ...(reference ? {reference,txid} : {}),
    status:issue || (review_required?'review_required':txid?'checking_transfer':'awaiting_transfer')};
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
  ensure(await tronAddressHex(USDT.address),'USDT checkout is unavailable. Contact ResearchVault.',503,'checkout_unavailable');
  // The memo is public on TRON. It must contain no case or client data.
  const reference='RVPCT-'+randomToken(12);
  const created = await db.prepare(`INSERT INTO pct_usdt_reference_checkouts(
    case_id,milestone,address,reference,amount_cents,started_at,next_check_at)
    SELECT id,?,?,?,?,?,? FROM pct_cases WHERE id=? AND revision=? AND stage<>'wipe_pending'
    ON CONFLICT(case_id,milestone) DO NOTHING RETURNING *`)
    .bind(key,USDT.address,reference,invoice.amount_cents,at,at,row.id,row.revision).first();
  const checkout = created || await findCheckout(db,row.id,key);
  ensure(checkout,'The invoice changed. Refresh your case and open checkout again.',409,'case_changed');
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

async function verifyAddressTransfer(env,checkout,fetcher) {
  const url=new URL(`/v1/accounts/${checkout.address}/transactions/trc20`,TRONGRID);
  url.search=new URLSearchParams({only_confirmed:'true',only_to:'true',contract_address:USDT.contract,
    min_timestamp:String(checkout.started_at*1000),limit:'20'});
  const history=await tronJSON(env,url,fetcher);
  if (history?.success!==true || !Array.isArray(history.data)) throw new Error('tron_unavailable');
  const incoming=history.data.filter(entry=>entry?.type==='Transfer' && entry.to===checkout.address &&
    entry.token_info?.address===USDT.contract && Number.isSafeInteger(entry.block_timestamp) &&
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

async function verifyReferencedTransfer(env,checkout,fetcher) {
  const body={value:checkout.txid};
  const transaction=await tronJSON(env,TRONGRID+'/walletsolidity/gettransactionbyid',fetcher,body);
  if (transaction?.txID?.toLowerCase()!==checkout.txid) return {};
  const memo=Array.from(new TextEncoder().encode(checkout.reference),byte=>byte.toString(16).padStart(2,'0')).join('');
  if (transaction.raw_data?.data?.toLowerCase()!==memo) return {issue:'reference_mismatch'};
  const receipt=await tronJSON(env,TRONGRID+'/walletsolidity/gettransactioninfobyid',fetcher,body);
  if (receipt?.id?.toLowerCase()!==checkout.txid) return {};
  const recipient=await tronAddressHex(checkout.address);
  if (!recipient) throw new Error('invalid_checkout_address');
  return matchingReceipt(receipt,checkout.txid,checkout,recipient) ? {txid:checkout.txid} : {review:true};
}

function nextCheck(db,table,at,caseId,key) {
  const submitted=table===REFERENCE_CHECKOUTS?'AND p.txid IS NOT NULL AND p.issue IS NULL':'';
  return db.prepare(`UPDATE ${table} SET next_check_at=? WHERE (case_id,milestone)=(
    SELECT p.case_id,p.milestone FROM ${table} p JOIN pct_cases c ON c.id=p.case_id
    WHERE p.next_check_at<=? AND c.stage<>'wipe_pending' ${submitted}
    AND (? IS NULL OR p.case_id=?) AND (? IS NULL OR p.milestone=?)
    AND json_extract(c.state_json,'$.invoices.'||p.milestone||'.status')='issued'
    AND json_extract(c.state_json,'$.invoices.'||p.milestone||'.receipt') IS NULL
    ORDER BY p.next_check_at,p.case_id,p.milestone LIMIT 1) RETURNING *`)
    .bind(at+45,at,caseId,caseId,key,key).first();
}

function markIssue(db,checkout,issue) {
  return db.prepare(`UPDATE pct_usdt_reference_checkouts SET issue=? WHERE case_id=? AND milestone=? AND txid=?`)
    .bind(issue,checkout.case_id,checkout.milestone,checkout.txid).run();
}

async function flagReview(db,checkout,at) {
  const row=await caseById(db,checkout.case_id), invoice=row.state.invoices[checkout.milestone];
  if (invoice?.status!=='issued') return;
  if (!invoice.usdt_review_at) {
    invoice.usdt_review_at=at;
    await save(db,row,'tron_usdt','usdt_payment_review',{milestone:checkout.milestone},true);
  }
  if (checkout.reference) await markIssue(db,checkout,'review_required');
  else await db.prepare('UPDATE pct_usdt_checkouts SET review_required=1 WHERE address=?').bind(checkout.address).run();
}

export async function reconcileCheckout(env,{caseId=null,key=null,at=nowSec(),fetcher=fetch}={}) {
  if (!usdtEnabled(env)) return;
  const db=env.PCT_DB;
  const checkout=await nextCheck(db,REFERENCE_CHECKOUTS,at,caseId,key) ||
    await nextCheck(db,ADDRESS_CHECKOUTS,at,caseId,key);
  if (!checkout) return;
  try {
    const result=await (checkout.reference ? verifyReferencedTransfer : verifyAddressTransfer)(env,checkout,fetcher);
    if (!result.txid) {
      if (result.issue) await markIssue(db,checkout,result.issue);
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

export async function checkCheckout(env,row,key,submittedTxid,{at=nowSec(),fetcher=fetch}={}) {
  ensure(usdtEnabled(env), 'USDT checkout is currently unavailable.',503,'checkout_unavailable');
  ensure(Object.hasOwn(labels,key) && row.state.invoices[key], 'Invoice not found.',404,'not_found');
  const invoice=row.state.invoices[key];
  if (invoice.status==='paid') return {status:'paid'};
  const db=env.PCT_DB, checkout=await findCheckout(db,row.id,key);
  ensure(checkout && invoice.status==='issued' && !invoice.receipt, 'Open the USDT checkout first.',409,'checkout_unavailable');
  if (submittedTxid!==undefined) {
    const txid=typeof submittedTxid==='string' ? submittedTxid.trim().toLowerCase() : '';
    ensure(checkout.reference && TX.test(txid), 'Enter a valid TRON transaction ID.',422,'invalid_receipt');
    await db.prepare(`UPDATE pct_usdt_reference_checkouts SET txid=?,issue=NULL
      WHERE case_id=? AND milestone=? AND (txid IS NULL OR txid<>?)`).bind(txid,row.id,key,txid).run();
  }
  await reconcileCheckout(env,{caseId:row.id,key,at,fetcher});
  const current=await caseById(db,row.id,row.user_id);
  if (current.state.invoices[key].status==='paid') return {status:'paid'};
  const updated=await findCheckout(db,row.id,key);
  ensure(updated, 'This checkout is unavailable.',409,'checkout_unavailable');
  return publicCheckout(updated);
}
