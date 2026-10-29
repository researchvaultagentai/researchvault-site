-- Additive, article-pipeline-only state. No existing table, row or admin workflow changes.
CREATE TABLE IF NOT EXISTS rv_paper_cache (
  doi TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  proof_json TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rv_paper_jobs (
  doi TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  last_status TEXT NOT NULL,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rv_paper_metadata (
  doi TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rv_paper_source_stats (
  source TEXT NOT NULL,
  family TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  latency_ms REAL NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  last_http INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(source,family)
);
