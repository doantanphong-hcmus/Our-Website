import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.WEB_URL ?? "http://127.0.0.1:4173";
const user = { id: "user-phong", coupleSpaceId: "couple-main", displayName: "Phong" };
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const response = await fetch(baseUrl).catch(() => null);
  assert.equal(response?.ok, true, "Chạy `npm run web:preview` trước.");

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge",
    headless: true,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    let loginAttempts = 0;
    await page.route("**/api/auth/session", async (route) => {
      await wait(200);
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });
    await page.route("**/api/auth/login", async (route) => {
      loginAttempts++;
      await wait(200);
      await route.fulfill(loginAttempts === 1
        ? { status: 401, contentType: "application/json", body: JSON.stringify({ error: "Tên đăng nhập hoặc mật khẩu không đúng." }) }
        : { status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    });

    await page.goto(baseUrl);
    await page.getByRole("heading", { name: /Đang mở góc nhỏ/ }).waitFor();
    await page.getByRole("heading", { name: "Chào mừng về nhà" }).waitFor();
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);

    const username = page.getByLabel("Tên đăng nhập");
    const password = page.getByLabel("Mật khẩu", { exact: true });
    await username.fill("phong");
    await password.fill("wrong-password");
    assert.equal(await password.getAttribute("type"), "password");
    await page.getByRole("button", { name: "Hiện mật khẩu" }).click();
    assert.equal(await password.getAttribute("type"), "text");

    await page.setViewportSize({ width: 360, height: 520 });
    await password.focus();
    const submit = page.getByRole("button", { name: "Đăng nhập" });
    const box = await submit.boundingBox();
    assert.ok(box && box.y + box.height <= 520, "Submit must remain visible in a short keyboard viewport");

    await submit.click();
    await page.getByRole("button", { name: "Đang đăng nhập…" }).waitFor();
    assert.equal(await page.locator("form").getAttribute("aria-busy"), "true");
    await page.getByRole("alert").waitFor();
    assert.equal(await username.inputValue(), "phong");
    assert.equal(await password.inputValue(), "wrong-password");

    await password.fill("correct-password");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await page.getByRole("navigation", { name: "Điều hướng chính" }).waitFor();

    const offline = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await offline.route("**/api/auth/session", (route) => route.abort("failed"));
    await offline.goto(baseUrl);
    await offline.getByRole("heading", { name: "Chưa thể kết nối" }).waitFor();
    await offline.getByRole("button", { name: "Thử lại" }).waitFor();

    console.log("P1.6 auth frontend: checking, login, pending, error retention, short viewport and offline = OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
