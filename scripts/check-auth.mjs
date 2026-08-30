import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = path.join(root, "apps", "worker", "wrangler.jsonc");
const seed = path.join(root, "apps", "worker", "seed.sql");
const state = path.join(root, "apps", "worker", ".wrangler", "auth-check");
const baseUrl = "http://127.0.0.1:8795";
const password = "correct horse battery staple";
const newPassword = "a newer correct horse battery staple";
const pepper = "test-only-pepper-at-least-thirty-two-bytes";
const env = { ...process.env, CI: "1", NO_COLOR: "1", XDG_CONFIG_HOME: state, WRANGLER_LOG: "error" };

function wranglerCommand(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

const local = ["DB", "--local", "--persist-to", state, "--config", config];
wranglerCommand(["d1", "migrations", "apply", ...local]);
wranglerCommand(["d1", "execute", ...local, "--file", seed]);
wranglerCommand(["d1", "execute", ...local, "--command", "DELETE FROM auth_sessions; DELETE FROM auth_login_limits"]);

const salt = randomBytes(16);
const peppered = createHmac("sha256", pepper).update(password).digest();
const passwordHash = `pbkdf2-sha256+pepper$50000$${salt.toString("base64")}$${pbkdf2Sync(peppered, salt, 50_000, 32, "sha256").toString("base64")}`;
wranglerCommand([
  "d1", "execute", ...local, "--command",
  `UPDATE users SET password_hash = '${passwordHash}', nickname = 'Phong', avatar_key = NULL, color = '#9F3F59' WHERE username = 'phong';
   UPDATE user_preferences SET theme = 'system', reduced_motion = 0 WHERE user_id = 'user-phong'`,
]);

const server = spawn(process.execPath, [
  wrangler, "dev", "--config", config, "--ip", "127.0.0.1", "--port", "8795", "--persist-to", state,
  "--var", `AUTH_PEPPER:${pepper}`,
], { cwd: root, env, stdio: "ignore", windowsHide: true });
server.unref();

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await fetch(`${baseUrl}/health`).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Auth Worker did not start");
}

async function login(username, attemptedPassword, ip = "203.0.113.1") {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ username, password: attemptedPassword }),
  });
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

try {
  await waitUntilReady();

  const wrongExisting = await login("phong", "wrong");
  const wrongMissing = await login("missing", "wrong");
  assert.equal(wrongExisting.status, 401);
  assert.equal(wrongMissing.status, 401);
  assert.deepEqual(await wrongExisting.json(), await wrongMissing.json());
  assert.equal((await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "null",
  })).status, 401);

  const started = performance.now();
  const firstLogin = await login("phong", password);
  const hashMs = Math.round(performance.now() - started);
  assert.equal(firstLogin.status, 200);
  const firstSetCookie = firstLogin.headers.get("set-cookie") ?? "";
  assert.match(firstSetCookie, /HttpOnly/i);
  assert.match(firstSetCookie, /Secure/i);
  assert.match(firstSetCookie, /SameSite=Lax/i);
  const firstCookie = cookieFrom(firstLogin);
  assert.ok(firstCookie.startsWith("__Host-our_session="));
  assert.doesNotMatch(JSON.stringify(await firstLogin.json()), /password|token/i);

  const current = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: firstCookie } });
  assert.equal(current.status, 200);
  assert.equal((await current.json()).user.coupleSpaceId, "couple-main");
  assert.equal((await fetch(`${baseUrl}/api/auth/profile`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "dark" }),
  })).status, 401);

  const partialProfile = await fetch(`${baseUrl}/api/auth/profile`, {
    method: "PATCH",
    headers: { Cookie: firstCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ theme: "light" }),
  });
  assert.equal(partialProfile.status, 200);
  assert.equal((await partialProfile.json()).user.avatarKey, "initials");

  const profile = await fetch(`${baseUrl}/api/auth/profile`, {
    method: "PATCH",
    headers: { Cookie: firstCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user-nhi", nickname: "Phong mới", avatarKey: "rose", color: "#884466", theme: "dark", reducedMotion: true }),
  });
  assert.equal(profile.status, 200);
  const profileUser = (await profile.json()).user;
  assert.equal(profileUser.id, "user-phong");
  assert.deepEqual(
    { nickname: profileUser.nickname, avatarKey: profileUser.avatarKey, color: profileUser.color, preferences: profileUser.preferences },
    { nickname: "Phong mới", avatarKey: "rose", color: "#884466", preferences: { theme: "dark", reducedMotion: true } },
  );
  assert.equal((await fetch(`${baseUrl}/api/auth/profile`, {
    method: "PATCH",
    headers: { Cookie: firstCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ color: "red" }),
  })).status, 400);

  const secondLogin = await login("phong", password);
  const secondCookie = cookieFrom(secondLogin);
  assert.equal(secondLogin.status, 200);
  assert.notEqual(secondCookie, firstCookie, "Each login must rotate the session token");

  assert.equal((await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { Cookie: secondCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "wrong", newPassword }),
  })).status, 400);
  const changed = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { Cookie: secondCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: password, newPassword }),
  });
  assert.equal(changed.status, 200);
  const rotatedCookie = cookieFrom(changed);
  assert.notEqual(rotatedCookie, secondCookie);
  assert.equal((await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: firstCookie } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: secondCookie } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: rotatedCookie } })).status, 200);
  assert.equal((await login("phong", password)).status, 401);
  const relogin = await login("phong", newPassword);
  assert.equal(relogin.status, 200);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: cookieFrom(relogin) } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  assert.equal((await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookieFrom(relogin) } })).status, 401);

  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await login("rate-test", "wrong", "203.0.113.9")).status, 401);
  }
  const limited = await login("rate-test", "wrong", "203.0.113.9");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);

  assert.ok(hashMs < 1_000, `PBKDF2 login took ${hashMs}ms`);
  console.log(`P1.5/P1.7 auth: PBKDF2 (${hashMs}ms), profile, password rotation, logout and rate limit = OK`);
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
}
