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
  assert.equal(await phongPage.getByRole("button", { name: "Mở món quà dành cho Nhi" }).count(), 0);
  assert.equal(await phongPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);
  await assertA11y(phongPage);

  let createCommand;
  await phongPage.route("**/api/sessions", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eventVersion: 0, sessions: [] }) });
    createCommand = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ session: { id: crypto.randomUUID(), status: "pending" } }) });
  });
  await phongPage.getByRole("link", { name: "Xé Túi Mù" }).first().click();
  await phongPage.getByRole("heading", { name: "Coming soon ... em bé hãy đợi anh" }).waitFor();
  await assertA11y(phongPage);
  assert.equal(await phongPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);

  createCommand = null;
  await phongPage.getByRole("link", { name: "Ăn gì", exact: true }).click();
  await phongPage.getByRole("heading", { name: "Hôm nay mình muốn ăn kiểu nào?" }).waitFor();
  assert.equal(await phongPage.getByText("Chọn quán", { exact: true }).count(), 0);
  assert.equal(await phongPage.getByText(/Không có bước chọn quán/).count(), 0);
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
  await nhiPage.getByRole("button", { name: "Mở món quà dành cho Nhi" }).click();
  const giftDialog = nhiPage.getByRole("dialog", { name: "Bức thư dành cho Nhi" });
  await giftDialog.waitFor();
  await giftDialog.getByText("From: Phong").waitFor();
  await giftDialog.getByText("To: Nhi").waitFor();
  assert.equal(await giftDialog.getByText("Nhi à", { exact: false }).count(), 0);
  await giftDialog.getByRole("button", { name: "Mở phong bì dành cho Nhi" }).click();
  assert.match(await nhiPage.locator("audio").getAttribute("src"), /gift-letter\.mp3$/);
  await giftDialog.getByText("Nhi à", { exact: false }).waitFor();
  assert.equal(await nhiPage.locator("body").evaluate((body) => body.scrollWidth <= innerWidth), true);
  await assertA11y(nhiPage);
  await giftDialog.getByRole("button", { name: "Đóng bức thư" }).click();
  assert.equal(await giftDialog.count(), 0);

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
  const deepDeckSources = [];
  const deepQuestions = [
    "Điều gì ở bản thân khiến bạn thấy tự hào nhất lúc này?",
    "Bạn muốn người kia hiểu thêm điều gì về mình?",
    "Hai đứa muốn cùng thử điều gì trong thời gian tới?",
  ];
  let deepDeckReady = false;
  let deepProgress = { started: false, startedAt: null, currentPosition: 0, openedPositions: [], skippedPositions: [], turnMode: null,
    playMode: "one", answererUserIds: [], readyUserIds: [], skippedByUserIds: [] };
  let releaseDeepAi;
  const deepAiPending = new Promise((resolve) => { releaseDeepAi = resolve; });
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
    const deckView = () => ({
      deck: { id: "fallback-deck", sessionId: deepSession.id, cardCount: 20, createdAt: 1 },
      players: [{ id: phong.id, name: "Phong", color: "#9F3F59" }, { id: nhi.id, name: "Nhi", color: "#3F6F61" }],
      progress: deepProgress,
      current: { position: deepProgress.currentPosition,
        ...(deepProgress.openedPositions.includes(deepProgress.currentPosition) ? { card: { question: deepQuestions[deepProgress.currentPosition] } } : {}) },
      opened: deepProgress.openedPositions.map((position) => ({ position, card: { question: deepQuestions[position] } })),
    });
    if (request.method() === "GET" && pathname.endsWith("/deep-talk-deck")) {
      return deepDeckReady
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(deckView()) })
        : route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Chưa có bộ bài." }) });
    }
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      eventVersion: deepSession?.version ?? 0, deepTalkPlayedToday: deepDeckReady, sessions: deepSession ? [deepSession] : [],
    }) });
    deepCommands.push({ pathname, body });
    if (pathname.endsWith("/deep-talk-play")) {
      const ids = [phong.id, nhi.id];
      if (body.action === "start") deepProgress = { ...deepProgress, started: true, startedAt: 1_750_000_000,
        turnMode: body.turnMode, playMode: body.playMode, answererUserIds: [body.starterUserId] };
      if (body.action === "reveal") deepProgress = { ...deepProgress, openedPositions: [...deepProgress.openedPositions, deepProgress.currentPosition] };
      if (body.action === "both") deepProgress = { ...deepProgress, answererUserIds: ids };
      if (body.action === "switch") deepProgress = { ...deepProgress, answererUserIds: [ids.find((id) => id !== deepProgress.answererUserIds[0])] };
      const advance = () => {
        const answerer = deepProgress.answererUserIds.length === 1 ? deepProgress.answererUserIds[0] : nhi.id;
        deepProgress = { ...deepProgress, currentPosition: deepProgress.currentPosition + 1,
          readyUserIds: [], skippedByUserIds: [],
          answererUserIds: deepProgress.turnMode === "alternate" ? [ids.find((id) => id !== answerer)] : [answerer] };
      };
      if (body.action === "next") advance();
      if (body.action === "skip") {
        deepProgress = { ...deepProgress, skippedPositions: [...deepProgress.skippedPositions, deepProgress.currentPosition] };
        if (deepProgress.playMode === "two") {
          deepProgress = { ...deepProgress, readyUserIds: [...deepProgress.readyUserIds, userId], skippedByUserIds: [...deepProgress.skippedByUserIds, userId] };
        } else advance();
      }
      if (body.action === "ready") {
        deepProgress = { ...deepProgress, readyUserIds: [...deepProgress.readyUserIds, userId] };
        if (deepProgress.readyUserIds.length === 2) advance();
      }
      deepSession = { ...deepSession, version: deepSession.version + 1, status: body.action === "end" ? "completed" : "active",
        completedAt: body.action === "end" ? 1_750_000_300 : null };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: deepSession, ...deckView() }) });
    }
    if (pathname.endsWith("/deep-talk-deck")) {
      deepDeckSources.push(body.source);
      if (body.source === "ai") {
        await deepAiPending;
        return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "AI phản hồi muộn." }) });
      }
      deepSession = { ...deepSession, version: deepSession.version + 1 };
      deepDeckReady = true;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
        session: deepSession, deck: { id: "fallback-deck", sessionId: deepSession.id, cardCount: 20, createdAt: 1 },
      }) });
    }
    if (pathname === "/api/sessions") {
      deepSession = { id: foodSessionId, feature: "deep_talk", status: "pending", createdByUserId: phong.id,
        version: 1, createdAt: 1_750_000_000, completedAt: null, conditions: body.conditions };
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
  assert.equal(await phongPage.getByRole("group", { name: "Người yêu cũ" }).count(), 0);
  assert.equal(await phongPage.getByText(/Bộ luôn có đúng 20 lá/).count(), 0);
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

  await nhiPage.clock.install();
  await nhiPage.getByRole("button", { name: "Tạo bộ 20 lá" }).click();
  await nhiPage.getByRole("heading", { name: "Đang chuẩn bị 20 lá cho hai đứa" }).waitFor();
  await nhiPage.getByText("Đang xếp nhịp mở lòng cho hai đứa…").waitFor();
  await nhiPage.clock.fastForward(30_000);
  await nhiPage.getByRole("button", { name: "Dùng bộ an toàn có sẵn" }).click();
  await nhiPage.getByRole("heading", { name: "Ai sẽ bắt đầu?" }).waitFor();
  assert.deepEqual(deepDeckSources, ["ai", "fallback"]);
  assert.deepEqual(deepCommands.at(-1).body, {
    expectedVersion: 4, idempotencyKey: deepCommands.at(-1).body.idempotencyKey, source: "fallback",
  });
  assert.match(deepCommands.at(-1).body.idempotencyKey, /^[0-9a-f-]{36}$/);
  await assertA11y(nhiPage);
  await nhiPage.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await nhiPage.getByRole("heading", { name: "Lượt của Nhi" }).waitFor();
  assert.equal(await nhiPage.getByText(deepQuestions[0]).count(), 0, "the face-down card must not render its question");
  const cardInner = nhiPage.locator(".deep-talk-card__inner");
  const normalFlipMs = await cardInner.evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) * 1_000);
  assert.ok(normalFlipMs >= 400 && normalFlipMs <= 700, `flip duration must be 400-700ms, got ${normalFlipMs}`);
  const reducedFlipMs = await cardInner.evaluate((element) => {
    document.documentElement.dataset.motion = "reduced";
    return Number.parseFloat(getComputedStyle(element).transitionDuration) * 1_000;
  });
  assert.ok(reducedFlipMs <= 10, `reduced motion flip must be near-instant, got ${reducedFlipMs}`);
  await nhiPage.evaluate(() => {
    document.documentElement.dataset.motion = "full";
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (duration) => { globalThis.deepTalkVibration = duration; return true; } });
  });
  await nhiPage.getByRole("button", { name: "Lật lá 1" }).click();
  await nhiPage.getByText(deepQuestions[0]).waitFor();
  assert.equal(await nhiPage.evaluate(() => globalThis.deepTalkVibration), 18);
  await nhiPage.getByRole("button", { name: "Cả hai cùng trả lời" }).click();
  await nhiPage.getByRole("heading", { name: "Cả hai cùng trả lời" }).waitFor();
  await nhiPage.getByRole("button", { name: "Tiếp tục" }).click();
  await nhiPage.getByRole("heading", { name: "Lượt của Phong" }).waitFor();
  await nhiPage.getByRole("button", { name: "Bỏ qua" }).click();
  await nhiPage.getByRole("button", { name: "Đổi người" }).click();
  await nhiPage.getByRole("heading", { name: "Lượt của Phong" }).waitFor();
  nhiPage.once("dialog", (dialog) => dialog.accept());
  await nhiPage.getByRole("button", { name: "Kết thúc phiên" }).click();
  await nhiPage.getByRole("heading", { name: "Cảm ơn hai đứa đã lắng nghe nhau" }).waitFor();
  await nhiPage.getByText("Hôm nay đã hết lượt chơi, ngày mai chúng mình chơi lại nhé").waitFor();
  await nhiPage.reload();
  await nhiPage.getByRole("heading", { name: "Cảm ơn hai đứa đã lắng nghe nhau" }).waitFor();
  assert.match(await nhiPage.locator(".deep-talk-summary").textContent(), /Đã chơi1 lá.*Đã bỏ qua1 lá.*Bắt đầu.*Kết thúc/s);
  await nhiPage.getByText("Xem lại câu hỏi đã mở", { exact: true }).click();
  await nhiPage.getByText(deepQuestions[0]).waitFor();
  assert.equal(await nhiPage.getByText(deepQuestions[1]).count(), 0, "review must not render skipped or unopened questions");
  await assertA11y(nhiPage);

  deepSession = { ...deepSession, status: "active", version: 1 };
  deepProgress = { started: false, startedAt: null, currentPosition: 0, openedPositions: [], skippedPositions: [], turnMode: null,
    playMode: "one", answererUserIds: [], readyUserIds: [], skippedByUserIds: [] };
  await nhiPage.reload();
  await nhiPage.getByLabel("Thiết bị chơi").selectOption("two");
  await nhiPage.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await nhiPage.getByRole("button", { name: "Bỏ qua" }).click();
  await phongPage.goto(`${server.url}/deep-talk`);
  await phongPage.getByText("Nhi đã chọn bỏ qua.").waitFor();
  await phongPage.getByText("1/2 người đã sẵn sàng sang lá tiếp theo.").waitFor();
  const swipeCard = phongPage.getByRole("button", { name: "Lật lá 1" });
  await swipeCard.dispatchEvent("pointerdown", { clientX: 240, pointerId: 1 });
  await swipeCard.dispatchEvent("pointerup", { clientX: 120, pointerId: 1 });
  await phongPage.getByText(deepQuestions[0]).waitFor();
  await phongPage.getByRole("button", { name: "Tôi đã sẵn sàng" }).click();
  await phongPage.getByText("Deep Talk · lá 2/20").waitFor();
  await nhiPage.reload();
  await nhiPage.getByText("Deep Talk · lá 2/20").waitFor();
  nhiPage.once("dialog", (dialog) => dialog.accept());
  await nhiPage.getByRole("button", { name: "Kết thúc phiên" }).click();
  releaseDeepAi();

  await phongPage.goto(server.url);
  const restore = await network.fail(phongPage, "**/api/sessions");
  await phongPage.reload();
  await phongPage.getByRole("heading", { name: "Chưa xem được các phiên" }).waitFor();
  assert.equal(await phongPage.getByRole("button", { name: "Thử lại" }).count(), 1);
  await restore();

  console.log("P1.14/P2.1/P3.2-P4.15 E2E: Deep Talk consent, fallback, two-device play and private review = OK");
  await phongContext.close();
  await nhiContext.close();
} finally {
  await browser?.close().catch(() => {});
  server.close();
}
