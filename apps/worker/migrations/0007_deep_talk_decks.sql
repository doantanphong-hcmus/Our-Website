CREATE TABLE activity_session_events_v2 (
  idempotency_key TEXT PRIMARY KEY CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  session_id TEXT NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'join', 'decline', 'cancel', 'complete', 'generate_deck')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (actor_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT
) STRICT;

INSERT INTO activity_session_events_v2 SELECT * FROM activity_session_events;
DROP TABLE activity_session_events;
ALTER TABLE activity_session_events_v2 RENAME TO activity_session_events;
CREATE INDEX activity_session_events_history ON activity_session_events (session_id, version);

CREATE TABLE deep_talk_decks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES activity_sessions(id) ON DELETE CASCADE,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  seed INTEGER NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  generation_day TEXT NOT NULL CHECK (length(generation_day) = 10),
  cards_json TEXT NOT NULL CHECK (json_valid(cards_json) AND json_type(cards_json) = 'array' AND json_array_length(cards_json) = 20),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (created_by_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX deep_talk_decks_recent ON deep_talk_decks (couple_space_id, created_at DESC);
CREATE INDEX deep_talk_decks_daily_quota ON deep_talk_decks (couple_space_id, generation_day);

CREATE TABLE question_fingerprints (
  deck_id TEXT NOT NULL REFERENCES deep_talk_decks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 180),
  PRIMARY KEY (deck_id, position),
  UNIQUE (deck_id, fingerprint)
) STRICT;
