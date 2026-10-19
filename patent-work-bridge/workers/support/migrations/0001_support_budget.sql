-- Counters only: no chat messages, invention files, customer identity or raw IP.
CREATE TABLE IF NOT EXISTS researchvault_support_budget (
  utc_day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  reserved_neurons INTEGER NOT NULL DEFAULT 0
);
