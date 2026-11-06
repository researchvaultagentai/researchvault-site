CREATE TABLE pct_usdt_reference_checkouts (
  case_id TEXT NOT NULL REFERENCES pct_cases(id) ON DELETE CASCADE,
  milestone TEXT NOT NULL,
  address TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  started_at INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL,
  txid TEXT,
  issue TEXT CHECK(issue IN ('reference_mismatch','review_required')),
  PRIMARY KEY(case_id,milestone)
);

CREATE INDEX pct_usdt_reference_checkouts_due ON pct_usdt_reference_checkouts(next_check_at,case_id)
  WHERE txid IS NOT NULL AND issue IS NULL;
