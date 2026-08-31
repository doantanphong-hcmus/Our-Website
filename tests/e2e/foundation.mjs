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

  createCommand = null;
  await phongPage.getByRole("link", { name: "Ăn gì", exact: true }).click();
  await phongPage.getByRole("heading", { name: "Hôm nay mình muốn ăn kiểu nào?" }).waitFor();
  assert.equal(await phongPage.getByText("Chọn quán", { exact: true }).count(), 0);
  await phongPage.getByRole("radio", { name: /Ăn vặt/ }).check();
  await phongPage.getByLabel("Bữa ăn").selectOption("late");
  await phongPage.getByLabel("Danh mục").selectOption("dessert");
  await phongPage.getByText("Dị ứng cần tránh", { exact: true }).click();
  await phongPage.getByLabel("Sữa").check();
  await phongPage.getByText("Món không muốn ăn", { exact: true }).click();
  await phongPage.getByLabel("Hải sản").check();
  await assertA11y(phongPage);
  await phongPage.getByRole("button", { name: "Gửi người kia xác nhận" }).click();
  for (let attempt = 0; attempt < 40 && !createCommand; attempt++) await network.delay(50);
  assert.equal(createCommand.feature, "food_vote");
  assert.deepEqual(createCommand.conditions, {
    foodStyle: "snack", meal: "late", category: "dessert", allergens: ["milk"], exclusions: ["seafood"],
  });
  assert.equal(await phongPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);

  const nhiContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const nhiPage = await nhiContext.newPage();
  await mockAuthenticated(nhiPage, nhi);
  await nhiPage.goto(server.url);
  await nhiPage.getByRole("heading", { name: /Nhi ơi/ }).waitFor();

  let confirmCommand;
  let voteCommand;
  let proxyConfirmCommand;
  let confirmed = false;
  let proxyMode = "none";
  const foodSessionId = "00000000-0000-4000-8000-000000000032";
  await nhiPage.route("**/api/sessions**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname.endsWith("/food-pool")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      dishes: [
        { id: "banh-flan", name: "Bánh flan", foodStyle: "snack", categories: ["dessert"] },
        { id: "mochi", name: "Mochi", foodStyle: "snack", categories: ["dessert"] },
      ],
    }) });
    if (request.method() === "GET" && pathname.endsWith("/food-votes")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ votes: [] }) });
    if (request.method() === "GET" && pathname.endsWith("/food-match")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ match: null }) });
    if (request.method() === "GET" && pathname.endsWith("/food-proxy")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proxyMode === "proxy"
      ? { proxy: { id: "mochi", name: "Mochi", foodStyle: "snack", categories: ["dessert"] }, exhausted: false, confirmedByMe: false, ready: false }
      : { proxy: null, exhausted: proxyMode === "empty", confirmedByMe: false, ready: false }) });
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      eventVersion: 1,
      sessions: [{ id: foodSessionId, feature: "food_vote", status: confirmed ? "active" : "pending", createdByUserId: phong.id, version: confirmed ? 2 : 1, conditions: { foodStyle: "snack", meal: "late", category: "dessert", allergens: ["milk"], exclusions: ["seafood"] } }],
    }) });
    if (pathname.endsWith("/food-votes")) {
      voteCommand = { pathname, body: request.postDataJSON() };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
        vote: voteCommand.body,
        match: { id: "banh-flan", name: "Bánh flan", foodStyle: "snack", categories: ["dessert"] },
      }) });
    }
    if (pathname.endsWith("/food-proxy")) {
      proxyConfirmCommand = request.postDataJSON();
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
        proxy: { id: "mochi", name: "Mochi", foodStyle: "snack", categories: ["dessert"] },
        exhausted: false, confirmedByMe: true, ready: false,
      }) });
    }
    confirmCommand = { pathname, body: request.postDataJSON() };
    confirmed = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { id: foodSessionId, status: "active", version: 2 } }) });
  });
  await nhiPage.getByRole("link", { name: "Ăn gì", exact: true }).click();
  await nhiPage.getByRole("heading", { name: "Xem lại trước khi xác nhận" }).waitFor();
  assert.match(await nhiPage.locator(".food-summary").textContent(), /Ăn vặt.*Ăn khuya.*Tráng miệng.*Sữa.*Hải sản/s);
  await nhiPage.getByRole("button", { name: "Xác nhận thiết lập" }).click();
  for (let attempt = 0; attempt < 40 && !confirmCommand; attempt++) await network.delay(50);
  assert.equal(confirmCommand.pathname, `/api/sessions/${foodSessionId}/join`);
  assert.equal(confirmCommand.body.expectedVersion, 1);
  await nhiPage.getByRole("heading", { name: "Bánh flan" }).waitFor();
  await assertA11y(nhiPage);
  await nhiPage.getByRole("button", { name: "Muốn ăn" }).click();
  for (let attempt = 0; attempt < 40 && !voteCommand; attempt++) await network.delay(50);
  assert.equal(voteCommand.pathname, `/api/sessions/${foodSessionId}/food-votes`);
  assert.equal(voteCommand.body.dishId, "banh-flan");
  assert.equal(voteCommand.body.decision, "want");
  assert.match(voteCommand.body.idempotencyKey, /^[0-9a-f-]{36}$/);
  await nhiPage.getByText("Trùng ý rồi!").waitFor();
  await nhiPage.getByText("Hai đứa đều muốn ăn Bánh flan.").waitFor();
  assert.equal(await nhiPage.getByRole("button", { name: "Muốn ăn" }).count(), 0);
  assert.equal(await nhiPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);

  proxyMode = "proxy";
  await nhiPage.goto(`${server.url}/an-gi`);
  await nhiPage.getByText("Chốt hộ: Mochi").waitFor();
  await nhiPage.getByRole("button", { name: "Đồng ý chốt hộ" }).click();
  for (let attempt = 0; attempt < 40 && !proxyConfirmCommand; attempt++) await network.delay(50);
  assert.match(proxyConfirmCommand.idempotencyKey, /^[0-9a-f-]{36}$/);
  await nhiPage.getByText("Đang chờ người kia xác nhận.").waitFor();
  await assertA11y(nhiPage);

  proxyMode = "empty";
  await nhiPage.reload();
  await nhiPage.getByText("Chưa còn món an toàn để chốt hộ.").waitFor();
  await nhiPage.getByText(/Điều kiện dị ứng vẫn được giữ nguyên/).waitFor();

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

  console.log("P1.14/P2.1/P3.2-P3.8 E2E: private vote/match/proxy, axe, mobile and offline = OK");
  await phongContext.close();
  await nhiContext.close();
} finally {
  await browser?.close().catch(() => {});
  server.close();
}
