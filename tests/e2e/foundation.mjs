import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { nhi, phong } from "../fixtures/users.js";
import { assertA11y, mockAuthenticated, network, startWeb } from "../helpers/web-harness.mjs";

const server = await startWeb(4180);
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge", headless: true });
  const phongContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const phongPage = await phongContext.newPage();
  await mockAuthenticated(phongPage, phong, 250);
  await phongPage.goto(server.url);
  await phongPage.locator(".ui-skeleton").first().waitFor();
  await phongPage.getByRole("heading", { name: /Phong ơi/ }).waitFor();
  assert.equal(await phongPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);
  await assertA11y(phongPage);

  const nhiContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const nhiPage = await nhiContext.newPage();
  await mockAuthenticated(nhiPage, nhi);
  await nhiPage.goto(server.url);
  await nhiPage.getByRole("heading", { name: /Nhi ơi/ }).waitFor();

  await network.offline(nhiContext, true);
  await nhiPage.getByText(/Đang ngoại tuyến/).waitFor();
  await network.offline(nhiContext, false);
  await nhiPage.getByText(/Đang ngoại tuyến/).waitFor({ state: "hidden" });

  const restore = await network.fail(phongPage, "**/api/sessions");
  await phongPage.reload();
  await phongPage.getByRole("heading", { name: "Chưa xem được các phiên" }).waitFor();
  assert.equal(await phongPage.getByRole("button", { name: "Thử lại" }).count(), 1);
  await restore();

  console.log("P1.14 E2E: two users, 360/390px, axe, latency, failure and offline controls = OK");
  await phongContext.close();
  await nhiContext.close();
} finally {
  await browser?.close().catch(() => {});
  server.close();
}
