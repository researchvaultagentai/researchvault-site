import { nowSec, randomToken, sha256Hex, uid } from '../../patent-api/src/security.js';
import { caseById } from './repository.js';
import { RuleError, ensure } from './state.js';
import { caseFileStore } from './wipe-storage.js';

const CASE = /^pct_[a-f0-9]{24}$/;
const CONFIRM = /^[a-f0-9]{24}$/;
const NOT_FOUND = 'Case not found.';

export async function lockCaseUpload(db, row) {
  const t=nowSec(), token=uid('upload');
  const changed=await db.prepare(`UPDATE pct_cases SET upload_token=?,upload_until=?
    WHERE id=? AND revision=? AND stage<>'wipe_pending' AND (upload_until IS NULL OR upload_until<=?)`)
    .bind(token,t+600,row.id,row.revision,t).run();
  ensure(changed.meta.changes===1, 'The case changed or a file is being uploaded. Refresh and try again.', 409, 'case_changed');
  return token;
}

export const unlockCaseUpload = (db,id,token) => db.prepare(`UPDATE pct_cases SET upload_token=NULL,upload_until=NULL
  WHERE id=? AND upload_token=?`).bind(id,token).run();

async function checkedStore(env,id) {
  try {
    const store=await caseFileStore(env,id);
    await store.check();
    return store;
  } catch (e) {
    if (e instanceof RuleError) throw e;
    throw new RuleError('Could not verify access to the private case files.',503,'wipe_storage_unavailable');
  }
}

export async function prepareWipe(env,id,actor) {
  ensure(CASE.test(id || ''),NOT_FOUND,404,'not_found');
  const row=await caseById(env.PCT_DB,id);
  await checkedStore(env,id);
  const token=randomToken(12), expires=nowSec()+300;
  const change=await env.PCT_DB.prepare(`INSERT INTO pct_case_wipes(case_id,actor,revision,confirmation_hash,expires_at)
    SELECT id,?,revision,?,? FROM pct_cases WHERE id=? AND revision=? AND stage<>'wipe_pending'
    ON CONFLICT(case_id) DO UPDATE SET actor=excluded.actor,revision=excluded.revision,
      confirmation_hash=excluded.confirmation_hash,expires_at=excluded.expires_at
    WHERE pct_case_wipes.confirmed_at IS NULL`)
    .bind(actor,await sha256Hex(token),expires,id,row.revision).run();
  ensure(change.meta.changes===1,'The case changed. Open a new wipe warning.',409,'case_changed');
  return {public_ref:row.public_ref,token,document_count:row.state.documents.length};
}

async function tokenHash(id,token) {
  ensure(CASE.test(id || '') && CONFIRM.test(token || ''),'Open a new wipe warning.',409,'wipe_confirmation');
  return sha256Hex(token);
}

export async function cancelWipe(env,id,actor,token) {
  const hash=await tokenHash(id,token);
  const r=await env.PCT_DB.prepare(`DELETE FROM pct_case_wipes WHERE case_id=? AND actor=? AND confirmation_hash=?
    AND confirmed_at IS NULL`).bind(id,actor,hash).run();
  return {cancelled:r.meta.changes===1};
}

