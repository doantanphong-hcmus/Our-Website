import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = path.join(root, "apps", "worker", "wrangler.jsonc");

function fail(message) {
  throw new Error(message);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--local" || argument === "--remote") options[argument.slice(2)] = true;
    else if (argument === "--username") options.username = args[++index];
    else if (argument === "--confirm") options.confirm = args[++index];
    else if (argument === "--persist-to") options.persistTo = args[++index];
    else fail(`Tuy chon khong hop le: ${argument ?? "(trong)"}`);
  }
  return options;
}

async function main() {
const options = parseArgs(process.argv.slice(2));
if (Boolean(options.local) === Boolean(options.remote)) fail("Chon dung mot moi truong: --local hoac --remote.");
if (!/^(phong|nhi)$/.test(options.username ?? "")) fail("--username chi nhan phong hoac nhi.");
if (options.confirm !== `RESET ${options.username}`) fail(`Xac minh owner bang: --confirm "RESET ${options.username}"`);

const password = process.env.RESET_PASSWORD ?? "";
const pepper = process.env.AUTH_PEPPER ?? "";
const passwordBytes = Buffer.byteLength(password);
if (passwordBytes < 12 || passwordBytes > 256) fail("RESET_PASSWORD phai dai tu 12 den 256 byte.");
if (Buffer.byteLength(pepper) < 32) fail("AUTH_PEPPER phai co it nhat 32 byte.");

const wranglerEnv = { ...process.env, CI: "1", NO_COLOR: "1" };
delete wranglerEnv.RESET_PASSWORD;
delete wranglerEnv.AUTH_PEPPER;
const target = ["DB", options.local ? "--local" : "--remote"];
if (options.persistTo) target.push("--persist-to", path.resolve(options.persistTo));
target.push("--config", config);

function run(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root, env: wranglerEnv, encoding: "utf8",
  });
  if (result.status !== 0) fail(result.stderr || result.stdout || "Wrangler that bai.");
  return result.stdout;
}

const lookup = JSON.parse(run([
  "d1", "execute", ...target, "--json", "--command",
  `SELECT id FROM users WHERE username = '${options.username}' COLLATE NOCASE`,
]));
const userId = lookup[0]?.results?.[0]?.id;
if (typeof userId !== "string") fail("Khong tim thay tai khoan.");

const salt = randomBytes(16);
const peppered = createHmac("sha256", pepper).update(password).digest();
const derived = pbkdf2Sync(peppered, salt, 50_000, 32, "sha256");
const passwordHash = `pbkdf2-sha256+pepper$50000$${salt.toString("base64")}$${derived.toString("base64")}`;
const accountLimit = createHash("sha256").update(`account:${options.username}`).digest("hex");
const passwordLimit = createHash("sha256").update(`password:${userId}`).digest("hex");
const sql = `UPDATE auth_sessions SET revoked_at = unixepoch() WHERE user_id = '${userId.replaceAll("'", "''")}' AND revoked_at IS NULL;
UPDATE users SET password_hash = '${passwordHash}', updated_at = unixepoch() WHERE id = '${userId.replaceAll("'", "''")}';
DELETE FROM auth_login_limits WHERE key IN ('${accountLimit}', '${passwordLimit}');`;
const tempRoot = path.join(root, ".wrangler");
await mkdir(tempRoot, { recursive: true });
const temp = await mkdtemp(path.join(tempRoot, "password-reset-"));
const sqlFile = path.join(temp, "reset.sql");

try {
  await writeFile(sqlFile, sql, { mode: 0o600 });
  run(["d1", "execute", ...target, "--file", sqlFile]);
  const verification = JSON.parse(run([
    "d1", "execute", ...target, "--json", "--command",
    `SELECT password_hash, (SELECT count(*) FROM auth_sessions WHERE user_id = '${userId.replaceAll("'", "''")}' AND revoked_at IS NULL) AS active FROM users WHERE id = '${userId.replaceAll("'", "''")}'`,
  ]))[0]?.results?.[0];
  if (verification?.password_hash !== passwordHash || verification.active !== 0) fail("Khong the xac minh ket qua reset; hay kiem tra D1.");
  console.log(`Da dat lai mat khau cho ${options.username} va thu hoi toan bo session cu (${options.local ? "local" : "remote"}).`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
