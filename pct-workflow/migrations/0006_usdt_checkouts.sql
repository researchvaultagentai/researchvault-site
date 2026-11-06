-- Retain only the public receiving address after case erasure. Reassigning
-- that address could credit a late transfer to somebody else's invoice.
CREATE TABLE pct_usdt_used_addresses (
  address TEXT PRIMARY KEY
);

CREATE TABLE pct_usdt_checkouts (
  case_id TEXT NOT NULL REFERENCES pct_cases(id) ON DELETE CASCADE,
  milestone TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  started_at INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL,
  review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0,1)),
  PRIMARY KEY(case_id, milestone)
);
CREATE INDEX pct_usdt_checkouts_due ON pct_usdt_checkouts(next_check_at, case_id);

CREATE TRIGGER pct_usdt_use_address AFTER INSERT ON pct_usdt_checkouts BEGIN
  INSERT INTO pct_usdt_used_addresses(address) VALUES(NEW.address);
END;
