import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const reset = path.join(root, "scripts", "reset-password.mjs");
const config = path.join(root, "apps", "worker", "wrangler.jsonc");
const seed = path.join(root, "apps", "worker", "seed.sql");
const state = await mkdtemp(path.join(tmpdir(), "our-website-reset-check-"));
const pepper = "test-only-pepper-at-least-thirty-two-bytes";
const password = "a reset password for P1.8";
const env = {
  ...process.env, CI: "1", NO_COLOR: "1", XDG_CONFIG_HOME: state,
  AUTH_PEPPER: pepper, RESET_PASSWORD: password,
};

function run(command, args, expected = 0) {
  const result = spawnSync(process.execPath, [command, ...args], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result.stdout;
}

const target = ["DB", "--local", "--persist-to", state, "--config", config];

try {
  run(wrangler, ["d1", "migrations", "apply", ...target]);
  run(wrangler, ["d1", "execute", ...target, "--file", seed]);
  run(wrangler, ["d1", "execute", ...target, "--command", `
    INSERT INTO auth_sessions (id,user_id,token_hash,created_at,last_seen_at,idle_expires_at,expires_at)
    VALUES
      ('old','user-phong','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',unixepoch(),unixepoch(),unixepoch()+60,unixepoch()+60),
      ('other','user-nhi','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',unixepoch(),unixepoch(),unixepoch()+60,unixepoch()+60);
    INSERT INTO auth_login_limits (key,failure_count,blocked_until,updated_at)
    VALUES ('a',1,0,unixepoch());`]);

  run(reset, ["--local", "--persist-to", state, "--username", "phong", "--confirm", "wrong"], 1);
  const resetOutput = run(reset, ["--local", "--persist-to", state, "--username", "phong", "--confirm", "RESET phong"]);
  assert.match(resetOutput, /Da dat lai mat khau/);

  const output = run(wrangler, ["d1", "execute", ...target, "--json", "--command",
    "SELECT password_hash, (SELECT count(*) FROM auth_sessions WHERE user_id='user-phong' AND revoked_at IS NULL) AS active, (SELECT count(*) FROM auth_sessions WHERE user_id='user-nhi' AND revoked_at IS NULL) AS other_active FROM users WHERE id='user-phong'",
  ]);
  const row = JSON.parse(output)[0].results[0];
  assert.match(row.password_hash, /^pbkdf2-sha256\+pepper\$50000\$/, `Password was not reset: ${row.password_hash}\n${resetOutput}`);
  const [, iterations, salt, expected] = row.password_hash.split("$");
  const peppered = createHmac("sha256", pepper).update(password).digest();
  assert.equal(pbkdf2Sync(peppered, Buffer.from(salt, "base64"), Number(iterations), 32, "sha256").toString("base64"), expected);
  assert.equal(row.active, 0);
  assert.equal(row.other_active, 1);
  console.log("P1.8 reset CLI: owner confirmation, password hash and session revocation = OK");
} finally {
  await rm(state, { recursive: true, force: true });
}
