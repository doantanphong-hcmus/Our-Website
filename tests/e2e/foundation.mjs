import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { nhi, phong } from "../fixtures/users.js";
import { assertA11y, mockAuthenticated, network, startWeb } from "../helpers/web-harness.mjs";

const server = await startWeb(4180);
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chrome"), headless: true });
  const phongContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const phongPage = await phongContext.newPage();
  await mockAuthenticated(phongPage, phong, 250);
  await phongPage.goto(server.url);
  await phongPage.locator(".ui-skeleton").first().waitFor();
  await phongPage.getByRole("heading", { name: /Phong ơi/ }).waitFor();
  assert.equal(await phongPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);
  await assertA11y(phongPage);

  let createCommand;
  await phongPage.route("**/api/sessions", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eventVersion: 0, sessions: [] }) });
    createCommand = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ session: { id: crypto.randomUUID(), status: "pending" } }) });
  });
  await phongPage.getByRole("link", { name: "Xé Túi Mù" }).first().click();
  await phongPage.getByRole("heading", { name: "Hôm nay hai đứa muốn đi thế nào?" }).waitFor();
  await phongPage.getByLabel("Khoảng cách").selectOption("custom");
  await phongPage.getByLabel("Khoảng cách tối đa (km)").fill("12.5");
  await phongPage.getByLabel("Mức bất ngờ").selectOption("bold");
  await assertA11y(phongPage);
  await phongPage.getByRole("button", { name: "Gửi người kia xác nhận" }).click();
  await phongPage.getByText("Đã ghi nhận và đang đồng bộ điều kiện").waitFor();
  for (let attempt = 0; attempt < 40 && !createCommand; attempt++) await network.delay(50);
  assert.equal(createCommand.feature, "blind_bag");
  assert.equal(createCommand.conditions.customDistanceKm, 12.5);
  assert.equal(createCommand.conditions.surprise, "bold");
  assert.match(createCommand.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(await phongPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);

  const nhiContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const nhiPage = await nhiContext.newPage();
  await mockAuthenticated(nhiPage, nhi);
  await nhiPage.goto(server.url);
  await nhiPage.getByRole("heading", { name: /Nhi ơi/ }).waitFor();

  await network.offline(nhiContext, true);
  await nhiPage.getByText(/Đang ngoại tuyến/).waitFor();
  await network.offline(nhiContext, false);
  await nhiPage.getByText(/Đang ngoại tuyến/).waitFor({ state: "hidden" });

  await phongPage.goto(server.url);
  const restore = await network.fail(phongPage, "**/api/sessions");
  await phongPage.reload();
  await phongPage.getByRole("heading", { name: "Chưa xem được các phiên" }).waitFor();
  assert.equal(await phongPage.getByRole("button", { name: "Thử lại" }).count(), 1);
  await restore();

  console.log("P1.14/P2.1 E2E: two users, blind-bag conditions, axe, mobile, latency, failure and offline = OK");
  await phongContext.close();
  await nhiContext.close();
} finally {
  await browser?.close().catch(() => {});
  server.close();
}
