import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperStore, sourcePriority } from '../store.js';
import { VERIFIER_VERSION } from '../common.js';
import { metadata, sqliteD1 } from './fixtures.js';

test('concurrent requests share one DOI lease, and an expired lease can recover', async t => {
  const db = sqliteD1(); t.after(() => db.raw.close()); let now = 100000;
  const store = new PaperStore(db, () => now);
  const results = await Promise.all([store.claim(metadata.doi, 'a'), store.claim(metadata.doi, 'b')]);
  assert.equal(results.filter(Boolean).length, 1);
  now += 26000; assert.ok(await store.claim(metadata.doi, 'c'));
  await store.finish(metadata.doi, 'a', 'wrong');
  assert.equal(db.raw.prepare('SELECT lease_id FROM rv_paper_jobs').get().lease_id, 'c');
  assert.equal(db.raw.prepare('SELECT attempts FROM rv_paper_jobs').get().attempts, 2);
});

test('failed jobs respect retry cooldown and can later be claimed again', async t => {
  const db = sqliteD1(); t.after(() => db.raw.close()); let now = 100000;
  const store = new PaperStore(db, () => now);
  assert.ok(await store.claim(metadata.doi, 'a')); await store.finish(metadata.doi, 'a', 'not_found', 60000);
  assert.equal(await store.claim(metadata.doi, 'b'), false);
  now += 60001; assert.ok(await store.claim(metadata.doi, 'b'));
});

test('only proof bound to the requested DOI and verifier version enters the short-lived cache', async t => {
  const db = sqliteD1(); t.after(() => db.raw.close()); let now = 100000;
  const store = new PaperStore(db, () => now);
  const proof = { verdict: 'verified', doi: metadata.doi, verifier: VERIFIER_VERSION, sha256: 'a'.repeat(64) };
  await assert.rejects(store.cache(metadata.doi, metadata, {}, { ...proof, verdict: 'uncertain' }));
  await assert.rejects(store.cache(metadata.doi, metadata, {}, { ...proof, doi: '10.1234/other' }));
  await store.cache(metadata.doi, metadata, { url: 'https://papers.example.edu/a.pdf' }, proof);
  assert.equal((await store.cached(metadata.doi)).proof.sha256, proof.sha256);
  now += 900001; assert.equal(await store.cached(metadata.doi), null);
});

test('source ranking reacts to real outcomes, cooldown and stale measurements', async t => {
  const db = sqliteD1(); t.after(() => db.raw.close()); const now = 100000;
  const store = new PaperStore(db, () => now);
  for (let i = 0; i < 4; i++) await store.record('oa', 'publishers-a', { success: true, latencyMs: 500 });
  const row = (await store.health('publishers-a')).get('oa');
  assert.ok(sourcePriority(90, row, now) > 90);
  await store.record('oa', 'publishers-a', { retryAfterMs: 120000 });
  assert.equal(sourcePriority(90, (await store.health('publishers-a')).get('oa'), now), -Infinity);
  assert.equal(sourcePriority(90, { ...row, updated_at: now - 86400001 }, now), 90);
});

test('the pipeline migration preserves every unrelated table and record', t => {
  const db = sqliteD1(); t.after(() => db.raw.close());
  db.raw.exec("CREATE TABLE existing_admin_tasks(id INTEGER,value TEXT); INSERT INTO existing_admin_tasks VALUES(1,'keep');");
  const tables = db.raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'rv_paper_%'").all();
  assert.equal(tables.length, 4);
  assert.equal(db.raw.prepare('SELECT value FROM existing_admin_tasks').get().value, 'keep');
});
