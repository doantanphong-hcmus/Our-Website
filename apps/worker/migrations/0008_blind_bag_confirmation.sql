CREATE TABLE activity_session_events_v3 (
  idempotency_key TEXT PRIMARY KEY CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  session_id TEXT NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'join', 'decline', 'cancel', 'complete', 'generate_deck', 'confirm', 'revise')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (actor_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT
) STRICT;

INSERT INTO activity_session_events_v3
  (idempotency_key, session_id, couple_space_id, actor_user_id, action, from_status, to_status, version, created_at)
SELECT idempotency_key, session_id, couple_space_id, actor_user_id, action, from_status, to_status, version, created_at
FROM activity_session_events;
DROP TABLE activity_session_events;
ALTER TABLE activity_session_events_v3 RENAME TO activity_session_events;
CREATE INDEX activity_session_events_history ON activity_session_events (session_id, version);
