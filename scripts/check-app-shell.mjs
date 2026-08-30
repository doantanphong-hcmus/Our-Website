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
    await page.route("**/api/auth/session", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { id: "user-phong", coupleSpaceId: "couple-main", displayName: "Phong" } }),
    }));
    await page.goto(baseUrl);

    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    assert.equal(await nav.getByRole("link").count(), 5);
    await nav.getByRole("link", { name: /Đi đâu/ }).click();
    assert.equal(new URL(page.url()).pathname, "/di-dau");
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Đi đâu");
    assert.equal(await nav.getByRole("link", { name: /Đi đâu/ }).getAttribute("aria-current"), "page");
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);

    await page.locator("summary[aria-label='Mở menu tài khoản']").click();
    await page.getByText("Chế độ tối").click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.getByText("Giảm chuyển động").click();
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
