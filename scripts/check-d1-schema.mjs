import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = path.join(root, "apps", "worker", "wrangler.jsonc");
const seed = path.join(root, "apps", "worker", "seed.sql");
const state = await mkdtemp(path.join(tmpdir(), "our-website-d1-"));

function run(args, expectFailure = false) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1", XDG_CONFIG_HOME: state },
  });
  assert.equal(result.status !== 0, expectFailure, result.stderr || result.stdout);
  return result.stdout;
}

const local = ["DB", "--local", "--persist-to", state, "--config", config];

try {
  run(["d1", "migrations", "apply", ...local]);
  run(["d1", "execute", ...local, "--file", seed]);
  run(["d1", "execute", ...local, "--file", seed]);

  const output = run([
    "d1", "execute", ...local, "--json", "--command",
    "SELECT count(*) AS users, count(DISTINCT role) AS roles, count(DISTINCT couple_space_id) AS spaces, (SELECT count(*) FROM user_preferences) AS preferences FROM users",
  ]);
  const rows = JSON.parse(output)[0].results[0];
  assert.deepEqual(rows, { users: 2, roles: 2, spaces: 1, preferences: 2 });

  const walletOutput = run([
    "d1", "execute", ...local, "--json", "--command",
    "SELECT beneficiary_user_id, balance FROM star_wallets",
  ]);
  assert.deepEqual(JSON.parse(walletOutput)[0].results, [{ beneficiary_user_id: "user-nhi", balance: 0 }]);

  const clawWalletOutput = run([
    "d1", "execute", ...local, "--json", "--command",
    "SELECT owner_user_id, balance FROM claw_credit_wallets",
  ]);
  assert.deepEqual(JSON.parse(clawWalletOutput)[0].results, [{ owner_user_id: "user-nhi", balance: 0 }]);

  const collectionOutput = run([
    "d1", "execute", ...local, "--json", "--command",
    "SELECT (SELECT count(*) FROM plush_collection) AS plushes, (SELECT count(*) FROM claw_rewards) AS rewards",
  ]);
  assert.deepEqual(JSON.parse(collectionOutput)[0].results, [{ plushes: 0, rewards: 0 }]);

  run([
    "d1", "execute", ...local, "--command",
    "INSERT INTO users (id,couple_space_id,username,password_hash,display_name,color,role) VALUES ('third','couple-main','third','!auth-not-configured','Third','#112233','boyfriend')",
  ], true);

  run([
    "d1", "execute", ...local, "--command",
    "INSERT INTO activity_sessions (id,couple_space_id,feature,created_by_user_id,idempotency_key) VALUES ('one','couple-main','blind_bag','user-phong','one')",
  ]);
  run([
    "d1", "execute", ...local, "--command",
    "INSERT INTO activity_sessions (id,couple_space_id,feature,created_by_user_id,idempotency_key) VALUES ('two','couple-main','blind_bag','user-nhi','two')",
  ], true);

  run(["d1", "execute", ...local, "--command", `
    UPDATE star_wallets SET balance=10, updated_at=unixepoch() WHERE couple_space_id='couple-main';
    INSERT INTO star_transactions
      (id,couple_space_id,actor_user_id,idempotency_key,kind,delta,balance_after,rule_id,label_snapshot)
    VALUES ('stars-1','couple-main','user-phong','award-stars-001','award',10,10,'listening','Luyện nghe');`]);
  run(["d1", "execute", ...local, "--command", `
    INSERT INTO star_transactions
      (id,couple_space_id,actor_user_id,idempotency_key,kind,delta,balance_after,rule_id,label_snapshot)
    VALUES ('stars-2','couple-main','user-phong','award-stars-001','award',10,20,'reading','Đọc bài');`], true);
  run(["d1", "execute", ...local, "--command", `
    INSERT INTO star_transactions
      (id,couple_space_id,actor_user_id,idempotency_key,kind,delta,balance_after,rule_id,label_snapshot)
    VALUES ('stars-3','couple-main','user-phong','award-stars-002','award',-10,10,'listening','Luyện nghe');`], true);
  run(["d1", "execute", ...local, "--command", `
    INSERT INTO star_transactions
      (id,couple_space_id,actor_user_id,idempotency_key,kind,delta,balance_after,rule_id,label_snapshot)
    VALUES ('stars-4','couple-main','user-phong','award-stars-003','award',10,20,'listening','Luyện nghe');`], true);
  run(["d1", "execute", ...local, "--command", "UPDATE star_transactions SET delta=20 WHERE id='stars-1'"], true);
  run(["d1", "execute", ...local, "--command", "DELETE FROM star_transactions WHERE id='stars-1'"], true);
  run(["d1", "execute", ...local, "--command", "UPDATE star_wallets SET balance=-1 WHERE couple_space_id='couple-main'"], true);

  run(["d1", "execute", ...local, "--command", `
    UPDATE star_wallets SET balance=30, updated_at=unixepoch() WHERE couple_space_id='couple-main';
    INSERT INTO claw_credit_purchases
      (id,couple_space_id,buyer_user_id,idempotency_key,star_transaction_id,stars_spent,credits_added,label_snapshot)
    VALUES ('pack-1','couple-main','user-nhi','buy-claw-pack-001','stars-pack-1',20,5,'5 lượt gắp thú');`]);
  const clawPurchaseOutput = run([
    "d1", "execute", ...local, "--json", "--command",
    "SELECT (SELECT balance FROM star_wallets) AS stars, (SELECT balance FROM claw_credit_wallets) AS credits",
  ]);
  assert.deepEqual(JSON.parse(clawPurchaseOutput)[0].results, [{ stars: 10, credits: 5 }]);
  run(["d1", "execute", ...local, "--command", "UPDATE claw_credit_purchases SET credits_added=10 WHERE id='pack-1'"], true);
  run(["d1", "execute", ...local, "--command", "DELETE FROM claw_credit_purchases WHERE id='pack-1'"], true);
  run(["d1", "execute", ...local, "--command", "UPDATE claw_credit_wallets SET balance=-1 WHERE couple_space_id='couple-main'"], true);

  run(["d1", "execute", ...local, "--command", `INSERT INTO claw_attempts
    (id,couple_space_id,player_user_id,idempotency_key,seed,rules_version,expires_at)
    VALUES ('00000000-0000-4000-8000-000000000201','couple-main','user-nhi','claw-attempt-001',42,1,unixepoch()+300)`]);
  const attemptOutput = run([
    "d1", "execute", ...local, "--json", "--command",
    "SELECT (SELECT balance FROM claw_credit_wallets) AS credits, (SELECT status FROM claw_attempts) AS status",
  ]);
  assert.deepEqual(JSON.parse(attemptOutput)[0].results, [{ credits: 4, status: "ready" }]);
  run(["d1", "execute", ...local, "--command", `INSERT INTO claw_attempts
    (id,couple_space_id,player_user_id,idempotency_key,seed,rules_version,expires_at)
    VALUES ('00000000-0000-4000-8000-000000000202','couple-main','user-nhi','claw-attempt-002',43,1,unixepoch()+300)`], true);
  run(["d1", "execute", ...local, "--command",
    "UPDATE claw_attempts SET seed=99, version=2 WHERE id='00000000-0000-4000-8000-000000000201'"], true);
  run(["d1", "execute", ...local, "--command", `UPDATE claw_attempts SET status='playing', started_at=unixepoch(),
    expires_at=unixepoch()+120, updated_at=unixepoch(), version=2 WHERE id='00000000-0000-4000-8000-000000000201';
    UPDATE claw_attempts SET status='missed', control_trace_json='[{"step":1,"drop":true}]', result_steps=300,
    result_verified=1, completed_at=unixepoch(), updated_at=unixepoch(), version=3
    WHERE id='00000000-0000-4000-8000-000000000201';`]);
  run(["d1", "execute", ...local, "--command", "DELETE FROM claw_attempts WHERE id='00000000-0000-4000-8000-000000000201'"], true);

  console.log("P1.4/E1.1-E1.2/E2.3-E2.6 D1 schema: credits, attempts, collection and rewards = OK");
} finally {
  await rm(state, { recursive: true, force: true });
}
