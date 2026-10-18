-- Patent-only delivery leases; never touches article-bot tables.
ALTER TABLE patent_work_bridge_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE patent_work_bridge_outbox ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE patent_work_bridge_outbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE patent_work_bridge_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE patent_work_bridge_outbox ADD COLUMN last_error TEXT;
