import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(root, "apps", "web");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
const baseUrl = "http://127.0.0.1:4174";
const server = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", "4174", "--strictPort"], {
  cwd: webRoot, stdio: "ignore", windowsHide: true,
});
server.unref();

const user = {
  id: "user-phong", coupleSpaceId: "couple-main", username: "phong", displayName: "Phong",
  nickname: "Phong", avatarKey: "initials", color: "#9F3F59", role: "boyfriend",
  preferences: { theme: "system", reducedMotion: false },
};

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await fetch(baseUrl).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Vite did not start");
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

let browser;
try {
  await waitUntilReady();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];

  await page.route("**/api/auth/session", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ user }),
  }));
  await page.route("**/api/sessions**", async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.abort("failed");
    if (requests.length === 3) return route.fulfill({
      status: 409, contentType: "application/json",
      body: JSON.stringify({ error: "Phiên đã thay đổi.", session: { version: 2 } }),
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { version: 1 } }) });
  });

  await page.goto(baseUrl);
  await page.getByRole("navigation", { name: "Điều hướng chính" }).waitFor();
  const invalid = await page.evaluate(async () => {
    const queue = await import("/src/offlineQueue.ts");
    return queue.queueSessionCommand("/api/auth/logout", {}).then(() => "", (error) => error.message);
  });
  assert.match(invalid, /Chỉ lệnh phiên/);

  await page.evaluate(async () => {
    const queue = await import("/src/offlineQueue.ts");
    await queue.queueSessionCommand("/api/sessions", { feature: "blind_bag" });
  });
  await page.getByText("Kết nối chưa ổn định. Đang chờ để thử lại…").waitFor();
  await waitFor(() => requests.length === 1, "First request was not attempted");
  const idempotencyKey = requests[0].idempotencyKey;

  await page.reload();
  await waitFor(() => requests.length === 2, "Persisted command was not retried after reload");
  assert.equal(requests[1].idempotencyKey, idempotencyKey);
  await page.getByText("Đã đồng bộ thao tác.").waitFor();
  assert.equal(await page.evaluate(async () => (await import("/src/offlineQueue.ts")).offlineCommandCount()), 0);

  await page.evaluate(async () => {
    const queue = await import("/src/offlineQueue.ts");
    await Promise.all([
      queue.queueSessionCommand("/api/sessions", { feature: "food_vote" }),
      queue.queueSessionCommand("/api/sessions", { feature: "deep_talk" }),
    ]);
  });
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent(), /Phiên đã thay đổi/);
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  assert.equal(requests.length, 3, "Commands after a conflict must remain blocked");
  assert.equal(await page.evaluate(async () => (await import("/src/offlineQueue.ts")).offlineCommandCount()), 1);
  await page.getByRole("button", { name: "Bỏ thao tác đang chờ" }).click();
  assert.equal(await page.evaluate(async () => (await import("/src/offlineQueue.ts")).offlineCommandCount()), 0);

  await context.setOffline(true);
  await page.evaluate(async () => {
    const queue = await import("/src/offlineQueue.ts");
    await queue.queueSessionCommand("/api/sessions", { feature: "blind_bag" });
    queue.startOfflineQueue("user-nhi");
  });
  await context.setOffline(false);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(requests.length, 3, "A different user must not flush Phong's command");
  assert.equal(await page.evaluate(async () => (await import("/src/offlineQueue.ts")).offlineCommandCount()), 0);
  await page.evaluate(async () => (await import("/src/offlineQueue.ts")).startOfflineQueue("user-phong"));
  await waitFor(() => requests.length === 4, "Owner did not resume their queued command");

  console.log("P1.11 offline queue: persistence, stable idempotency, backoff, conflict stop and user isolation = OK");
  await context.close();
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
  if (server.exitCode === null && process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  }
}
