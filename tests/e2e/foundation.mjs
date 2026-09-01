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
  let resultCommand;
  let resultCompleted = false;
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
      sessions: resultCompleted ? [] : [{ id: foodSessionId, feature: "food_vote", status: confirmed ? "active" : "pending", createdByUserId: phong.id, version: confirmed ? 2 : 1, conditions: { foodStyle: "snack", meal: "late", category: "dessert", allergens: ["milk"], exclusions: ["seafood"] } }],
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
    if (pathname.endsWith("/food-result")) {
      resultCommand = request.postDataJSON();
      resultCompleted = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        session: { id: foodSessionId, status: "completed", version: 3 },
        result: { id: "banh-flan", name: "Bánh flan", foodStyle: "snack", categories: ["dessert"] },
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
  const snackAnimation = nhiPage.locator(".food-match-animation--snack");
  assert.equal(await snackAnimation.count(), 1);
  assert.equal(await snackAnimation.locator(".food-match-token").count(), 3);
  assert.equal(await snackAnimation.locator(".food-match-token--one").evaluate((element) => getComputedStyle(element).animationDuration), "1.4s");
  await nhiPage.getByLabel("Kết quả chọn món").getByText("Ăn vặt", { exact: true }).waitFor();
  assert.equal(await nhiPage.getByRole("button", { name: "Chọn lại" }).count(), 1);
  await assertA11y(nhiPage);
  await nhiPage.getByRole("button", { name: "Chốt món này" }).click();
  for (let attempt = 0; attempt < 40 && !resultCommand; attempt++) await network.delay(50);
  assert.equal(resultCommand.decision, "accept");
  assert.match(resultCommand.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(await nhiPage.getByRole("button", { name: "Muốn ăn" }).count(), 0);
  assert.equal(await nhiPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);

  let fullMealResult;
  phong.preferences.reducedMotion = true;
  await phongPage.route("**/api/sessions**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const dish = { id: "pho-bo", name: "Phở bò", foodStyle: "full_meal", categories: ["noodle"] };
    if (request.method() === "POST" && pathname.endsWith("/food-result")) {
      fullMealResult = request.postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { id: foodSessionId, status: "completed" }, result: dish }) });
    }
    if (pathname.endsWith("/food-pool")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ dishes: [dish] }) });
    if (pathname.endsWith("/food-votes")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ votes: [] }) });
    if (pathname.endsWith("/food-match")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ match: dish }) });
    if (pathname.endsWith("/food-proxy")) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Đã có kết quả" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eventVersion: 2,
      sessions: [{ id: foodSessionId, feature: "food_vote", status: "active", createdByUserId: phong.id, version: 2,
        conditions: { foodStyle: "full_meal", meal: "dinner", category: "noodle", allergens: [], exclusions: [] } }] }) });
  });
  await phongPage.goto(`${server.url}/an-gi`);
  const fullMealAnimation = phongPage.locator(".food-match-animation--full_meal");
  await fullMealAnimation.waitFor();
  assert.equal(await phongPage.locator("html").getAttribute("data-motion"), "reduced");
  assert.equal(await fullMealAnimation.locator(".food-match-token--one").evaluate((element) => getComputedStyle(element).animationDuration), "0.001s");
  await phongPage.getByText("Hai đứa đều muốn ăn Phở bò.").waitFor();
  await phongPage.getByLabel("Kết quả chọn món").getByText("Ăn no", { exact: true }).waitFor();
  await assertA11y(phongPage);
  await phongPage.getByRole("button", { name: "Chốt món này" }).click();
  for (let attempt = 0; attempt < 40 && !fullMealResult; attempt++) await network.delay(50);
  assert.equal(fullMealResult.decision, "accept");
  assert.equal(await phongPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);
  phong.preferences.reducedMotion = false;

  resultCompleted = false;
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

  let deepSession = null;
  let deepStage = "partner_review";
  let deepRevision = 1;
  const deepConfirmed = new Set();
  const deepCommands = [];
  const deepRoute = (userId) => async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    const consent = () => ({
      stage: deepSession?.status === "active" ? "ready" : deepStage,
      revision: deepRevision,
      confirmedByMe: deepConfirmed.has(userId),
      conditions: deepSession.conditions,
    });
    if (request.method() === "GET" && pathname.endsWith("/deep-talk-consent")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: deepSession, consent: consent() }) });
    }
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      eventVersion: deepSession?.version ?? 0, sessions: deepSession ? [deepSession] : [],
    }) });
    deepCommands.push({ pathname, body });
    if (pathname === "/api/sessions") {
      deepSession = { id: foodSessionId, feature: "deep_talk", status: "pending", createdByUserId: phong.id,
        version: 1, conditions: body.conditions };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ session: deepSession }) });
    }
    if (body.action === "review") {
      deepSession = { ...deepSession, version: 2, conditions: { ...deepSession.conditions, sensitiveTopics: body.sensitiveTopics } };
      deepStage = "final_confirmation";
      deepRevision = 2;
    } else {
      deepConfirmed.add(userId);
      deepSession = { ...deepSession, version: deepSession.version + 1,
        status: deepConfirmed.size === 2 ? "active" : "pending" };
      if (deepSession.status === "active") deepStage = "ready";
    }
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ session: deepSession, consent: consent() }) });
  };
  await phongPage.route("**/api/sessions**", deepRoute(phong.id));
  await nhiPage.route("**/api/sessions**", deepRoute(nhi.id));

  await phongPage.goto(`${server.url}/deep-talk`);
  await phongPage.getByLabel("Mức độ").selectOption("deep");
  await phongPage.getByLabel("Thời lượng gợi ý").selectOption("60");
  const creatorFamily = phongPage.getByRole("group", { name: "Gia đình" });
  assert.equal(await creatorFamily.getByRole("radio").count(), 3);
  await creatorFamily.getByLabel("Đồng ý", { exact: true }).check();
  await phongPage.getByRole("button", { name: "Gửi người kia xem lại" }).click();
  for (let attempt = 0; attempt < 40 && !deepSession; attempt++) await network.delay(50);
  assert.equal(deepCommands[0].body.conditions.level, "deep");
  assert.equal(deepCommands[0].body.conditions.duration, "60");
  assert.match(deepCommands[0].body.idempotencyKey, /^[0-9a-f-]{36}$/);

  await nhiPage.goto(`${server.url}/deep-talk`);
  await nhiPage.getByRole("heading", { name: "Xem lại thiết lập" }).waitFor();
  await nhiPage.getByRole("group", { name: "Gia đình" }).getByLabel("Không đồng ý", { exact: true }).check();
  await nhiPage.getByRole("button", { name: "Xác nhận lựa chọn" }).click();
  for (let attempt = 0; attempt < 40 && deepStage !== "final_confirmation"; attempt++) await network.delay(50);
  assert.equal(deepCommands.at(-1).body.action, "review");

  await phongPage.reload();
  await phongPage.getByRole("heading", { name: "Xác nhận bản cuối" }).waitFor();
  await phongPage.getByText("Không đồng ý", { exact: true }).waitFor();
  await phongPage.getByRole("button", { name: "Tôi xác nhận bản cuối" }).click();
  for (let attempt = 0; attempt < 40 && !deepConfirmed.has(phong.id); attempt++) await network.delay(50);
  await nhiPage.reload();
  await nhiPage.getByRole("button", { name: "Tôi xác nhận bản cuối" }).click();
  for (let attempt = 0; attempt < 40 && deepSession.status !== "active"; attempt++) await network.delay(50);
  await nhiPage.getByRole("heading", { name: "Hai đứa đã thống nhất" }).waitFor();
  assert.equal(deepCommands.filter(({ body }) => body.action === "confirm").length, 2);
  await assertA11y(nhiPage);

  await phongPage.goto(server.url);
  const restore = await network.fail(phongPage, "**/api/sessions");
  await phongPage.reload();
  await phongPage.getByRole("heading", { name: "Chưa xem được các phiên" }).waitFor();
  assert.equal(await phongPage.getByRole("button", { name: "Thử lại" }).count(), 1);
  await restore();

  console.log("P1.14/P2.1/P3.2-P4.2 E2E: food flows and two-device Deep Talk consent = OK");
  await phongContext.close();
  await nhiContext.close();
} finally {
  await browser?.close().catch(() => {});
  server.close();
}
