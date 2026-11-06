CREATE TABLE pct_undertaking_receipts (
  user_id TEXT NOT NULL,
  document_version TEXT NOT NULL,
  document_sha256 TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, document_version, document_sha256)
);

CREATE TABLE pct_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_ref TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  completion_due INTEGER NOT NULL DEFAULT 0 CHECK(completion_due IN (0,1)),
  event_json TEXT NOT NULL CHECK(json_valid(event_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX pct_cases_owner ON pct_cases(user_id, updated_at DESC);
CREATE INDEX pct_cases_debt ON pct_cases(user_id) WHERE completion_due = 1;
CREATE INDEX pct_cases_admin ON pct_cases(updated_at DESC, id DESC);

CREATE TABLE pct_events (
  id INTEGER PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES pct_cases(id),
  revision INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  notify INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  notified_at INTEGER,
  UNIQUE(case_id, revision)
);
CREATE INDEX pct_events_delivery ON pct_events(id) WHERE notify = 1 AND notified_at IS NULL;

CREATE TRIGGER pct_case_created AFTER INSERT ON pct_cases BEGIN
  INSERT INTO pct_events(case_id, revision, event_type, actor_id, created_at, detail_json, notify)
  VALUES(NEW.id, NEW.revision, json_extract(NEW.event_json,'$.type'), json_extract(NEW.event_json,'$.actor'),
    NEW.updated_at, NEW.event_json, coalesce(json_extract(NEW.event_json,'$.notify'),0));
END;

CREATE TRIGGER pct_case_changed AFTER UPDATE OF revision ON pct_cases
WHEN NEW.revision = OLD.revision + 1 BEGIN
  INSERT INTO pct_events(case_id, revision, event_type, actor_id, created_at, detail_json, notify)
  VALUES(NEW.id, NEW.revision, json_extract(NEW.event_json,'$.type'), json_extract(NEW.event_json,'$.actor'),
    NEW.updated_at, NEW.event_json, coalesce(json_extract(NEW.event_json,'$.notify'),0));
END;

CREATE TABLE pct_admin_links (
  token_hash TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES pct_cases(id),
  telegram_actor TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_by TEXT,
  redeemed_at INTEGER
);
CREATE INDEX pct_admin_links_expiry ON pct_admin_links(expires_at);

CREATE TABLE pct_verified_payment_refs (
  evidence_key TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES pct_cases(id),
  milestone TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER pct_case_payment_reference AFTER UPDATE OF revision ON pct_cases
WHEN json_extract(NEW.event_json,'$.payment_evidence_key') IS NOT NULL BEGIN
  INSERT INTO pct_verified_payment_refs(evidence_key,case_id,milestone,created_at)
  VALUES(json_extract(NEW.event_json,'$.payment_evidence_key'),NEW.id,
    json_extract(NEW.event_json,'$.milestone'),NEW.updated_at);
END;
