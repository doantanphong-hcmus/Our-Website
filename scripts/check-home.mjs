import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const baseUrl = "http://127.0.0.1:4175";
const server = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "4175", "--strictPort"], {
  cwd: path.join(root, "apps", "web"), stdio: "ignore", windowsHide: true,
});
server.unref();

const user = {
  id: "user-phong", coupleSpaceId: "couple-main", username: "phong", displayName: "Phong",
  nickname: "Phong", avatarKey: "initials", color: "#9F3F59", role: "boyfriend",
  preferences: { theme: "system", reducedMotion: false },
};
const session = {
  id: "11111111-1111-4111-8111-111111111111", feature: "blind_bag", status: "pending",
  createdByUserId: "user-phong", version: 1, createdAt: 1_788_000_000,
};

async function ready() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await fetch(baseUrl).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Vite did not start");
}

let browser;
try {
  await ready();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  let sessions = [session];
  const commands = [];
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }));
  await page.route("**/api/sessions**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eventVersion: 1, sessions }) });
    commands.push(route.request().postDataJSON());
    sessions = [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { ...session, status: "cancelled", version: 2 } }) });
  });

  await page.goto(baseUrl);
  const activities = page.getByRole("navigation", { name: "Hoạt động chính" });
  await activities.waitFor();
  assert.equal(await activities.getByRole("link").count(), 3);
  assert.equal(await activities.locator("svg").count(), 3);
  assert.equal(await activities.locator("small").count(), 0);
  await page.getByRole("heading", { name: "Phiên đang diễn ra" }).waitFor();
  assert.match(await page.locator(".session-card").textContent(), /Xé Túi Mù.*Chờ người còn lại.*Phong/s);
  assert.equal(await page.getByText("Bản đồ", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Hộ chiếu", { exact: true }).count(), 0);
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
  await page.getByRole("button", { name: "Đóng phiên" }).click();
  await page.getByRole("heading", { name: "Chưa có phiên nào đang mở" }).waitFor();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].expectedVersion, 1);
  assert.match(commands[0].idempotencyKey, /^[0-9a-f-]{36}$/);
  console.log("P1.12 home: concise activities, live sessions, close command and mobile width = OK");
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
  if (server.exitCode === null && process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
}
