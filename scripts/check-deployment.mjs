import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const url = process.env.DEPLOY_URL?.replace(/\/$/, "");
if (!url || !url.startsWith("https://")) throw new Error("DEPLOY_URL must be an HTTPS URL");

const health = await fetch(`${url}/health`);
assert.equal(health.ok, true, `Health endpoint returned ${health.status}`);
assert.equal((await health.json()).ok, true);

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chrome"), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.goto(url);
  await page.getByRole("heading", { name: "Chào mừng về nhà" }).waitFor();
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);
  console.log(`Deployment smoke OK: ${url}`);
} finally {
  await browser.close();
}
