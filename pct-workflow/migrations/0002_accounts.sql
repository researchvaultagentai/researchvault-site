CREATE TABLE pct_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  google_subject TEXT UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE pct_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES pct_accounts(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX pct_sessions_expiry ON pct_sessions(expires_at);

CREATE TABLE pct_auth_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX pct_auth_attempts_expiry ON pct_auth_attempts(expires_at);

CREATE TABLE pct_oauth_attempts (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX pct_oauth_attempts_expiry ON pct_oauth_attempts(expires_at);
