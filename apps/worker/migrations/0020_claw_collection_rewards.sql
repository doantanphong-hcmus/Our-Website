CREATE TABLE plush_collection (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES claw_attempts(id) ON DELETE RESTRICT,
  plush_id TEXT NOT NULL CHECK (length(trim(plush_id)) BETWEEN 1 AND 80),
  label_snapshot TEXT NOT NULL CHECK (length(trim(label_snapshot)) BETWEEN 1 AND 200),
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (owner_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX plush_collection_owner
ON plush_collection (couple_space_id, owner_user_id, captured_at DESC, id DESC);

CREATE TABLE claw_rewards (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES couple_spaces(id) ON DELETE RESTRICT,
  beneficiary_user_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES claw_attempts(id) ON DELETE RESTRICT,
  plush_instance_id TEXT NOT NULL UNIQUE REFERENCES plush_collection(id) ON DELETE RESTRICT,
  reward_table_version INTEGER NOT NULL CHECK (reward_table_version >= 1),
  tier_id TEXT NOT NULL CHECK (length(trim(tier_id)) BETWEEN 1 AND 80),
  tier_label_snapshot TEXT NOT NULL CHECK (length(trim(tier_label_snapshot)) BETWEEN 1 AND 200),
  roll_basis_points INTEGER NOT NULL CHECK (roll_basis_points BETWEEN 0 AND 9999),
  stars_awarded INTEGER NOT NULL CHECK (stars_awarded BETWEEN 1 AND 100),
  star_transaction_id TEXT NOT NULL UNIQUE REFERENCES star_transactions(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (beneficiary_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX claw_rewards_history
ON claw_rewards (couple_space_id, created_at DESC, id DESC);

CREATE TRIGGER plush_collection_no_update
BEFORE UPDATE ON plush_collection
BEGIN
  SELECT raise(ABORT, 'plush collection is immutable');
END;

CREATE TRIGGER plush_collection_no_delete
BEFORE DELETE ON plush_collection
BEGIN
  SELECT raise(ABORT, 'plush collection is immutable');
END;

CREATE TRIGGER claw_rewards_no_update
BEFORE UPDATE ON claw_rewards
BEGIN
  SELECT raise(ABORT, 'claw rewards are immutable');
END;

CREATE TRIGGER claw_rewards_no_delete
BEFORE DELETE ON claw_rewards
BEGIN
  SELECT raise(ABORT, 'claw rewards are immutable');
END;
