CREATE TABLE blind_bag_media (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  uploaded_by_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type = 'image/jpeg'),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (uploaded_by_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT,
  UNIQUE (session_id, idempotency_key)
) STRICT;

CREATE INDEX blind_bag_media_session
ON blind_bag_media (session_id, created_at);
