import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.WEB_URL ?? "http://127.0.0.1:4173";
let user = {
  id: "user-phong", coupleSpaceId: "couple-main", username: "phong", displayName: "Phong",
  nickname: "Phong", avatarKey: "initials", color: "#9F3F59", role: "boyfriend",
  preferences: { theme: "system", reducedMotion: false },
};

async function main() {
  const response = await fetch(baseUrl).catch(() => null);
  assert.equal(response?.ok, true, "Chạy `npm run web:preview` trước.");
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge", headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    const profileBodies = [];
    let passwordBody;
    let loggedOut = false;

    await page.route("**/api/auth/session", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ user }),
    }));
    await page.route("**/api/auth/profile", async (route) => {
      const changes = route.request().postDataJSON();
      profileBodies.push(changes);
      user = {
        ...user,
        nickname: changes.nickname ?? user.nickname,
        avatarKey: changes.avatarKey ?? user.avatarKey,
        color: changes.color ?? user.color,
        preferences: {
          theme: changes.theme ?? user.preferences.theme,
          reducedMotion: changes.reducedMotion ?? user.preferences.reducedMotion,
        },
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    });
    await page.route("**/api/auth/change-password", async (route) => {
      passwordBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    });
    await page.route("**/api/auth/logout", async (route) => {
      loggedOut = true;
      await route.fulfill({ status: 204 });
    });

    await page.goto(baseUrl);
    const menu = page.locator("details.avatar-menu");
    await menu.locator("summary").click();
    await menu.getByRole("link", { name: "Thông tin tài khoản" }).click();
    await page.getByRole("heading", { name: "Thông tin tài khoản" }).waitFor();
    await page.getByLabel("Biệt danh").fill("Anh Phong");
    await page.locator("input[name='avatarKey'][value='plum']").check();
    await page.getByLabel("Màu đại diện").fill("#77506e");
    await page.getByLabel("Giao diện").selectOption("dark");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await page.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "false");
    assert.equal(await page.getByText("Đã lưu thông tin của ông.").count(), 0);
    assert.equal(profileBodies[0].nickname, "Anh Phong");
    assert.equal(profileBodies[0].avatarKey, "plum");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");

    if (!await menu.evaluate((details) => details.open)) await menu.locator("summary").click();
    await menu.getByText("Giảm chuyển động").click();
    await page.waitForFunction(() => document.documentElement.dataset.motion === "reduced");
    assert.equal(profileBodies.at(-1).reducedMotion, true);

    await menu.getByRole("link", { name: "Đổi mật khẩu" }).click();
    await page.getByLabel("Mật khẩu hiện tại").fill("current-password");
    await page.getByLabel("Mật khẩu mới", { exact: true }).fill("new-password-123");
    await page.getByLabel("Nhập lại mật khẩu mới").fill("different-password");
    await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(passwordBody, undefined);
    await page.getByLabel("Nhập lại mật khẩu mới").fill("new-password-123");
    await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
    await page.getByText("Đã đổi mật khẩu và đăng xuất các thiết bị cũ.").waitFor();
    assert.equal(passwordBody.currentPassword, "current-password");

    if (!await menu.evaluate((details) => details.open)) await menu.locator("summary").click();
    await menu.getByRole("button", { name: "Đăng xuất" }).click();
    await page.getByRole("heading", { name: "Chào mừng về nhà" }).waitFor();
    assert.equal(loggedOut, true);
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);
    console.log("P1.7 settings: profile, avatar preset, preferences, password and logout = OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
