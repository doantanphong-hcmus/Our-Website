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
    let clawAttempt = {
      id: "00000000-0000-4000-8000-000000000301", status: "ready", seed: 20260928,
      controlTrace: [], capturedPlushId: null, resultSteps: null, version: 1, expiresAt: 2_000_000_000,
    };
    const clawCredits = { balance: 5, packCost: 20, attemptsPerPack: 5, purchasedToday: 1, maximumPacksPerDay: 3 };
    const clawRewardTable = [
      { id: "tiny", label: "Túi sao nhỏ", chancePercent: 55, stars: 1 },
      { id: "sweet", label: "Túi sao xinh", chancePercent: 30, stars: 2 },
      { id: "lucky", label: "Túi sao may mắn", chancePercent: 12, stars: 4 },
      { id: "jackpot", label: "Túi sao lấp lánh", chancePercent: 3, stars: 8 },
    ];
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
    await page.route("**/api/claw/**", async (route) => {
      const url = new URL(route.request().url());
      const body = route.request().postData();
      const input = body ? JSON.parse(body) : {};
      if (url.pathname.endsWith("/collection")) return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ collection: [], rewardTable: clawRewardTable }) });
      if (url.pathname.endsWith("/active")) return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ attempt: clawAttempt, credits: clawCredits }) });
      if (url.pathname.endsWith("/start")) clawAttempt = { ...clawAttempt, status: "playing", version: 2 };
      if (url.pathname.endsWith("/trace")) clawAttempt = { ...clawAttempt, controlTrace: input.controlTrace, version: clawAttempt.version + 1 };
      if (url.pathname.endsWith("/complete")) clawAttempt = { ...clawAttempt, status: input.outcome, capturedPlushId: input.capturedPlushId ?? null,
        resultSteps: input.steps, version: clawAttempt.version + 1 };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ attempt: clawAttempt, credits: clawCredits }) });
    });
    await page.goto(baseUrl);

    await page.getByRole("button", { name: "Mở phần tặng sao" }).click();
    const starPanel = page.locator(".star-panel");
    const bounds = await starPanel.boundingBox();
    assert.ok(bounds && Math.abs(bounds.x + bounds.width / 2 - 180) < 2, "star dialog must be centered on mobile");
    await page.getByRole("button", { name: "Ghi nhận đổi" }).click();
    await page.getByText("Đã ghi nhận đổi").waitFor();
    assert.equal(await page.locator(".star-balance span").textContent(), "70");
    assert.equal(await starPanel.getByRole("link", { name: /Máy gắp thú/ }).getAttribute("href"), "/gap-thu");
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

    user = { ...user, id: "user-nhi", username: "nhi", displayName: "Nhi", nickname: "Nhi",
      color: "#3F6F61", role: "girlfriend", preferences: { theme: "dark", reducedMotion: false } };
    await page.goto(new URL("/gap-thu", baseUrl).href);
    await page.getByRole("heading", { name: "Gắp một bé về nhà" }).waitFor();
    await page.getByText("Bộ sưu tập").waitFor();
    assert.equal(await page.getByText("Quà có thể nhận").count(), 1);
    await page.getByRole("button", { name: "Bắt đầu gắp" }).click();
    const machine = page.locator(".claw-machine canvas");
    await machine.waitFor();
    const machineBounds = await machine.boundingBox();
    assert.ok(machineBounds && machineBounds.width <= 328 && machineBounds.height > machineBounds.width,
      "claw canvas must fit the 360px mobile viewport");
    const right = page.getByRole("button", { name: "Di chuyển càng sang phải" });
    await right.dispatchEvent("pointerdown", { pointerId: 1 });
    await page.waitForTimeout(80);
    await right.dispatchEvent("pointerup", { pointerId: 1 });
    await page.getByRole("button", { name: "THẢ CÀNG" }).click();
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);

    await page.goto(new URL("/khong-ton-tai", baseUrl).href);
    await page.getByRole("heading", { name: "Không tìm thấy trang" }).waitFor();
    console.log("P1.3/E2.6 app shell: routes, mobile claw canvas, collection, controls and preferences = OK");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
