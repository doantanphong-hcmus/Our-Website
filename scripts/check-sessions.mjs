import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = path.join(root, "apps", "worker", "wrangler.jsonc");
const seed = path.join(root, "apps", "worker", "seed.sql");
const state = await mkdtemp(path.join(tmpdir(), "our-website-sessions-"));
const baseUrl = "http://127.0.0.1:8796";
const password = "session check password";
const pepper = "test-only-pepper-at-least-thirty-two-bytes";
const env = { ...process.env, CI: "1", NO_COLOR: "1", XDG_CONFIG_HOME: state, WRANGLER_LOG: "error" };

function wranglerCommand(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function passwordHash() {
  const salt = randomBytes(16);
  const peppered = createHmac("sha256", pepper).update(password).digest();
  return `pbkdf2-sha256+pepper$50000$${salt.toString("base64")}$${pbkdf2Sync(peppered, salt, 50_000, 32, "sha256").toString("base64")}`;
}

const local = ["DB", "--local", "--persist-to", state, "--config", config];
wranglerCommand(["d1", "migrations", "apply", ...local]);
wranglerCommand(["d1", "execute", ...local, "--file", seed]);
wranglerCommand(["d1", "execute", ...local, "--command", `
  UPDATE users SET password_hash='${passwordHash()}' WHERE id='user-phong';
  UPDATE users SET password_hash='${passwordHash()}' WHERE id='user-nhi';
  INSERT INTO activity_sessions
    (id,couple_space_id,feature,status,created_by_user_id,idempotency_key,expires_at)
  VALUES ('00000000-0000-4000-8000-000000000001','couple-main','food_vote','pending','user-phong','expired-create-001',unixepoch()-1);`]);

const server = spawn(process.execPath, [
  wrangler, "dev", "--config", config, "--ip", "127.0.0.1", "--port", "8796", "--persist-to", state,
  "--var", `AUTH_PEPPER:${pepper}`,
], { cwd: root, env, stdio: "ignore", windowsHide: true });
server.unref();

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await fetch(`${baseUrl}/health`).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Session Worker did not start");
}

async function login(username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

async function request(pathname, cookie, method = "GET", input) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { Cookie: cookie, ...(input ? { "Content-Type": "application/json" } : {}) },
    body: input ? JSON.stringify(input) : undefined,
  });
  const data = await response.json();
  return { response, data };
}

async function create(cookie, feature, idempotencyKey) {
  return request("/api/sessions", cookie, "POST", { feature, idempotencyKey });
}

async function act(cookie, id, action, expectedVersion, idempotencyKey) {
  return request(`/api/sessions/${id}/${action}`, cookie, "POST", { expectedVersion, idempotencyKey });
}

try {
  await waitUntilReady();
  assert.equal((await fetch(`${baseUrl}/api/sessions`)).status, 401);
  const phong = await login("phong");
  const nhi = await login("nhi");

  const initial = await request("/api/sessions", phong);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.data.sessions.find((item) => item.feature === "food_vote").status, "expired");

  const created = await create(phong, "blind_bag", "create-blind-001");
  assert.equal(created.response.status, 201);
  assert.equal(created.data.session.status, "pending");
  const sessionId = created.data.session.id;
  const replayCreate = await create(phong, "blind_bag", "create-blind-001");
  assert.equal(replayCreate.response.status, 200);
  assert.equal(replayCreate.data.duplicate, true);
  assert.equal((await create(phong, "deep_talk", "create-blind-001")).response.status, 409);
  assert.equal((await create(nhi, "blind_bag", "create-blind-002")).response.status, 409);
  assert.equal((await act(phong, sessionId, "join", 1, "join-blind-owner")).response.status, 409);

  const joined = await act(nhi, sessionId, "join", 1, "join-blind-001");
  assert.equal(joined.response.status, 200);
  assert.equal(joined.data.session.status, "active");
  assert.equal(joined.data.session.version, 2);
  assert.equal((await act(nhi, sessionId, "join", 1, "join-blind-001")).data.duplicate, true);
  assert.equal((await act(phong, sessionId, "cancel", 2, "join-blind-001")).response.status, 409);
  assert.equal((await act(phong, sessionId, "cancel", 1, "cancel-stale-001")).response.status, 409);
  const completed = await act(phong, sessionId, "complete", 2, "complete-blind-001");
  assert.equal(completed.response.status, 200);
  assert.equal(completed.data.session.status, "completed");

  const declinedSession = await create(nhi, "blind_bag", "create-decline-001");
  const declined = await act(phong, declinedSession.data.session.id, "decline", 1, "decline-blind-001");
  assert.equal(declined.data.session.status, "declined");

  const simultaneous = await Promise.all([
    create(phong, "food_vote", "create-food-phong"),
    create(nhi, "food_vote", "create-food-nhi01"),
  ]);
  assert.deepEqual(simultaneous.map((item) => item.response.status).sort(), [201, 409]);
  const open = simultaneous.find((item) => item.response.status === 201).data.session;
  const creatorCookie = open.createdByUserId === "user-phong" ? phong : nhi;
  assert.equal((await act(creatorCookie, open.id, "cancel", 1, "cancel-food-001")).data.session.status, "cancelled");

  const concurrentSession = await create(phong, "deep_talk", "create-deep-0001");
  const concurrentId = concurrentSession.data.session.id;
  assert.equal((await act(nhi, concurrentId, "join", 1, "join-deep-000001")).data.session.status, "active");
  const competing = await Promise.all([
    act(phong, concurrentId, "cancel", 2, "cancel-deep-001"),
    act(nhi, concurrentId, "complete", 2, "complete-deep-1"),
  ]);
  assert.deepEqual(competing.map((item) => item.response.status).sort(), [200, 409]);

  console.log("P1.9 session core: scope, lifecycle, expiry, idempotency, version conflict and one-open invariant = OK");
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (server.exitCode === null && process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  }
  await rm(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}
