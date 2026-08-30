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

  console.log("P1.4 D1 schema: migration, idempotent seed and constraints = OK");
} finally {
  await rm(state, { recursive: true, force: true });
}
