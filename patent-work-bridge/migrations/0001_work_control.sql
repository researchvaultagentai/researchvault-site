-- Preparation only. This is intentionally outside patent-api/migrations.
-- Apply only to a separate test D1 database until the live adapters are reviewed.
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS patent_work_bridge_outbox_pending
  ON patent_work_bridge_outbox(status, created_at);
