ALTER TABLE pct_cases ADD COLUMN team_updates_indexed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pct_cases ADD COLUMN client_seen_revision INTEGER NOT NULL DEFAULT -1;
UPDATE pct_cases SET client_seen_revision=revision;
CREATE INDEX pct_cases_team_updates_backfill ON pct_cases(id)
  WHERE team_updates_indexed=0 AND stage<>'wipe_pending';

CREATE TABLE pct_team_updates (
  case_id TEXT NOT NULL REFERENCES pct_cases(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  notified_at INTEGER,
  PRIMARY KEY(case_id, request_key)
);
CREATE INDEX pct_team_updates_due ON pct_team_updates(due_at, case_id, request_key)
  WHERE notified_at IS NULL;
CREATE UNIQUE INDEX pct_team_updates_lease ON pct_team_updates(lease_token)
  WHERE lease_token IS NOT NULL;

-- Publish the indexed projection atomically with its source case. Existing
-- rows keep their delivery acknowledgement until that specific task closes.
CREATE TRIGGER pct_team_updates_refresh AFTER UPDATE OF state_json ON pct_cases
WHEN NEW.team_updates_indexed=1 BEGIN
  DELETE FROM pct_team_updates WHERE case_id=NEW.id AND request_key NOT IN
    (SELECT json_extract(value,'$.key') FROM json_each(NEW.state_json,'$.team_updates'));
  INSERT OR IGNORE INTO pct_team_updates(case_id,request_key,kind,due_at)
    SELECT NEW.id,json_extract(value,'$.key'),json_extract(value,'$.kind'),json_extract(value,'$.due_at')
    FROM json_each(NEW.state_json,'$.team_updates');
END;
