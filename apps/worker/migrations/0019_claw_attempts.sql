CREATE TABLE claw_attempts (
  id TEXT PRIMARY KEY,
  couple_space_id TEXT NOT NULL REFERENCES claw_credit_wallets(couple_space_id) ON DELETE RESTRICT,
  player_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  seed INTEGER NOT NULL CHECK (seed BETWEEN 1 AND 2147483647),
  rules_version INTEGER NOT NULL CHECK (rules_version >= 1),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'playing', 'won', 'missed', 'abandoned')),
  control_trace_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(control_trace_json)),
  captured_plush_id TEXT,
  result_steps INTEGER CHECK (result_steps IS NULL OR result_steps BETWEEN 1 AND 7200),
  result_verified INTEGER NOT NULL DEFAULT 0 CHECK (result_verified IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  completed_at INTEGER,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (player_user_id, couple_space_id)
    REFERENCES users(id, couple_space_id) ON DELETE RESTRICT,
  UNIQUE (couple_space_id, idempotency_key),
  CHECK (
    (status = 'ready' AND started_at IS NULL AND completed_at IS NULL) OR
    (status = 'playing' AND started_at IS NOT NULL AND completed_at IS NULL) OR
    (status IN ('won', 'missed', 'abandoned') AND completed_at IS NOT NULL)
  ),
  CHECK ((status = 'won' AND captured_plush_id IS NOT NULL) OR (status <> 'won' AND captured_plush_id IS NULL)),
  CHECK ((status IN ('won', 'missed') AND result_steps IS NOT NULL AND result_verified = 1)
    OR (status NOT IN ('won', 'missed') AND result_steps IS NULL AND result_verified = 0))
) STRICT;

CREATE UNIQUE INDEX claw_attempts_one_active
ON claw_attempts (couple_space_id) WHERE status IN ('ready', 'playing');

CREATE INDEX claw_attempts_history
ON claw_attempts (couple_space_id, created_at DESC, id DESC);

CREATE TRIGGER claw_attempt_create_consume_credit
BEFORE INSERT ON claw_attempts
BEGIN
  SELECT CASE WHEN NEW.status <> 'ready' OR NEW.control_trace_json <> '[]'
    OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL
    THEN raise(ABORT, 'claw attempt must start ready') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.player_user_id
      AND couple_space_id = NEW.couple_space_id AND role = 'girlfriend'
  ) THEN raise(ABORT, 'only girlfriend can play claw game') END;
  SELECT CASE WHEN coalesce((
    SELECT balance FROM claw_credit_wallets WHERE couple_space_id = NEW.couple_space_id
  ), 0) < 1 THEN raise(ABORT, 'no claw credits') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM claw_attempts WHERE couple_space_id = NEW.couple_space_id
      AND status IN ('ready', 'playing')
  ) THEN raise(ABORT, 'active claw attempt exists') END;
  UPDATE claw_credit_wallets SET balance = balance - 1, updated_at = NEW.created_at
  WHERE couple_space_id = NEW.couple_space_id;
END;

CREATE TRIGGER claw_attempts_guard_update
BEFORE UPDATE ON claw_attempts
BEGIN
  SELECT CASE WHEN NEW.id <> OLD.id OR NEW.couple_space_id <> OLD.couple_space_id
    OR NEW.player_user_id <> OLD.player_user_id OR NEW.idempotency_key <> OLD.idempotency_key
    OR NEW.seed <> OLD.seed OR NEW.rules_version <> OLD.rules_version OR NEW.created_at <> OLD.created_at
    THEN raise(ABORT, 'claw attempt identity is immutable') END;
  SELECT CASE WHEN NEW.version <> OLD.version + 1 THEN raise(ABORT, 'claw attempt version must increment') END;
  SELECT CASE WHEN NEW.status <> OLD.status AND NOT (
    (OLD.status = 'ready' AND NEW.status IN ('playing', 'abandoned')) OR
    (OLD.status = 'playing' AND NEW.status IN ('won', 'missed', 'abandoned'))
  ) THEN raise(ABORT, 'invalid claw attempt transition') END;
END;

CREATE TRIGGER claw_attempts_no_delete
BEFORE DELETE ON claw_attempts
BEGIN
  SELECT raise(ABORT, 'claw attempts are immutable');
END;