export async function confirmWipe(env,id,actor,token) {
  const db=env.PCT_DB, hash=await tokenHash(id,token);
  const intent=await db.prepare(`SELECT revision FROM pct_case_wipes WHERE case_id=? AND actor=?
    AND confirmation_hash=? AND confirmed_at IS NULL AND expires_at>=?`).bind(id,actor,hash,nowSec()).first();
  ensure(intent,'This wipe confirmation expired or was cancelled. Open a new warning.',409,'wipe_confirmation');
  const store=await checkedStore(env,id);
  const t=nowSec();
  const result=await db.batch([
    db.prepare(`UPDATE pct_cases SET stage='wipe_pending',revision=revision+1,updated_at=?,event_json=?
      WHERE id=? AND revision=? AND stage<>'wipe_pending' AND (upload_until IS NULL OR upload_until<=?)
      AND NOT EXISTS(SELECT 1 FROM pct_events WHERE case_id=? AND lease_until>? AND notified_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM pct_team_updates WHERE case_id=? AND lease_until>? AND notified_at IS NULL)
      AND EXISTS(SELECT 1 FROM pct_case_wipes WHERE case_id=? AND actor=? AND revision=?
        AND confirmation_hash=? AND confirmed_at IS NULL AND expires_at>=?) RETURNING id`)
      .bind(t,JSON.stringify({type:'case_wipe_started',actor:`tg:${actor}`}),id,intent.revision,t,id,t,id,t,
        id,actor,intent.revision,hash,t),
    db.prepare(`UPDATE pct_case_wipes SET confirmed_at=?,confirmation_hash=''
      WHERE case_id=? AND actor=? AND confirmation_hash=? AND confirmed_at IS NULL AND expires_at>=?
      AND EXISTS(SELECT 1 FROM pct_cases WHERE id=? AND stage='wipe_pending' AND revision=?) RETURNING case_id`)
      .bind(t,id,actor,hash,t,id,intent.revision+1),
  ]);
  ensure(result[0].results?.[0]?.id===id && result[1].results?.[0]?.case_id===id,
    'The case changed or an upload or notice is still running. Refresh and try again.',409,'wipe_busy');
  return continueWipe(env,id,{store});
}

export async function continueWipe(env,id,{store}={}) {
  ensure(CASE.test(id || ''),NOT_FOUND,404,'not_found');
  const db=env.PCT_DB, t=nowSec(), lease=uid('wipe');
  const row=await db.prepare("SELECT public_ref FROM pct_cases WHERE id=? AND stage='wipe_pending'").bind(id).first();
  ensure(row,'No confirmed wipe was found for this case.',404,'not_found');
  const claim=await db.prepare(`UPDATE pct_case_wipes SET lease_token=?,lease_until=?
    WHERE case_id=? AND confirmed_at IS NOT NULL AND (lease_until IS NULL OR lease_until<=?)`)
    .bind(lease,t+90,id,t).run();
  const status=(state,reason)=>({state,public_ref:row.public_ref,...(reason?{reason}:{})});
  if (claim.meta.changes!==1) return status('pending','working');
  try {
    const files=store || await caseFileStore(env,id);
    if (!await files.purge()) return status('pending','more_files');
    const end=nowSec();
    const ownsLease=`EXISTS(SELECT 1 FROM pct_case_wipes WHERE case_id=? AND confirmed_at IS NOT NULL
      AND lease_token=? AND lease_until>=?)`;
    const args=[id,id,lease,end];
    const children=['pct_events','pct_admin_links','pct_signature_challenges','pct_verified_payment_refs'];
    const result=await db.batch([
      db.prepare(`INSERT OR IGNORE INTO pct_spent_payment_digests(evidence_key)
        SELECT evidence_key FROM pct_verified_payment_refs WHERE case_id=? AND ${ownsLease}`).bind(...args),
      ...children.map(table=>db.prepare(`DELETE FROM ${table} WHERE case_id=? AND ${ownsLease}`).bind(...args)),
      db.prepare(`DELETE FROM pct_cases WHERE id=? AND stage='wipe_pending' AND ${ownsLease} RETURNING id`).bind(...args),
    ]);
    return result.at(-1).results?.[0]?.id===id ? status('deleted') : status('pending','working');
  } catch (e) {
    return status('pending',e?.code==='wipe_storage_permission'?'storage_permission':'storage_or_database');
  } finally {
    // A terminated invocation can be retried after its bounded lease expires.
    await db.prepare(`UPDATE pct_case_wipes SET lease_token=NULL,lease_until=NULL
      WHERE case_id=? AND lease_token=?`).bind(id,lease).run().catch(()=>{});
  }
}
