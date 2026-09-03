import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const baseUrl = "http://127.0.0.1:4176";
const server = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "4176", "--strictPort"], {
  cwd: path.join(root, "apps", "web"), stdio: "ignore", windowsHide: true,
});
server.unref();

const user = {
  id: "user-phong", coupleSpaceId: "couple-main", username: "phong", displayName: "Phong",
  nickname: "Phong", avatarKey: "initials", color: "#9F3F59", role: "boyfriend",
  preferences: { theme: "system", reducedMotion: false },
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
  const context = await browser.newContext();
  const page = await context.newPage();
  let attempts = 0;
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }));
  await page.route("**/api/sessions", async (route) => {
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return attempts <= 2
      ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eventVersion: 0, sessions: [] }) });
  });

  await page.goto(baseUrl);
  await page.locator(".ui-skeleton").first().waitFor();
  await page.getByRole("heading", { name: "Chưa xem được các phiên" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Thử lại" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Quay lại" }).count(), 1);
  await page.getByRole("button", { name: "Thử lại" }).click();
  await page.getByRole("heading", { name: "Chưa có phiên nào đang mở" }).waitFor();
  assert.equal(await page.locator(".ui-state--empty").getByRole("img", { name: "Phong và Nhi" }).getAttribute("src"), "/couple-empty-state.jpg");
  assert.equal(await page.getByRole("link", { name: "Bắt đầu Xé Túi Mù" }).count(), 1);

  await context.setOffline(true);
  await page.getByText(/Đang ngoại tuyến/).waitFor();
  await context.setOffline(false);
  await page.getByText(/Đang ngoại tuyến/).waitFor({ state: "hidden" });
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
  console.log("P1.13 UI states: skeleton, error actions, empty CTA and offline banner = OK");
  await context.close();
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
  if (server.exitCode === null && process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
}
