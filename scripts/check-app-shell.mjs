import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.WEB_URL ?? "http://127.0.0.1:4173";

async function main() {
  const response = await fetch(baseUrl).catch(() => null);
  assert.equal(response?.ok, true, "Chạy `npm run web:preview` trước.");

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge",
    headless: true,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    let user = {
      id: "user-phong", coupleSpaceId: "couple-main", username: "phong", displayName: "Phong",
      nickname: "Phong", avatarKey: "initials", color: "#9F3F59", role: "boyfriend",
      preferences: { theme: "system", reducedMotion: false },
    };
    let starWallet = {
      balance: 100, updatedAt: 1,
      activities: [{ id: "listening", label: "Luyện nghe", condition: "Ít nhất 30 phút", points: 10 }],
      rewards: [{ id: "snack", label: "Một món ăn vặt bất kỳ", cost: 30 }], transactions: [],
    };
    await page.route("**/api/auth/session", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user }),
    }));
    await page.route("**/api/auth/profile", async (route) => {
      const changes = route.request().postDataJSON();
      user = { ...user, preferences: { ...user.preferences, ...changes } };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    });
    await page.route("**/api/stars", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ wallet: starWallet }),
    }));
    await page.route("**/api/stars/redeem", async (route) => {
      starWallet = { ...starWallet, balance: 70, transactions: [{
        id: "redeem-1", kind: "redeem", delta: -30, balanceAfter: 70,
        label: "Một món ăn vặt bất kỳ", note: null, createdAt: 1,
      }] };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ wallet: starWallet }) });
    });
    await page.goto(baseUrl);

    await page.getByRole("button", { name: "Mở phần tặng sao" }).click();
    const starPanel = page.locator(".star-panel");
    const bounds = await starPanel.boundingBox();
    assert.ok(bounds && Math.abs(bounds.x + bounds.width / 2 - 180) < 2, "star dialog must be centered on mobile");
    await page.getByRole("button", { name: "Ghi nhận đổi" }).click();
    await page.getByText("Đã ghi nhận đổi").waitFor();
    assert.equal(await page.locator(".star-balance span").textContent(), "70");
    await starPanel.getByRole("button", { name: "Đóng" }).click();

    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    assert.equal(await nav.getByRole("link").count(), 5);
    await nav.getByRole("link", { name: /Đi đâu/ }).click();
    assert.equal(new URL(page.url()).pathname, "/di-dau");
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Coming soon ... em bé hãy đợi anh");
    assert.equal(await nav.getByRole("link", { name: /Đi đâu/ }).getAttribute("aria-current"), "page");
    assert.equal(await nav.locator("svg").count(), 5);
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);

    await page.goto(new URL("/di-dau/xe-tui-mu", baseUrl).href);
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Hai đứa muốn đi xa và chi bao nhiêu?");

    await page.locator("summary[aria-label='Mở menu tài khoản']").click();
    await page.getByText("Chế độ tối").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.locator(".avatar-menu label", { hasText: "Giảm chuyển động" }).locator("input").click();
    await page.waitForFunction(() => document.documentElement.dataset.motion === "reduced");
    assert.equal(await page.locator("html").getAttribute("data-motion"), "reduced");

    await page.goto(new URL("/khong-ton-tai", baseUrl).href);
    await page.getByRole("heading", { name: "Không tìm thấy trang" }).waitFor();
    console.log("P1.3 app shell: routes, navigation, responsive width and preferences = OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
