CREATE TABLE pct_signature_challenges (
  challenge_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES pct_cases(id),
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER pct_case_signature_challenge AFTER UPDATE OF revision ON pct_cases
WHEN json_extract(NEW.event_json,'$.signature_challenge') IS NOT NULL BEGIN
  INSERT INTO pct_signature_challenges(challenge_id,case_id,event_type,created_at)
  VALUES(json_extract(NEW.event_json,'$.signature_challenge'),NEW.id,
    json_extract(NEW.event_json,'$.type'),NEW.updated_at);
END;
