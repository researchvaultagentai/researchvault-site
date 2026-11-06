ALTER TABLE pct_cases ADD COLUMN upload_token TEXT;
ALTER TABLE pct_cases ADD COLUMN upload_until INTEGER;

CREATE TABLE pct_case_wipes (
  case_id TEXT PRIMARY KEY REFERENCES pct_cases(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  revision INTEGER NOT NULL,
  confirmation_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER
);

CREATE INDEX pct_admin_links_case ON pct_admin_links(case_id);
CREATE INDEX pct_verified_payment_refs_case ON pct_verified_payment_refs(case_id);
CREATE INDEX pct_signature_challenges_case ON pct_signature_challenges(case_id);

-- Do not let a receipt from an erased case pay for a different case. This
-- digest has no case, account, payment amount, or transaction identifier.
CREATE TABLE pct_spent_payment_digests (evidence_key TEXT PRIMARY KEY);
CREATE TRIGGER pct_reject_spent_payment BEFORE INSERT ON pct_verified_payment_refs
WHEN EXISTS(SELECT 1 FROM pct_spent_payment_digests WHERE evidence_key=NEW.evidence_key)
BEGIN
  SELECT RAISE(ABORT, 'pct_payment_already_consumed');
END;
