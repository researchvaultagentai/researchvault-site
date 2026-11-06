CREATE TABLE pct_admin_publications (
  case_id TEXT NOT NULL REFERENCES pct_cases(id) ON DELETE CASCADE,
  telegram_actor TEXT NOT NULL,
  revision INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  action_json TEXT NOT NULL CHECK(json_valid(action_json)),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(case_id, telegram_actor)
);

CREATE TRIGGER pct_admin_publication_invalidated AFTER UPDATE OF revision ON pct_cases
WHEN NEW.revision<>OLD.revision BEGIN
  DELETE FROM pct_admin_publications WHERE case_id=NEW.id AND revision<>NEW.revision;
END;
