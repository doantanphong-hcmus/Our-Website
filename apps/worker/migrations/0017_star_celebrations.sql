CREATE TABLE star_celebrations (
  transaction_id TEXT PRIMARY KEY REFERENCES star_transactions(id) ON DELETE RESTRICT,
  couple_space_id TEXT NOT NULL REFERENCES star_wallets(couple_space_id) ON DELETE RESTRICT,
  beneficiary_user_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (beneficiary_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX star_celebrations_by_beneficiary
ON star_celebrations (couple_space_id, beneficiary_user_id, claimed_at DESC);
