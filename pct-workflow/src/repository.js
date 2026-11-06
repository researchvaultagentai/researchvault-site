import { nowSec, randomToken, sha256Hex, uid } from '../../patent-api/src/security.js';
import { ensure, outstandingCompletion } from './state.js';

const parsed = row => row && { ...row, state: JSON.parse(row.state_json) };

export const undertakingReceipt = (db, user, doc) => db.prepare(
  'SELECT accepted_at FROM pct_undertaking_receipts WHERE user_id=? AND document_version=? AND document_sha256=?',
).bind(user, doc.version, doc.sha256).first();

export async function acknowledge(db, user, doc) {
  await db.prepare('INSERT OR IGNORE INTO pct_undertaking_receipts VALUES(?,?,?,?)')
    .bind(user, doc.version, doc.sha256, nowSec()).run();
}

export async function caseById(db, id, owner = null) {
  const row = owner
    ? await db.prepare('SELECT * FROM pct_cases WHERE id=? AND user_id=?').bind(id, owner).first()
    : await db.prepare('SELECT * FROM pct_cases WHERE id=?').bind(id).first();
  ensure(row, 'Case not found.', 404, 'not_found');
  return parsed(row);
}

export const caseList = async (db, owner) => (await db.prepare(
  'SELECT * FROM pct_cases WHERE user_id=? ORDER BY updated_at DESC LIMIT 100',
).bind(owner).all()).results.map(parsed);

export const debt = (db, owner) => db.prepare(
  'SELECT id,public_ref FROM pct_cases WHERE user_id=? AND completion_due=1 LIMIT 1',
).bind(owner).first();

export async function createCase(db, user, state, requestId) {
  const t = nowSec();
  // An authenticated retry uses the same key. The debt gate is checked in the
  // INSERT itself, so a concurrently activated balance cannot slip through.
  const id = 'pct_' + (await sha256Hex(user + ':' + requestId)).slice(0, 24);
  const ref = 'PCT-' + new Date().getUTCFullYear() + '-' + id.slice(-10).toUpperCase();
  const res = await db.prepare(`INSERT OR IGNORE INTO pct_cases
    (id,user_id,public_ref,stage,state_json,event_json,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS
      (SELECT 1 FROM pct_cases WHERE user_id=? AND completion_due=1)`)
    .bind(id, user, ref, state.stage, JSON.stringify(state), JSON.stringify({ type: 'case_created', actor: user }), t, t, user).run();
  if (!res.meta.changes) {
    const same = await db.prepare('SELECT * FROM pct_cases WHERE id=? AND user_id=?').bind(id, user).first();
    if (same) return parsed(same);
    ensure(false, 'Settle the outstanding completion invoice before opening a new case.', 409, 'outstanding_balance');
  }
  return caseById(db, id, user);
}

export async function save(db, row, actor, type, detail = {}, notify = false) {
  const t = nowSec();
  const ev = { type, actor, notify: notify ? 1 : 0, ...detail };
  const res = await db.prepare(`UPDATE pct_cases SET stage=?,state_json=?,revision=revision+1,
    completion_due=?,event_json=?,updated_at=? WHERE id=? AND revision=? RETURNING revision`)
    .bind(row.state.stage, JSON.stringify(row.state), outstandingCompletion(row.state) ? 1 : 0,
      JSON.stringify(ev), t, row.id, row.revision).first();
  ensure(res?.revision === row.revision + 1, 'The case changed. Refresh it and try again.', 409, 'case_changed');
  return { ...row, stage: row.state.stage, updated_at: t, revision: row.revision + 1 };
}

export const timeline = async (db, id) => (await db.prepare(`SELECT event_type,created_at
  FROM pct_events WHERE case_id=? ORDER BY revision DESC LIMIT 60`).bind(id).all()).results;

export async function adminList(db, offset) {
  const rows = await db.prepare(`SELECT id,public_ref,stage,revision FROM pct_cases
    ORDER BY updated_at DESC, id DESC LIMIT 11 OFFSET ?`).bind(offset).all();
  return { cases: rows.results.slice(0, 10), more: rows.results.length > 10 };
}

export async function newAdminLink(db, caseId, actor, origin) {
  await caseById(db, caseId);
  const token = randomToken(24), t = nowSec();
  await db.batch([
    db.prepare('DELETE FROM pct_admin_links WHERE expires_at<?').bind(t),
    db.prepare('INSERT INTO pct_admin_links(token_hash,case_id,telegram_actor,expires_at) VALUES(?,?,?,?)')
      .bind(await sha256Hex(token), caseId, actor, t + 600),
  ]);
  return `${origin}/patent/en/case-admin/#${token}`;
}

export async function redeemAdminLink(db, token, user) {
  const t = nowSec(), hash = await sha256Hex(token);
  const row = await db.prepare(`UPDATE pct_admin_links SET redeemed_by=?,redeemed_at=?
    WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>=? RETURNING case_id`)
    .bind(user, t, hash, t).first();
  ensure(row, 'This link is invalid, expired or already used. Request a new link in Telegram.', 403, 'invalid_admin_link');
  return row.case_id;
}

export async function claimNotification(db) {
  const t = nowSec(), lease = uid('lease');
  const row = await db.prepare(`UPDATE pct_events SET lease_token=?,lease_until=?
    WHERE id=(SELECT id FROM pct_events WHERE notify=1 AND notified_at IS NULL
      AND (lease_until IS NULL OR lease_until<?) ORDER BY id LIMIT 1)
    RETURNING id,case_id,event_type,detail_json`).bind(lease, t + 90, t).first();
  if (!row) return null;
  const c = await db.prepare('SELECT public_ref FROM pct_cases WHERE id=?').bind(row.case_id).first();
  const detail = JSON.parse(row.detail_json);
  return { id: row.id, case_id: row.case_id, public_ref: c.public_ref, type: row.event_type,
    milestone: detail.milestone, amount_cents: detail.amount_cents, version: detail.version, lease };
}

export async function acknowledgeNotification(db, id, lease) {
  const res = await db.prepare(`UPDATE pct_events SET notified_at=?,lease_token=NULL,lease_until=NULL
    WHERE id=? AND lease_token=? AND notified_at IS NULL`).bind(nowSec(), id, lease).run();
  return res.meta.changes === 1;
}

export async function requireAdminGrant(db, token, user, caseId) {
  ensure(/^[a-f0-9]{48}$/.test(token || ''), 'Open this case from its private Telegram link.', 403, 'invalid_admin_link');
  const row = await db.prepare(`SELECT 1 FROM pct_admin_links
    WHERE token_hash=? AND case_id=? AND redeemed_by=? AND expires_at>=?`)
    .bind(await sha256Hex(token), caseId, user, nowSec()).first();
  ensure(row, 'This admin link has expired or belongs to another case.', 403, 'invalid_admin_link');
}

export async function caseLog(db,id,offset){
  const c=await caseById(db,id);
  const rows=(await db.prepare(`SELECT revision,event_type,created_at,detail_json FROM pct_events
    WHERE case_id=? ORDER BY revision LIMIT 9 OFFSET ?`).bind(id,offset).all()).results;
  return {public_ref:c.public_ref, stage:c.stage, more:rows.length>8, entries:rows.slice(0,8).map(x=>{
    const detail=JSON.parse(x.detail_json);
    return {number:x.revision+1,type:x.event_type,at:x.created_at,version:detail.version,
      milestone:detail.milestone,amount_cents:detail.amount_cents};
  })};
}
