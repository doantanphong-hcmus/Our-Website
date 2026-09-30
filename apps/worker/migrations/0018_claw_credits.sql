CREATE TABLE claw_credit_wallets (
  couple_space_id TEXT PRIMARY KEY REFERENCES couple_spaces(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (owner_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE claw_credit_purchases (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES claw_credit_wallets(couple_space_id) ON DELETE RESTRICT,
  buyer_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  star_transaction_id TEXT NOT NULL UNIQUE REFERENCES star_transactions(id) ON DELETE RESTRICT,
  stars_spent INTEGER NOT NULL CHECK (stars_spent = 20),
  credits_added INTEGER NOT NULL CHECK (credits_added = 5),
  label_snapshot TEXT NOT NULL CHECK (length(trim(label_snapshot)) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (buyer_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT,
  UNIQUE (couple_space_id, idempotency_key)
) STRICT;

CREATE INDEX claw_credit_purchases_history
ON claw_credit_purchases (couple_space_id, created_at DESC, id DESC);

CREATE TRIGGER claw_credit_purchase_buyer
BEFORE INSERT ON claw_credit_purchases
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.buyer_user_id
      AND couple_space_id = NEW.couple_space_id AND role = 'girlfriend'
  ) THEN raise(ABORT, 'only girlfriend can buy claw credits') END;
END;

CREATE TRIGGER claw_credit_purchase_daily_limit
BEFORE INSERT ON claw_credit_purchases
BEGIN
  SELECT CASE WHEN (
    SELECT count(*) FROM claw_credit_purchases
    WHERE couple_space_id = NEW.couple_space_id
      AND date(created_at, 'unixepoch', '+7 hours') = date(NEW.created_at, 'unixepoch', '+7 hours')
  ) >= 3 THEN raise(ABORT, 'daily claw pack limit reached') END;
END;

CREATE TRIGGER claw_credit_purchases_no_update
BEFORE UPDATE ON claw_credit_purchases
BEGIN
  SELECT raise(ABORT, 'claw credit purchases are immutable');
END;

CREATE TRIGGER claw_credit_purchases_no_delete
BEFORE DELETE ON claw_credit_purchases
BEGIN
  SELECT raise(ABORT, 'claw credit purchases are immutable');
END;

INSERT INTO claw_credit_wallets (couple_space_id, owner_user_id)
SELECT couple_space_id, id FROM users WHERE role = 'girlfriend'
ON CONFLICT (couple_space_id) DO NOTHING;
