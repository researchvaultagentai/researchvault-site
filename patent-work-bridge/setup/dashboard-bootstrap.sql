-- Fresh setup only: the three bridge tables must be absent before first use.
-- Use only the dedicated patent database with processing/delivery disabled.
-- Equivalent to migrations 0001 and 0002; not an upgrade script.
CREATE TABLE IF NOT EXISTS patent_work_bridge_state (
  case_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 0),
  state_json TEXT NOT NULL,
  last_command_id TEXT
);
CREATE TABLE IF NOT EXISTS patent_work_bridge_commands (
  command_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES patent_work_bridge_state(case_id),
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patent_work_bridge_outbox (
  event_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES patent_work_bridge_state(case_id),
  destination TEXT NOT NULL CHECK (destination IN ('work', 'telegram_admin')),
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'dropped')),
  created_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS patent_work_bridge_outbox_pending
  ON patent_work_bridge_outbox(status, created_at);

-- Wrangler-compatible receipts prevent a later CLI run replaying the ALTERs.
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
-- Empty reads require every expected column to resolve before recording either
-- receipt. An incomplete pre-existing schema fails this statement, not silently
-- claiming that its migrations were applied. Existing receipts stay unchanged.
INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0001_work_control.sql'
WHERE NOT EXISTS (
  SELECT case_id, version, state_json, last_command_id
  FROM patent_work_bridge_state WHERE 0
) AND NOT EXISTS (
  SELECT command_id, case_id, request_hash, result_json, created_at
  FROM patent_work_bridge_commands WHERE 0
) AND NOT EXISTS (
  SELECT event_id, case_id, destination, event_name, payload_json, status, created_at
  FROM patent_work_bridge_outbox WHERE 0
)
UNION ALL
SELECT '0002_outbox_leases.sql'
WHERE NOT EXISTS (
  SELECT lease_token, lease_until, next_attempt_at, attempts, last_error
  FROM patent_work_bridge_outbox WHERE 0
);

SELECT COUNT(*) AS bridge_tables,
  (SELECT COUNT(*) FROM d1_migrations WHERE name IN (
    '0001_work_control.sql', '0002_outbox_leases.sql'
  )) AS bridge_migrations
FROM sqlite_schema
WHERE type = 'table' AND name IN (
  'patent_work_bridge_state',
  'patent_work_bridge_commands',
  'patent_work_bridge_outbox'
);
