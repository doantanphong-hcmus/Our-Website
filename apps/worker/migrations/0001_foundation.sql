CREATE TABLE couple_spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE TRIGGER couple_spaces_allow_one
BEFORE INSERT ON couple_spaces
WHEN (SELECT count(*) FROM couple_spaces) >= 1
  AND NOT EXISTS (SELECT 1 FROM couple_spaces WHERE id = NEW.id)
BEGIN
  SELECT raise(ABORT, 'only one couple space is allowed');
END;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(username)) BETWEEN 3 AND 64),
  password_hash TEXT NOT NULL CHECK (length(password_hash) >= 16),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  nickname TEXT CHECK (nickname IS NULL OR length(trim(nickname)) BETWEEN 1 AND 80),
  avatar_key TEXT,
  color TEXT NOT NULL CHECK (
    length(color) = 7
    AND substr(color, 1, 1) = '#'
    AND substr(color, 2) NOT GLOB '*[^0-9A-Fa-f]*'
  ),
  role TEXT NOT NULL CHECK (role IN ('boyfriend', 'girlfriend')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (couple_space_id, role),
  UNIQUE (id, couple_space_id)
) STRICT;

CREATE TRIGGER users_allow_two
BEFORE INSERT ON users
WHEN (SELECT count(*) FROM users) >= 2
  AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.id)
BEGIN
  SELECT raise(ABORT, 'only two users are allowed');
END;

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  reduced_motion INTEGER NOT NULL DEFAULT 0 CHECK (reduced_motion IN (0, 1)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE TABLE activity_sessions (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature IN ('blind_bag', 'food_vote', 'deep_talk')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined', 'completed', 'expired', 'cancelled')),
  created_by_user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  expires_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (created_by_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT,
  UNIQUE (couple_space_id, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX activity_sessions_one_open_per_feature
ON activity_sessions (couple_space_id, feature)
WHERE status IN ('pending', 'active');

CREATE INDEX activity_sessions_recent
ON activity_sessions (couple_space_id, updated_at DESC);
