import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1.js';

const bootstrap = readFileSync(new URL('../setup/dashboard-bootstrap.sql', import.meta.url), 'utf8');
const tables = ['patent_work_bridge_state', 'patent_work_bridge_commands', 'patent_work_bridge_outbox'];
function database(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  t.after(() => db.close());
  return db;
}
function schema(db, table) {
  return {
    columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: db.prepare(`PRAGMA index_list(${table})`).all().map(index => ({
      name: index.name, unique: index.unique,
      columns: db.prepare(`PRAGMA index_info(${index.name})`).all(),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

test('dashboard bootstrap matches both migrations and enforces their constraints', t => {
  const db = database(t), migrated = sqliteD1();
  t.after(() => migrated.raw.close());
  db.exec(bootstrap);
  for (const table of tables) assert.deepEqual(schema(db, table), schema(migrated.raw, table));
  assert.throws(() => db.exec("INSERT INTO patent_work_bridge_state VALUES ('bad', -1, '{}', NULL)"), /CHECK constraint/);
  assert.throws(() => db.exec("INSERT INTO patent_work_bridge_commands VALUES ('c', 'missing', 'h', '{}', 'now')"), /FOREIGN KEY constraint/);
  db.exec("INSERT INTO patent_work_bridge_state VALUES ('case_1', 0, '{}', NULL)");
  assert.throws(() => db.exec("INSERT INTO patent_work_bridge_outbox (event_id, case_id, destination, event_name, payload_json, created_at) VALUES ('e', 'case_1', 'public', 'n', '{}', 'now')"), /CHECK constraint/);
});

test('repeating dashboard setup preserves existing data, leases and other migration receipts', t => {
  const db = database(t);
  db.exec(bootstrap);
  db.exec(`CREATE TABLE unrelated_records (id TEXT PRIMARY KEY, value TEXT);
    INSERT INTO unrelated_records VALUES ('keep', 'unchanged');
    INSERT INTO d1_migrations (name) VALUES ('0001_init.sql');
    INSERT INTO patent_work_bridge_state VALUES ('case_1', 4, '{"version":4}', 'cmd');
    INSERT INTO patent_work_bridge_outbox
      (event_id, case_id, destination, event_name, payload_json, created_at, lease_token, lease_until, attempts)
      VALUES ('event_1', 'case_1', 'telegram_admin', 'notice', '{}', 'now', 'lease_1', 100000, 2);`);
  const before = db.prepare('SELECT * FROM patent_work_bridge_outbox').all();
  const receipts = db.prepare('SELECT * FROM d1_migrations ORDER BY id').all();
  db.exec(bootstrap);
  assert.deepEqual(db.prepare('SELECT * FROM patent_work_bridge_outbox').all(), before);
  assert.deepEqual(db.prepare('SELECT * FROM d1_migrations ORDER BY id').all(), receipts);
  assert.equal(db.prepare('SELECT version FROM patent_work_bridge_state').get().version, 4);
  assert.equal(db.prepare('SELECT value FROM unrelated_records').get().value, 'unchanged');
  assert.equal(receipts.length, 3);
});

test('an incomplete existing outbox cannot receive false completed-migration receipts', t => {
  const db = database(t);
  db.exec(`CREATE TABLE patent_work_bridge_outbox (
    event_id TEXT PRIMARY KEY, case_id TEXT, destination TEXT, event_name TEXT,
    payload_json TEXT, status TEXT, created_at TEXT
  );`);
  assert.throws(() => db.exec(bootstrap), /no such column/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n, 0);
});
