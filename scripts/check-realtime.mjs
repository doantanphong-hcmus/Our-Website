import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
const deepTalkCards = JSON.stringify(JSON.parse(await readFile(path.join(root, "content", "deep-talk-fallback.v1.json"), "utf8")).cards)
  .replaceAll("'", "''");
const deepTalkSessionId = "00000000-0000-4000-8000-000000000412";

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
  UPDATE users SET password_hash='${passwordHash()}' WHERE id='user-nhi';
  INSERT INTO activity_sessions (id,couple_space_id,feature,status,created_by_user_id,idempotency_key,payload_json,result_json)
  VALUES ('${deepTalkSessionId}','couple-main','deep_talk','active','user-phong','realtime-deep-session',
    '{"conditions":{"level":"gentle","duration":"30","sensitiveTopics":{}}}',
    '{"deepTalkDeckId":"realtime-deck","deepTalkProgress":{"currentPosition":0,"openedPositions":[],"skippedPositions":[],"starterUserId":"user-phong","answererUserId":"user-phong","turnMode":"alternate","playMode":"two","readyUserIds":[],"skippedByUserIds":[]}}');
  INSERT INTO deep_talk_decks (id,session_id,couple_space_id,created_by_user_id,idempotency_key,seed,generation_day,cards_json)
  VALUES ('realtime-deck','${deepTalkSessionId}','couple-main','user-phong','realtime-deep-deck',1,date('now','+7 hours'),'${deepTalkCards}');`]);

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

async function get(page, pathName) {
  return page.evaluate(async (path) => {
    const response = await fetch(path);
    return { status: response.status, data: await response.json() };
  }, pathName);
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

  const playPath = `/api/sessions/${deepTalkSessionId}/deep-talk-play`;
  const skipped = await api(second.page, playPath, { action: "skip", expectedVersion: 1, idempotencyKey: "realtime-skip-nhi" });
  assert.equal(skipped.status, 200);
  await Promise.all([
    waitFor(first.page, () => globalThis.p110.events.some((event) => event.session?.id === "00000000-0000-4000-8000-000000000412" && event.session.version === 2)),
    waitFor(second.page, () => globalThis.p110.events.some((event) => event.session?.id === "00000000-0000-4000-8000-000000000412" && event.session.version === 2)),
  ]);
  assert.deepEqual((await get(first.page, `/api/sessions/${deepTalkSessionId}/deep-talk-deck`)).data.progress.skippedByUserIds, ["user-nhi"]);
  await second.page.evaluate(() => new Promise((resolve) => {
    globalThis.p110.socket.addEventListener("close", resolve, { once: true });
    globalThis.p110.socket.close(1000, "offline");
  }));
  const advanced = await api(first.page, playPath, { action: "ready", expectedVersion: 2, idempotencyKey: "realtime-ready-ph" });
  assert.equal(advanced.data.progress.currentPosition, 1);
  await waitFor(first.page, () => globalThis.p110.events.some((event) => event.session?.id === "00000000-0000-4000-8000-000000000412" && event.session.version === 3));
  await connect(second.page, 0);
  assert.equal((await get(second.page, `/api/sessions/${deepTalkSessionId}/deep-talk-deck`)).data.progress.currentPosition, 1,
    "reconnected device must recover the shared current card from D1");

  let started = performance.now();
  const created = await api(first.page, "/api/sessions", {
    feature: "blind_bag", idempotencyKey: "p110-create-001",
    conditions: {
      time: "two_three_hours", distance: "under_3", transport: "motorbike", budget: "any",
      setting: "any", experience: "any", surprise: "gentle",
    },
  });
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
    const timer = setTimeout(() => resolve({ code: 0, readyState: globalThis.p110.socket.readyState }), 1_500);
    globalThis.p110.socket.addEventListener("close", ({ code }) => { clearTimeout(timer); resolve({ code }); }, { once: true });
  }));
  assert.equal(await second.page.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST" })).status), 204);
  const afterLogout = await api(first.page, "/api/sessions", {
    feature: "food_vote", idempotencyKey: "p110-after-logout",
    conditions: { foodStyle: "snack", meal: "any", category: "any", allergens: [], exclusions: [] },
  });
  assert.equal(afterLogout.status, 201);
  await waitFor(first.page, () => globalThis.p110.events.some((event) => event.type === "session.updated" && event.eventVersion === 4));
  const revoked = await revokedSocketClosed;
  assert.ok(revoked.code === 4401 || revoked.readyState === 2 || revoked.readyState === 3, JSON.stringify(revoked));

  console.log(`P1.10/P4.12 realtime: auth/revoke, two-device ready/skip sync, ${broadcastMs}ms broadcast and ${reconnectMs}ms reconnect = OK`);
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
