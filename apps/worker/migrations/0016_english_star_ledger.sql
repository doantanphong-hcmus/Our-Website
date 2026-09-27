CREATE TABLE star_wallets (
  couple_space_id TEXT PRIMARY KEY REFERENCES couple_spaces(id) ON DELETE CASCADE,
  beneficiary_user_id TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (beneficiary_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT,
  UNIQUE (couple_space_id, beneficiary_user_id)
) STRICT;

CREATE TABLE star_transactions (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES star_wallets(couple_space_id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  kind TEXT NOT NULL CHECK (kind IN ('award', 'redeem', 'adjustment')),
  delta INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -100000 AND 100000),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  rule_id TEXT NOT NULL CHECK (length(trim(rule_id)) BETWEEN 1 AND 80),
  label_snapshot TEXT NOT NULL CHECK (length(trim(label_snapshot)) BETWEEN 1 AND 200),
  note TEXT CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (kind = 'adjustment' OR (kind = 'award' AND delta > 0) OR (kind = 'redeem' AND delta < 0)),
  FOREIGN KEY (actor_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT,
  UNIQUE (couple_space_id, idempotency_key)
) STRICT;

CREATE INDEX star_transactions_history
ON star_transactions (couple_space_id, created_at DESC, id DESC);

CREATE TRIGGER star_transactions_balance_snapshot
BEFORE INSERT ON star_transactions
WHEN NEW.balance_after <> (SELECT balance FROM star_wallets WHERE couple_space_id = NEW.couple_space_id)
BEGIN
  SELECT raise(ABORT, 'star transaction balance does not match wallet');
END;

CREATE TRIGGER star_transactions_no_update
BEFORE UPDATE ON star_transactions
BEGIN
  SELECT raise(ABORT, 'star transactions are immutable');
END;

CREATE TRIGGER star_transactions_no_delete
BEFORE DELETE ON star_transactions
BEGIN
  SELECT raise(ABORT, 'star transactions are immutable');
END;

INSERT INTO star_wallets (couple_space_id, beneficiary_user_id)
SELECT couple_space_id, id FROM users WHERE role = 'girlfriend'
ON CONFLICT (couple_space_id) DO NOTHING;
