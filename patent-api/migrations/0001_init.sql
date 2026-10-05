PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patent_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT,
  full_name TEXT,
  country TEXT,
  pricing_market TEXT CHECK (pricing_market IN ('iran','international')),
  identity_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS patent_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES patent_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_patent_sessions_hash ON patent_sessions(token_hash);

CREATE TABLE IF NOT EXISTS patent_otp_challenges (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK(channel IN ('email','telegram','sms','dev')),
  destination TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  request_ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_patent_otp_destination ON patent_otp_challenges(destination, purpose, created_at);

CREATE TABLE IF NOT EXISTS patent_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_ref TEXT NOT NULL UNIQUE,
  title TEXT,
  service_type TEXT NOT NULL CHECK(service_type IN ('domestic','pct','both')),
  pricing_market TEXT NOT NULL CHECK(pricing_market IN ('iran','international')),
  case_stage TEXT NOT NULL DEFAULT 'draft' CHECK(case_stage IN ('draft','onboarding','stage1','client_decision','stage2','filing','post_filing','completed','withdrawn','suspended')),
  selected_candidate_id TEXT,
  patentability_result TEXT CHECK(patentability_result IN ('file_now','file_after_polish','rnd_required','defensive_filing_only','no_go') OR patentability_result IS NULL),
  admin_notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES patent_users(id)
);
CREATE INDEX IF NOT EXISTS idx_patent_cases_user ON patent_cases(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_patent_cases_stage ON patent_cases(case_stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS patent_parties (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  party_type TEXT NOT NULL CHECK(party_type IN ('person','company')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  country TEXT,
  identifier_last4 TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patent_party_roles (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('client','inventor','applicant','owner','payer','authorized_contact')),
  created_at INTEGER NOT NULL,
  UNIQUE(case_id, party_id, role),
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(party_id) REFERENCES patent_parties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patent_candidates (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  code TEXT NOT NULL,
  candidate_type TEXT NOT NULL CHECK(candidate_type IN ('original_client_disclosure','developed_candidate')),
  title TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','selected','rejected','archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(case_id, code),
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patent_workstreams (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('stage1','domestic','pct','post_isr','engineering')),
  status TEXT NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(case_id, type),
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patent_deadlines (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  workstream_id TEXT,
  deadline_type TEXT NOT NULL,
  source_date INTEGER,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'calculated' CHECK(status IN ('calculated','admin_verified','completed','waived','superseded')),
  verified_by TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(workstream_id) REFERENCES patent_workstreams(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_patent_deadlines_due ON patent_deadlines(status, due_at);

CREATE TABLE IF NOT EXISTS patent_documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('identity','disclosure','nda','contract','report','filing','signature','payment_proof','other')),
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  security_status TEXT NOT NULL DEFAULT 'quarantine' CHECK(security_status IN ('quarantine','approved','blocked')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','client','admin')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(owner_user_id) REFERENCES patent_users(id)
);
CREATE INDEX IF NOT EXISTS idx_patent_documents_case ON patent_documents(case_id, category, created_at DESC);

CREATE TABLE IF NOT EXISTS patent_contract_versions (
  id TEXT PRIMARY KEY,
  contract_type TEXT NOT NULL CHECK(contract_type IN ('nda','engagement')),
  language TEXT NOT NULL CHECK(language IN ('fa','en')),
  version TEXT NOT NULL,
  canonical_sha256 TEXT NOT NULL,
  title TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(contract_type, language, version)
);

CREATE TABLE IF NOT EXISTS patent_signatures (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  signer_user_id TEXT NOT NULL,
  contract_type TEXT NOT NULL CHECK(contract_type IN ('nda','engagement')),
  contract_version TEXT NOT NULL,
  document_sha256 TEXT NOT NULL,
  signature_object_key TEXT,
  signature_sha256 TEXT,
  typed_name TEXT NOT NULL,
  otp_challenge_id TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  signed_at INTEGER NOT NULL,
  evidence_hmac TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(signer_user_id) REFERENCES patent_users(id),
  FOREIGN KEY(otp_challenge_id) REFERENCES patent_otp_challenges(id)
);
CREATE INDEX IF NOT EXISTS idx_patent_signatures_case ON patent_signatures(case_id, signed_at DESC);

CREATE TABLE IF NOT EXISTS patent_invoices (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  milestone TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
  is_refundable INTEGER NOT NULL DEFAULT 1 CHECK(is_refundable IN (0,1)),
  currency TEXT NOT NULL CHECK(currency IN ('IRT','USD')),
  provider TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','pending','partially_paid','paid','failed','expired','waived','refunded')),
  due_at INTEGER,
  success_condition TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_patent_invoices_case ON patent_invoices(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS patent_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_reference TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','refunded')),
  proof_document_id TEXT,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(invoice_id) REFERENCES patent_invoices(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(proof_document_id) REFERENCES patent_documents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS patent_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('client','admin','system')),
  actor_id TEXT,
  event_type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  meta_json TEXT,
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_patent_events_case ON patent_events(case_id, created_at ASC);

CREATE TABLE IF NOT EXISTS patent_notifications (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  user_id TEXT,
  channel TEXT NOT NULL CHECK(channel IN ('email','telegram','sms','system')),
  template_key TEXT NOT NULL,
  destination TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','sent','failed','skipped')),
  provider_reference TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES patent_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patent_meetings (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 45,
  channel TEXT NOT NULL DEFAULT 'online',
  join_url TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','no_show')),
  notes TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_patent_meetings_case ON patent_meetings(case_id, scheduled_at);

CREATE TABLE IF NOT EXISTS patent_messages (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  sender_user_id TEXT,
  sender_role TEXT NOT NULL CHECK(sender_role IN ('client','admin','system')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(case_id) REFERENCES patent_cases(id) ON DELETE CASCADE,
  FOREIGN KEY(sender_user_id) REFERENCES patent_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_patent_messages_case ON patent_messages(case_id, created_at);
