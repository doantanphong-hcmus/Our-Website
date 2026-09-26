CREATE TABLE places (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_place_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  cover_media_id TEXT REFERENCES blind_bag_media(id) ON DELETE SET NULL,
  visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
  latest_visit_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (couple_space_id, provider, provider_place_id)
) STRICT;

CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  visited_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('blind_bag', 'manual')),
  added_by_user_id TEXT NOT NULL,
  check_in_method TEXT NOT NULL CHECK (check_in_method IN ('gps', 'manual')),
  challenge_id TEXT,
  challenge_text TEXT,
  challenge_outcome TEXT NOT NULL CHECK (challenge_outcome IN ('completed', 'skipped')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (added_by_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX visits_place_history ON visits (place_id, visited_at DESC);

CREATE TABLE visit_photos (
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL UNIQUE REFERENCES blind_bag_media(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (visit_id, media_id)
) STRICT;

CREATE TABLE stamps (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE CASCADE,
  visit_id TEXT NOT NULL UNIQUE REFERENCES visits(id) ON DELETE RESTRICT,
  session_id TEXT NOT NULL UNIQUE REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  place_type TEXT NOT NULL,
  place_name TEXT NOT NULL,
  stamped_at INTEGER NOT NULL,
  bag_color TEXT NOT NULL,
  photo_media_id TEXT NOT NULL REFERENCES blind_bag_media(id) ON DELETE RESTRICT,
  challenge_id TEXT,
  challenge_text TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (couple_space_id, sequence_number)
) STRICT;

CREATE INDEX places_map ON places (couple_space_id, latest_visit_at DESC);
