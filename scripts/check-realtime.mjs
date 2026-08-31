import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = path.join(root, "apps", "worker", "wrangler.jsonc");
const seed = path.join(root, "apps", "worker", "seed.sql");
const state = await mkdtemp(path.join(tmpdir(), "our-website-realtime-"));
const baseUrl = "http://localhost:8797";
const password = "realtime check password";
const pepper = "test-only-pepper-at-least-thirty-two-bytes";
const timeoutMs = 2_000;
const env = { ...process.env, CI: "1", NO_COLOR: "1", XDG_CONFIG_HOME: state, WRANGLER_LOG: "error" };

function wranglerCommand(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
  UPDATE users SET password_hash='${passwordHash()}' WHERE id='user-nhi';`]);

const server = spawn(process.execPath, [
  wrangler, "dev", "--config", config, "--ip", "127.0.0.1", "--port", "8797", "--persist-to", state,
  "--var", `AUTH_PEPPER:${pepper}`,
], { cwd: root, env, stdio: "ignore", windowsHide: true });
server.unref();

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await fetch(`${baseUrl}/health`).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Realtime Worker did not start");
}

async function login(browser, username) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/health`);
  const status = await page.evaluate(async ({ username, password }) => (await fetch("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
  })).status, { username, password });
  assert.equal(status, 200);
  return { context, page };
}

async function connect(page, lastEvent = 0) {
  return page.evaluate(({ lastEvent, timeoutMs }) => new Promise((resolve, reject) => {
    const url = new URL(`/ws?lastEvent=${lastEvent}&room=ignored-by-server`, location.href);
    url.protocol = "ws:";
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("WebSocket snapshot timeout")), timeoutMs);
    globalThis.p110 = { socket, events: [] };
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
    socket.addEventListener("message", ({ data }) => {
      const event = data === "pong" ? { type: "pong" } : JSON.parse(data);
      globalThis.p110.events.push(event);
      if (event.type === "session.snapshot") {
        clearTimeout(timer);
        resolve(event);
      }
    });
  }), { lastEvent, timeoutMs });
}

async function waitFor(page, predicate) {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs });
  return page.evaluate(() => globalThis.p110.events.at(-1));
}

async function api(page, pathName, input) {
  return page.evaluate(async ({ pathName, input }) => {
    const response = await fetch(pathName, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    return { status: response.status, data: await response.json() };
  }, { pathName, input });
}

let browser;
try {
  await waitUntilReady();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge", headless: true });
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`${baseUrl}/health`);
  await assert.rejects(() => connect(guestPage), /WebSocket connection failed/);
  await guest.close();
  const first = await login(browser, "phong");
  const second = await login(browser, "nhi");
  const [firstSnapshot, secondSnapshot] = await Promise.all([connect(first.page), connect(second.page)]);
  assert.equal(firstSnapshot.eventVersion, 0);
  assert.equal(secondSnapshot.eventVersion, 0);

  await first.page.evaluate(() => globalThis.p110.socket.send("ping"));
  await waitFor(first.page, () => globalThis.p110.events.some((event) => event.type === "pong"));

  let started = performance.now();
  const created = await api(first.page, "/api/sessions", { feature: "blind_bag", idempotencyKey: "p110-create-001" });
  assert.equal(created.status, 201);
  const sessionId = created.data.session.id;
  await Promise.all([
    waitFor(first.page, () => globalThis.p110.events.some((event) => event.type === "session.updated" && event.eventVersion === 1)),
    waitFor(second.page, () => globalThis.p110.events.some((event) => event.type === "session.updated" && event.eventVersion === 1)),
  ]);
  const broadcastMs = Math.round(performance.now() - started);
  assert.ok(broadcastMs < timeoutMs, `Broadcast took ${broadcastMs}ms`);

  const joined = await api(second.page, `/api/sessions/${sessionId}/join`, { expectedVersion: 1, idempotencyKey: "p110-join-00001" });
  assert.equal(joined.status, 200);
  await Promise.all([
    waitFor(first.page, () => globalThis.p110.events.some((event) => event.type === "session.updated" && event.eventVersion === 2)),
    waitFor(second.page, () => globalThis.p110.events.some((event) => event.type === "session.updated" && event.eventVersion === 2)),
  ]);

  await second.page.evaluate(() => globalThis.p110.socket.close(1000, "offline"));
  const completed = await api(first.page, `/api/sessions/${sessionId}/complete`, { expectedVersion: 2, idempotencyKey: "p110-complete-1" });
  assert.equal(completed.status, 200);
  await waitFor(first.page, () => globalThis.p110.events.some((event) => event.type === "session.updated" && event.eventVersion === 3));

  started = performance.now();
  const recovered = await connect(second.page, 2);
  const reconnectMs = Math.round(performance.now() - started);
  assert.ok(reconnectMs < timeoutMs, `Reconnect took ${reconnectMs}ms`);
  assert.equal(recovered.eventVersion, 3);
  assert.equal(recovered.reconciled, true);
  assert.equal(recovered.sessions.find((item) => item.id === sessionId).status, "completed");

  await second.page.evaluate(() => new Promise((resolve) => {
    globalThis.p110.socket.addEventListener("close", resolve, { once: true });
    globalThis.p110.socket.close(1000, "resync");
  }));
  const exact = await connect(second.page, 3);
  assert.equal(exact.reconciled, false);

  const revokedSocketClosed = second.page.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 0, readyState: globalThis.p110.socket.readyState }), 500);
    globalThis.p110.socket.addEventListener("close", ({ code }) => { clearTimeout(timer); resolve({ code }); }, { once: true });
  }));
  assert.equal(await second.page.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST" })).status), 204);
  const afterLogout = await api(first.page, "/api/sessions", { feature: "food_vote", idempotencyKey: "p110-after-logout" });
  assert.equal(afterLogout.status, 201);
  await waitFor(first.page, () => globalThis.p110.events.some((event) => event.type === "session.updated" && event.eventVersion === 4));
  const revoked = await revokedSocketClosed;
  assert.ok(revoked.code === 4401 || revoked.readyState === 2 || revoked.readyState === 3, JSON.stringify(revoked));

  console.log(`P1.10 realtime: auth/revoke, heartbeat, ${broadcastMs}ms broadcast and ${reconnectMs}ms D1 reconnect = OK`);
  await Promise.all([first.context.close(), second.context.close()]);
} finally {
  await browser?.close().catch(() => {});
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
