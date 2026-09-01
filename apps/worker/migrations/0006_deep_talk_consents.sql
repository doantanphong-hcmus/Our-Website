CREATE TABLE deep_talk_consent_events (
  idempotency_key TEXT PRIMARY KEY CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  session_id TEXT NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('review', 'confirm')),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
