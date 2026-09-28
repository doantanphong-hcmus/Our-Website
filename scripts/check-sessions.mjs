import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = path.join(root, "apps", "worker", "wrangler.jsonc");
const seed = path.join(root, "apps", "worker", "seed.sql");
const state = await mkdtemp(path.join(tmpdir(), "our-website-sessions-"));
const baseUrl = "http://127.0.0.1:8796";
const password = "session check password";
const pepper = "test-only-pepper-at-least-thirty-two-bytes";
const env = { ...process.env, CI: "1", NO_COLOR: "1", XDG_CONFIG_HOME: state, WRANGLER_LOG: "error" };
const blindBagConditions = {
  distance: "under_3", budget: "any", origin: { kind: "address", address: "Chợ Bến Thành, Quận 1" },
};
const foodConditions = {
  foodStyle: "snack", meal: "late", category: "snack",
  allergens: ["milk"], exclusions: ["seafood"],
};
const deepTalkConditions = {
  level: "understand", duration: "30",
  sensitiveTopics: Object.fromEntries([
    "nguoi_yeu_cu", "gia_dinh", "tien_bac", "hon_nhan", "con_cai", "than_mat", "ton_thuong_qua_khu", "mau_thuan_hien_tai",
  ].map((id) => [id, "unset"])),
};
const foodCatalog = JSON.parse(await readFile(path.join(root, "content", "food.v1.json"), "utf8"));
const foodDishById = new Map(foodCatalog.dishes.map((dish) => [dish.id, dish]));
const deepTalkCards = JSON.parse(await readFile(path.join(root, "content", "deep-talk-fallback.v1.json"), "utf8")).cards;
const deepTalkDeckJson = JSON.stringify(deepTalkCards).replaceAll("'", "''");
const samplePhoto = await readFile(path.join(root, "apps", "web", "public", "couple-empty-state.jpg"));

function wranglerCommand(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function passwordHash() {
  const salt = randomBytes(16);
  const peppered = createHmac("sha256", pepper).update(password).digest();
  return `pbkdf2-sha256+pepper$50000$${salt.toString("base64")}$${pbkdf2Sync(peppered, salt, 50_000, 32, "sha256").toString("base64")}`;
}

const local = ["DB", "--local", "--persist-to", state, "--config", config];
wranglerCommand(["d1", "migrations", "apply", ...local]);
wranglerCommand(["d1", "execute", ...local, "--file", seed]);
wranglerCommand(["d1", "execute", ...local, "--command", `
  UPDATE users SET password_hash='${passwordHash()}' WHERE id='user-phong';
  UPDATE users SET password_hash='${passwordHash()}' WHERE id='user-nhi';
  INSERT INTO activity_sessions
    (id,couple_space_id,feature,status,created_by_user_id,idempotency_key,expires_at)
  VALUES ('00000000-0000-4000-8000-000000000001','couple-main','food_vote','pending','user-phong','expired-create-001',unixepoch()-1);
  INSERT INTO activity_sessions
    (id,couple_space_id,feature,status,created_by_user_id,idempotency_key,result_json,completed_at,updated_at)
  VALUES ('00000000-0000-4000-8000-000000000002','couple-main','food_vote','completed','user-phong','recent-food-pool','{"dishPool":["xoi-man"],"foodFinal":{"dishId":"xoi-man","foodStyle":"snack","mode":"dish","source":"match","accepted":true}}',unixepoch(),unixepoch());`]);

for (let index = 1; index <= 1; index++) {
  const sessionId = `00000000-0000-4000-8000-00000000010${index}`;
  wranglerCommand(["d1", "execute", ...local, "--command", `
    INSERT INTO activity_sessions
      (id,couple_space_id,feature,status,created_by_user_id,idempotency_key,payload_json,result_json,completed_at,updated_at)
    VALUES ('${sessionId}','couple-main','deep_talk','completed','user-phong','history-session-${index}',
      '{"conditions":{"level":"understand","duration":"30","sensitiveTopics":{}}}',
      '${index === 1 ? '{"deepTalkProgress":{"currentPosition":2,"openedPositions":[0,1]}}' : '{}'}',unixepoch()-${index},unixepoch()-${index});
    INSERT INTO deep_talk_decks
      (id,session_id,couple_space_id,created_by_user_id,idempotency_key,seed,generation_day,cards_json,created_at)
    VALUES ('history-deck-${index}','${sessionId}','couple-main','user-phong','history-deck-key-${index}',${index},date('now','-1 day','+7 hours'),'${deepTalkDeckJson}',unixepoch()-${index});
    INSERT INTO question_fingerprints (deck_id,position,fingerprint) VALUES ('history-deck-${index}',0,'history-fingerprint-${index}');`]);
}

const server = spawn(process.execPath, [
  wrangler, "dev", "--config", config, "--ip", "127.0.0.1", "--port", "8796", "--persist-to", state,
  "--var", `AUTH_PEPPER:${pepper}`,
], { cwd: root, env, stdio: "ignore", windowsHide: true });
server.unref();

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await fetch(`${baseUrl}/health`).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Session Worker did not start");
}

async function login(username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

async function request(pathname, cookie, method = "GET", input) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { Cookie: cookie, ...(input ? { "Content-Type": "application/json" } : {}) },
    body: input ? JSON.stringify(input) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${pathname}: ${response.status} ${text}`); }
  return { response, data };
}

async function mediaRequest(pathname, cookie, body, idempotencyKey = "upload-private-photo-001") {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "image/jpeg", "X-Idempotency-Key": idempotencyKey },
    body,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${pathname}: ${response.status} ${text}`); }
  return { response, data };
}

async function create(cookie, feature, idempotencyKey, conditions = foodConditions) {
  return request("/api/sessions", cookie, "POST", {
    feature, idempotencyKey,
    conditions: feature === "blind_bag" ? blindBagConditions : feature === "deep_talk" ? deepTalkConditions : conditions,
  });
}

async function act(cookie, id, action, expectedVersion, idempotencyKey) {
  return request(`/api/sessions/${id}/${action}`, cookie, "POST", { expectedVersion, idempotencyKey });
}

try {
  await waitUntilReady();
  assert.equal((await fetch(`${baseUrl}/api/sessions`)).status, 401);
  const phong = await login("phong");
  const nhi = await login("nhi");

  const emptyWallet = await request("/api/stars", nhi);
  assert.equal(emptyWallet.response.status, 200);
  assert.equal(emptyWallet.data.wallet.balance, 0);
  assert.equal(emptyWallet.data.wallet.activities.length, 8);
  assert.equal(emptyWallet.data.wallet.rewards.length, 7);
  const emptyCredits = await request("/api/claw/credits", nhi);
  assert.equal(emptyCredits.response.status, 200);
  assert.equal(emptyCredits.data.credits.balance, 0);
  assert.equal(emptyCredits.data.credits.packCost, 20);
  assert.equal(emptyCredits.data.credits.attemptsPerPack, 5);
  assert.equal((await request("/api/claw/credits/purchase", nhi, "POST", {
    idempotencyKey: "insufficient-claw-stars-01",
  })).response.status, 409);
  assert.equal((await request("/api/claw/credits/purchase", phong, "POST", {
    idempotencyKey: "phong-cannot-buy-claw-01",
  })).response.status, 403);
  assert.equal((await request("/api/stars/award", nhi, "POST", {
    activityId: "listening", idempotencyKey: "nhi-cannot-award-01",
  })).response.status, 403);
  assert.equal((await request("/api/stars/award", phong, "POST", {
    activityId: "special", points: 20, idempotencyKey: "special-no-note-01",
  })).response.status, 400);
  const award = await request("/api/stars/award", phong, "POST", {
    activityId: "listening", note: "Em học chăm lắm", idempotencyKey: "award-listening-01",
  });
  assert.equal(award.response.status, 201);
  assert.equal(award.data.wallet.balance, 10);
  assert.equal(award.data.transaction.delta, 10);
  const duplicateAward = await request("/api/stars/award", phong, "POST", {
    activityId: "listening", note: "Em học chăm lắm", idempotencyKey: "award-listening-01",
  });
  assert.equal(duplicateAward.response.status, 200);
  assert.equal(duplicateAward.data.duplicate, true);
  assert.equal(duplicateAward.data.wallet.balance, 10);
  assert.equal((await request("/api/stars/award", phong, "POST", {
    activityId: "listening", idempotencyKey: "award-listening-02",
  })).response.status, 409, "daily activities may only be awarded once per Vietnam day");
  const firstCelebration = await request("/api/stars/celebrations/claim", nhi, "POST");
  assert.equal(firstCelebration.response.status, 200);
  assert.deepEqual(firstCelebration.data.celebrations.map((item) => item.delta), [10]);
  assert.deepEqual((await request("/api/stars/celebrations/claim", nhi, "POST")).data.celebrations, [],
    "reload must not replay a claimed celebration");
  assert.equal((await request("/api/stars", nhi)).data.wallet.transactions.length, 1);
  assert.equal((await request("/api/stars/redeem", nhi, "POST", {
    rewardId: "snack", idempotencyKey: "nhi-cannot-redeem-01",
  })).response.status, 403);
  assert.equal((await request("/api/stars/redeem", phong, "POST", {
    rewardId: "snack", idempotencyKey: "insufficient-stars-01",
  })).response.status, 409);
  const specialAward = await request("/api/stars/award", phong, "POST", {
    activityId: "special", points: 100, note: "Thưởng để kiểm tra đổi quà", idempotencyKey: "award-special-redeem-01",
  });
  assert.equal(specialAward.data.wallet.balance, 110);
  const redemptions = await Promise.all([
    request("/api/stars/redeem", phong, "POST", { rewardId: "snack", idempotencyKey: "redeem-snack-double-01" }),
    request("/api/stars/redeem", phong, "POST", { rewardId: "snack", idempotencyKey: "redeem-snack-double-01" }),
  ]);
  assert.deepEqual(redemptions.map((item) => item.response.status).sort(), [200, 201]);
  assert.equal(redemptions[0].data.wallet.balance, 80);
  assert.equal(redemptions[1].data.wallet.balance, 80);
  assert.equal(redemptions.filter((item) => item.data.duplicate).length, 1);
  assert.equal((await request("/api/stars/redeem", phong, "POST", {
    rewardId: "vietnam_trip", idempotencyKey: "insufficient-trip-01",
  })).response.status, 409);
  const redeemedWallet = (await request("/api/stars", nhi)).data.wallet;
  assert.equal(redeemedWallet.balance, 80);
  assert.deepEqual(redeemedWallet.transactions.map((item) => item.delta), [-30, 100, 10]);

  const clawPurchases = await Promise.all([
    request("/api/claw/credits/purchase", nhi, "POST", { idempotencyKey: "buy-claw-pack-double-01" }),
    request("/api/claw/credits/purchase", nhi, "POST", { idempotencyKey: "buy-claw-pack-double-01" }),
  ]);
  assert.deepEqual(clawPurchases.map((item) => item.response.status).sort(), [200, 201]);
  assert.equal(clawPurchases[0].data.credits.balance, 5);
  assert.equal(clawPurchases[1].data.credits.balance, 5);
  assert.equal(clawPurchases.filter((item) => item.data.duplicate).length, 1);
  assert.equal((await request("/api/claw/credits/purchase", nhi, "POST", {
    idempotencyKey: "award-listening-01",
  })).response.status, 409, "an idempotency key cannot be reused across ledgers");
  assert.equal((await request("/api/claw/credits/purchase", nhi, "POST", {
    idempotencyKey: "buy-claw-pack-02",
  })).response.status, 201);
  assert.equal((await request("/api/claw/credits/purchase", nhi, "POST", {
    idempotencyKey: "buy-claw-pack-03",
  })).response.status, 201);
  const fullCredits = await request("/api/claw/credits", nhi);
  assert.deepEqual({ balance: fullCredits.data.credits.balance, purchasedToday: fullCredits.data.credits.purchasedToday },
    { balance: 15, purchasedToday: 3 });
  assert.equal((await request("/api/claw/credits/purchase", nhi, "POST", {
    idempotencyKey: "buy-claw-pack-04",
  })).response.status, 409, "only three packs may be purchased per Vietnam day");
  assert.equal((await request("/api/stars", nhi)).data.wallet.balance, 20,
    "three packs must spend exactly 60 stars");

  const replayedDeck = await request("/api/sessions/00000000-0000-4000-8000-000000000101/deep-talk-deck", phong, "POST", {
    expectedVersion: 1, idempotencyKey: "history-deck-key-1",
  });
  assert.equal(replayedDeck.response.status, 200);
  assert.equal(replayedDeck.data.duplicate, true);
  assert.equal(replayedDeck.data.deck.cardCount, 20);
  assert.doesNotMatch(JSON.stringify(replayedDeck.data), /seed|cards|question/i);
  const resumedDeck = await request("/api/sessions/00000000-0000-4000-8000-000000000101/deep-talk-deck", phong);
  assert.equal(resumedDeck.response.status, 200);
  assert.deepEqual(resumedDeck.data.current, { position: 2 });
  assert.deepEqual(resumedDeck.data.opened.map((item) => item.position), [0, 1]);
  assert.equal(resumedDeck.data.opened.length, 2);
  assert.deepEqual(resumedDeck.data.progress, {
    started: false, startedAt: null, currentPosition: 2, openedPositions: [0, 1], skippedPositions: [], turnMode: null, playMode: "one",
    answererUserIds: [], readyUserIds: [], skippedByUserIds: [],
  });
  assert.equal(JSON.stringify(resumedDeck.data).includes(deepTalkCards[3].question), false,
    "unopened cards must stay server-side");
  assert.deepEqual((await request("/api/sessions/00000000-0000-4000-8000-000000000101/deep-talk-deck", nhi)).data, resumedDeck.data,
    "both authorized partners must see the same current and opened cards");

  const initial = await request("/api/sessions", phong);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.data.deepTalkPlayedToday, false);
  assert.equal(initial.data.sessions.find((item) => item.feature === "food_vote").status, "expired");

  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "missing-conditions-1",
  })).response.status, 400);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "bad-custom-distance", conditions: { ...blindBagConditions, distance: "custom", customDistanceKm: 0 },
  })).response.status, 400);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "bad-origin-coordinates", conditions: { ...blindBagConditions, origin: { kind: "current", latitude: 91, longitude: 106.7, accuracyMeters: 20 } },
  })).response.status, 400);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "bad-origin-address", conditions: { ...blindBagConditions, origin: { kind: "address", address: "  x  " } },
  })).response.status, 400);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "food_vote", idempotencyKey: "bad-food-style-01", conditions: { ...foodConditions, foodStyle: "restaurant" },
  })).response.status, 400);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "food_vote", idempotencyKey: "bad-food-tags-001", conditions: { ...foodConditions, allergens: ["unknown"] },
  })).response.status, 400);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "food_vote", idempotencyKey: "bad-food-category", conditions: { ...foodConditions, category: "hotpot" },
  })).response.status, 400);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "deep_talk", idempotencyKey: "bad-deep-consent",
    conditions: { ...deepTalkConditions, sensitiveTopics: { gia_dinh: "allow" } },
  })).response.status, 400);

  const created = await create(phong, "blind_bag", "create-blind-001");
  assert.equal(created.response.status, 201);
  assert.equal(created.data.session.status, "pending");
  assert.deepEqual(created.data.session.conditions, blindBagConditions);
  assert.deepEqual(created.data.session.confirmation, { revision: 1, confirmedUserIds: ["user-phong"] });
  const sessionId = created.data.session.id;
  const replayCreate = await create(phong, "blind_bag", "create-blind-001");
  assert.equal(replayCreate.response.status, 200);
  assert.equal(replayCreate.data.duplicate, true);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "create-blind-001", conditions: { ...blindBagConditions, budget: "under_200k" },
  })).response.status, 409);
  assert.equal((await create(phong, "deep_talk", "create-blind-001")).response.status, 409);
  assert.equal((await create(nhi, "blind_bag", "create-blind-002")).response.status, 409);
  assert.equal((await act(phong, sessionId, "join", 1, "join-blind-owner")).response.status, 409);

  const confirmationPath = `/api/sessions/${sessionId}/blind-bag-confirmation`;
  assert.equal((await request(confirmationPath, nhi, "POST", {
    action: "revise", expectedVersion: 1, conditions: blindBagConditions, idempotencyKey: "revise-blind-same",
  })).response.status, 400);
  const revisedConditions = { ...blindBagConditions, budget: "under_200k" };
  const revised = await request(confirmationPath, nhi, "POST", {
    action: "revise", expectedVersion: 1, conditions: revisedConditions, idempotencyKey: "revise-blind-001",
  });
  assert.equal(revised.response.status, 201);
  assert.equal(revised.data.session.status, "pending");
  assert.equal(revised.data.session.version, 2);
  assert.deepEqual(revised.data.session.conditions, revisedConditions);
  assert.deepEqual(revised.data.session.confirmation, { revision: 2, confirmedUserIds: ["user-nhi"] });
  assert.equal((await request(confirmationPath, nhi, "POST", {
    action: "revise", expectedVersion: 1, conditions: revisedConditions, idempotencyKey: "revise-blind-001",
  })).data.duplicate, true);
  const confirmed = await request(confirmationPath, phong, "POST", {
    action: "confirm", expectedVersion: 2, idempotencyKey: "confirm-blind-001",
  });
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.data.session.status, "active");
  assert.deepEqual(confirmed.data.session.confirmation, { revision: 2, confirmedUserIds: ["user-nhi", "user-phong"] });
  assert.equal((await act(phong, sessionId, "cancel", 2, "cancel-stale-001")).response.status, 409);
  assert.equal((await act(phong, sessionId, "complete", 3, "complete-blind-too-early")).response.status, 409);
  const cancelled = await act(phong, sessionId, "cancel", 3, "cancel-blind-001");
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.data.session.status, "cancelled");

  const tearConditions = { distance: "custom", customDistanceKm: 35, budget: "any",
    origin: { kind: "current", latitude: 10.7769, longitude: 106.7009, accuracyMeters: 25 } };
  const bag = await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "create-ready-bag", conditions: tearConditions,
  });
  assert.equal(bag.response.status, 201);
  const bagId = bag.data.session.id;
  const bagPath = `/api/sessions/${bagId}/blind-bag-tear`;
  assert.equal((await request(bagPath, phong, "POST", { action: "ready", expectedVersion: 1, idempotencyKey: "ready-too-early" })).response.status, 409);
  const bagConfirmed = await request(`/api/sessions/${bagId}/blind-bag-confirmation`, nhi, "POST", {
    action: "confirm", expectedVersion: 1, idempotencyKey: "confirm-ready-bag",
  });
  assert.equal(bagConfirmed.data.session.status, "active");
  assert.deepEqual(bagConfirmed.data.session.tear, { readyUserIds: [], progress: 0, phase: "waiting", tornByUserId: null,
    reroll: { usedByUserIds: [], rejectedByUserIds: [] } });
  assert.equal((await request(bagPath, phong, "POST", { action: "tear", expectedVersion: 2, idempotencyKey: "tear-too-early" })).response.status, 409);
  assert.equal((await request(bagPath, phong, "POST", { action: "report", reason: "safety", expectedVersion: 2,
    idempotencyKey: "report-too-early" })).response.status, 409);
  const firstReady = await request(bagPath, phong, "POST", { action: "ready", expectedVersion: 2, idempotencyKey: "ready-phong-bag" });
  assert.equal(firstReady.response.status, 201);
  assert.deepEqual(firstReady.data.session.tear.readyUserIds, ["user-phong"]);
  assert.equal((await request(bagPath, phong, "POST", { action: "ready", expectedVersion: 3, idempotencyKey: "ready-phong-again" })).response.status, 409);
  const secondReady = await request(bagPath, nhi, "POST", { action: "ready", expectedVersion: 3, idempotencyKey: "ready-nhi-bag" });
  assert.deepEqual(secondReady.data.session.tear.readyUserIds, ["user-phong", "user-nhi"]);
  const torn = await request(bagPath, phong, "POST", { action: "tear", expectedVersion: 4, idempotencyKey: "tear-phong-bag" });
  assert.equal(torn.response.status, 201);
  assert.equal(torn.data.session.tear.phase, "tearing");
  assert.equal(JSON.stringify(torn.data).includes("selectedPlaceId"), false, "place must stay hidden before result card");
  assert.equal(torn.data.session.result, undefined, "result must stay hidden until tear completes");
  assert.equal((await request(bagPath, nhi, "POST", { action: "tear_progress", progress: 50, expectedVersion: 5,
    idempotencyKey: "progress-wrong-user" })).response.status, 409);
  const halfway = await request(bagPath, phong, "POST", { action: "tear_progress", progress: 50, expectedVersion: 5,
    idempotencyKey: "progress-halfway" });
  assert.equal(halfway.data.session.tear.progress, 50);
  assert.equal((await request(bagPath, phong, "POST", { action: "tear_progress", progress: 50, expectedVersion: 6,
    idempotencyKey: "progress-backward" })).response.status, 409);
  const finished = await request(bagPath, phong, "POST", { action: "tear_progress", progress: 100, expectedVersion: 6,
    idempotencyKey: "progress-finished" });
  assert.equal(finished.data.session.tear.phase, "torn");
  assert.ok(finished.data.session.result?.name && finished.data.session.result?.address);
  assert.ok(finished.data.session.result?.distanceKm >= 0);
  assert.ok(finished.data.session.result?.challenge, "every selected place needs a safe challenge");
  assert.equal("price" in finished.data.session.result, false);
  assert.deepEqual((await request(bagPath, nhi)).data.session.result, finished.data.session.result);
  assert.equal((await request(bagPath, nhi)).data.session.tear.progress, 100);
  assert.equal((await request(bagPath, phong, "POST", { action: "tear_progress", progress: 100, expectedVersion: 6,
    idempotencyKey: "progress-finished" })).data.duplicate, true);
  const firstRejected = await request(bagPath, phong, "POST", { action: "reroll", reason: "reject", expectedVersion: 7,
    idempotencyKey: "reject-first-place" });
  assert.deepEqual(firstRejected.data.session.tear.reroll, { usedByUserIds: [], rejectedByUserIds: ["user-phong"] });
  assert.deepEqual(firstRejected.data.session.result, finished.data.session.result, "one rejection must wait for partner");
  assert.equal((await request(bagPath, phong, "POST", { action: "reroll", reason: "reject", expectedVersion: 8,
    idempotencyKey: "reject-first-again" })).response.status, 409);
  const bothRejected = await request(bagPath, nhi, "POST", { action: "reroll", reason: "reject", expectedVersion: 8,
    idempotencyKey: "reject-second-place" });
  assert.notEqual(bothRejected.data.session.result.name, finished.data.session.result.name);
  assert.deepEqual(bothRejected.data.session.tear.reroll, { usedByUserIds: [], rejectedByUserIds: [] });
  const personalReroll = await request(bagPath, phong, "POST", { action: "reroll", reason: "change", expectedVersion: 9,
    idempotencyKey: "reroll-phong-once" });
  assert.notEqual(personalReroll.data.session.result.name, bothRejected.data.session.result.name);
  assert.deepEqual(personalReroll.data.session.tear.reroll.usedByUserIds, ["user-phong"]);
  assert.equal((await request(bagPath, phong, "POST", { action: "reroll", reason: "change", expectedVersion: 10,
    idempotencyKey: "reroll-phong-twice" })).response.status, 409);
  const safetyReroll = await request(bagPath, nhi, "POST", { action: "reroll", reason: "safety", expectedVersion: 10,
    idempotencyKey: "reroll-safety-free" });
  assert.notEqual(safetyReroll.data.session.result.name, personalReroll.data.session.result.name);
  assert.deepEqual(safetyReroll.data.session.tear.reroll.usedByUserIds, ["user-phong"], "safety reroll must be free");
  assert.equal(new Set([finished.data.session.result.name, bothRejected.data.session.result.name,
    personalReroll.data.session.result.name, safetyReroll.data.session.result.name]).size, 4, "rerolls must not repeat in-session");
  assert.equal((await request(bagPath, nhi, "POST", { action: "report", reason: "bogus", expectedVersion: 11,
    idempotencyKey: "report-invalid-reason" })).response.status, 400);
  const reported = await request(bagPath, nhi, "POST", { action: "report", reason: "safety", expectedVersion: 11,
    idempotencyKey: "report-place-safety" });
  assert.equal(reported.response.status, 201);
  assert.deepEqual(reported.data.session.result, safetyReroll.data.session.result);
  const accepted = await request(bagPath, nhi, "POST", { action: "accept", expectedVersion: 12,
    idempotencyKey: "accept-blind-bag" });
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.data.session.travel.state, "traveling");
  assert.equal(accepted.data.session.travel.acceptedByUserId, "user-nhi");
  assert.deepEqual((await request(bagPath, phong)).data.session.travel, accepted.data.session.travel,
    "both users must resume the same travel state");
  assert.equal((await request(bagPath, nhi, "POST", { action: "accept", expectedVersion: 12,
    idempotencyKey: "accept-blind-bag" })).data.duplicate, true);
  assert.equal((await request(bagPath, phong, "POST", { action: "reroll", reason: "change", expectedVersion: 13,
    idempotencyKey: "reroll-after-accept" })).response.status, 409);
  const mediaPath = `/api/sessions/${bagId}/media`;
  assert.equal((await fetch(`${baseUrl}${mediaPath}`)).status, 401, "private media must require login");
  assert.equal((await mediaRequest(mediaPath, phong, Buffer.alloc(0), "upload-before-check-in")).response.status, 409);
  const checkInPath = `/api/sessions/${bagId}/blind-bag-check-in`;
  const outside = await request(checkInPath, nhi, "POST", { action: "verify", expectedVersion: 13,
    idempotencyKey: "check-in-too-far", position: { latitude: 0, longitude: 0, accuracyMeters: 10 } });
  assert.equal(outside.response.status, 422);
  const uncertainPosition = { latitude: accepted.data.session.result.latitude, longitude: accepted.data.session.result.longitude,
    accuracyMeters: 1_000 };
  const manualRequested = await request(checkInPath, nhi, "POST", { action: "verify", expectedVersion: 13,
    idempotencyKey: "check-in-uncertain-gps", position: uncertainPosition });
  assert.equal(manualRequested.response.status, 201);
  assert.deepEqual(manualRequested.data.session.checkIn, { status: "awaiting_partner", method: "manual",
    radiusMeters: manualRequested.data.session.checkIn.radiusMeters, startedByUserId: "user-nhi",
    startedAt: manualRequested.data.session.checkIn.startedAt, confirmedUserIds: ["user-nhi"], manualReason: "gps_uncertain" });
  assert.ok([150, 300, 500].includes(manualRequested.data.session.checkIn.radiusMeters));
  assert.equal((await request(checkInPath, nhi, "POST", { action: "verify", expectedVersion: 13,
    idempotencyKey: "check-in-uncertain-gps", position: uncertainPosition })).data.duplicate, true);
  assert.equal((await request(checkInPath, nhi, "POST", { action: "confirm", expectedVersion: 14,
    idempotencyKey: "check-in-self-confirm" })).response.status, 409);
  const checkedIn = await request(checkInPath, phong, "POST", { action: "confirm", expectedVersion: 14,
    idempotencyKey: "check-in-partner-confirm" });
  assert.equal(checkedIn.data.session.checkIn.status, "confirmed");
  assert.equal(checkedIn.data.session.checkIn.method, "manual");
  assert.deepEqual(checkedIn.data.session.checkIn.confirmedUserIds, ["user-nhi", "user-phong"]);
  assert.deepEqual((await request(checkInPath, nhi)).data.session.checkIn, checkedIn.data.session.checkIn,
    "manual check-in audit must survive reload");
  const wrongMime = await fetch(`${baseUrl}${mediaPath}`, {
    method: "POST", headers: { Cookie: phong, "Content-Type": "text/plain", "X-Idempotency-Key": "upload-wrong-mime" },
  });
  assert.equal(wrongMime.status, 415);
  const uploaded = await mediaRequest(mediaPath, phong, samplePhoto);
  assert.equal(uploaded.response.status, 201);
  assert.match(uploaded.data.media.id, /^[0-9a-f-]{36}$/i);
  assert.match(uploaded.data.media.url, new RegExp(`${bagId}/media/${uploaded.data.media.id}$`));
  assert.equal(uploaded.data.media.mimeType, "image/jpeg");
  assert.equal(uploaded.data.media.byteSize, samplePhoto.length);
  assert.ok(uploaded.data.media.width > 0 && uploaded.data.media.height > 0);
  const replayedPhoto = await mediaRequest(mediaPath, phong, samplePhoto);
  assert.equal(replayedPhoto.response.status, 200);
  assert.equal(replayedPhoto.data.duplicate, true);
  assert.equal(replayedPhoto.data.media.id, uploaded.data.media.id, "upload retry must not duplicate media");
  const partnerMedia = await request(mediaPath, nhi);
  assert.deepEqual(partnerMedia.data.media, [uploaded.data.media], "both partners must see the same private media");
  const privatePhoto = await fetch(`${baseUrl}${uploaded.data.media.url}`, { headers: { Cookie: nhi } });
  assert.equal(privatePhoto.status, 200);
  assert.equal(privatePhoto.headers.get("content-type"), "image/jpeg");
  assert.equal(privatePhoto.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await privatePhoto.arrayBuffer()), samplePhoto);
  assert.equal((await request(`${mediaPath}/00000000-0000-4000-8000-000000000099`, phong)).response.status, 404);
  const completePath = `/api/sessions/${bagId}/blind-bag-complete`;
  const firstCompletion = await request(completePath, phong, "POST", {
    challengeOutcome: "completed", expectedVersion: 15, idempotencyKey: "complete-ready-bag-phong",
  });
  assert.equal(firstCompletion.response.status, 201);
  assert.equal(firstCompletion.data.session.status, "active");
  assert.deepEqual(firstCompletion.data.session.completion.confirmedUserIds, ["user-phong"]);
  const finalAttempts = await Promise.all([
    request(completePath, nhi, "POST", {
      challengeOutcome: "skipped", expectedVersion: 16, idempotencyKey: "complete-ready-bag-nhi-1",
    }),
    request(completePath, nhi, "POST", {
      challengeOutcome: "skipped", expectedVersion: 16, idempotencyKey: "complete-ready-bag-nhi-2",
    }),
  ]);
  assert.deepEqual(finalAttempts.map((item) => item.response.status).sort(), [201, 409],
    "double tap must complete exactly once");
  const completedBag = finalAttempts.find((item) => item.response.status === 201);
  assert.equal(completedBag.data.session.status, "completed");
  assert.equal(completedBag.data.session.completion.challengeOutcome, "skipped");
  assert.match(completedBag.data.session.completion.visitId, /^[0-9a-f-]{36}$/i);
  assert.match(completedBag.data.session.completion.stampId, /^[0-9a-f-]{36}$/i);
  assert.equal(completedBag.data.session.completion.stampNumber, 1);
  const replayedCompletion = await request(completePath, nhi, "POST", {
    challengeOutcome: "skipped", expectedVersion: 16,
    idempotencyKey: finalAttempts[0].response.status === 201 ? "complete-ready-bag-nhi-1" : "complete-ready-bag-nhi-2",
  });
  assert.equal(replayedCompletion.data.duplicate, true);
  assert.equal(replayedCompletion.data.session.completion.visitId, completedBag.data.session.completion.visitId,
    "completion retry must not duplicate the visit");
  assert.equal(replayedCompletion.data.session.completion.stampId, completedBag.data.session.completion.stampId,
    "completion retry must not duplicate the stamp");
  const declinedSession = await request("/api/sessions", nhi, "POST", {
    feature: "blind_bag", idempotencyKey: "create-decline-001",
    conditions: { ...blindBagConditions, origin: { kind: "current", latitude: 10.7769, longitude: 106.7009, accuracyMeters: 25 } },
  });
  assert.equal(declinedSession.response.status, 201);
  const declined = await act(phong, declinedSession.data.session.id, "decline", 1, "decline-blind-001");
  assert.equal(declined.data.session.status, "declined");

  const simultaneous = await Promise.all([
    create(phong, "food_vote", "create-food-phong"),
    create(nhi, "food_vote", "create-food-nhi01"),
  ]);
  assert.deepEqual(simultaneous.map((item) => item.response.status).sort(), [201, 409]);
  const open = simultaneous.find((item) => item.response.status === 201).data.session;
  const creatorCookie = open.createdByUserId === "user-phong" ? phong : nhi;
  const partnerCookie = open.createdByUserId === "user-phong" ? nhi : phong;
  assert.deepEqual(open.conditions, foodConditions);
  assert.equal((await request(`/api/sessions/${open.id}/food-pool`, creatorCookie)).response.status, 409);
  assert.equal((await request(`/api/sessions/${open.id}/food-votes`, creatorCookie)).response.status, 409);
  assert.equal((await request(`/api/sessions/${open.id}/food-match`, creatorCookie)).response.status, 409);
  const foodConfirmed = await act(partnerCookie, open.id, "join", 1, "confirm-food-001");
  assert.equal(foodConfirmed.data.session.status, "active");
  assert.deepEqual(foodConfirmed.data.session.conditions, foodConditions);
  const [creatorPool, partnerPool] = await Promise.all([
    request(`/api/sessions/${open.id}/food-pool`, creatorCookie),
    request(`/api/sessions/${open.id}/food-pool`, partnerCookie),
  ]);
  assert.equal(creatorPool.response.status, 200);
  assert.equal(partnerPool.response.status, 200);
  const creatorIds = creatorPool.data.dishes.map((dish) => dish.id);
  const partnerIds = partnerPool.data.dishes.map((dish) => dish.id);
  assert.deepEqual([...creatorIds].sort(), [...partnerIds].sort());
  if (creatorIds.length > 1) assert.notDeepEqual(creatorIds, partnerIds);
  assert.deepEqual((await request(`/api/sessions/${open.id}/food-pool`, creatorCookie)).data, creatorPool.data, "order must survive reload");
  assert.deepEqual(Object.keys(creatorPool.data), ["dishes"], "shuffle seed and partner order must stay server-side");
  assert.ok(creatorPool.data.dishes.length > 0 && creatorPool.data.dishes.length <= 8);
  assert.ok(!creatorPool.data.dishes.some((dish) => dish.id === "xoi-man"), "recent dishes must be deprioritized while fresh choices exist");
  for (const item of creatorPool.data.dishes) {
    const dish = foodDishById.get(item.id);
    assert.equal(dish.foodStyle, foodConditions.foodStyle);
    assert.ok(dish.categories.includes(foodConditions.category));
    assert.ok(!dish.possibleAllergens.some((tag) => foodConditions.allergens.includes(tag)));
    assert.ok(!dish.exclusionTags.some((tag) => foodConditions.exclusions.includes(tag)));
  }
  const votesPath = `/api/sessions/${open.id}/food-votes`;
  const matchPath = `/api/sessions/${open.id}/food-match`;
  assert.deepEqual((await request(votesPath, creatorCookie)).data, { votes: [] });
  assert.deepEqual((await request(votesPath, partnerCookie)).data, { votes: [] });
  assert.deepEqual((await request(matchPath, creatorCookie)).data, { match: null });
  assert.equal((await request(votesPath, creatorCookie, "POST", {
    dishId: "not-in-pool", decision: "want", idempotencyKey: "vote-invalid-dish",
  })).response.status, 400);
  const firstVote = await request(votesPath, creatorCookie, "POST", {
    dishId: creatorIds[0], decision: "want", idempotencyKey: "vote-food-want-01",
  });
  assert.equal(firstVote.response.status, 201);
  assert.deepEqual(firstVote.data.vote, { dishId: creatorIds[0], decision: "want" });
  assert.equal((await request(votesPath, creatorCookie, "POST", {
    dishId: creatorIds[0], decision: "want", idempotencyKey: "vote-food-want-01",
  })).data.duplicate, true);
  assert.equal((await request(votesPath, creatorCookie, "POST", {
    dishId: creatorIds[0], decision: "no", idempotencyKey: "vote-change-blocked",
  })).response.status, 409);
  if (creatorIds[1]) {
    assert.equal((await request(votesPath, creatorCookie, "POST", {
      dishId: creatorIds[1], decision: "skip", idempotencyKey: "vote-food-skip-01",
    })).response.status, 201);
  }
  assert.deepEqual((await request(votesPath, partnerCookie)).data, { votes: [] }, "partner must not see creator votes");
  assert.equal((await request(votesPath, partnerCookie, "POST", {
    dishId: creatorIds[0], decision: "no", idempotencyKey: "vote-partner-no-01",
  })).response.status, 201);
  const ownVotes = await request(votesPath, creatorCookie);
  const partnerVotes = await request(votesPath, partnerCookie);
  assert.deepEqual(Object.keys(ownVotes.data), ["votes"], "vote counts and partner progress must stay server-side");
  assert.deepEqual([...ownVotes.data.votes].sort((left, right) => left.dishId.localeCompare(right.dishId)), [
    { dishId: creatorIds[0], decision: "want" },
    ...(creatorIds[1] ? [{ dishId: creatorIds[1], decision: "skip" }] : []),
  ].sort((left, right) => left.dishId.localeCompare(right.dishId)));
  assert.deepEqual(partnerVotes.data, { votes: [{ dishId: creatorIds[0], decision: "no" }] });
  assert.ok(creatorIds.length >= 4);
  const matchId = creatorIds[2];
  const simultaneousMatch = await Promise.all([
    request(votesPath, creatorCookie, "POST", { dishId: matchId, decision: "want", idempotencyKey: "vote-match-phong-01" }),
    request(votesPath, partnerCookie, "POST", { dishId: matchId, decision: "want", idempotencyKey: "vote-match-nhi-0001" }),
  ]);
  assert.deepEqual(simultaneousMatch.map((item) => item.response.status), [201, 201]);
  assert.equal(simultaneousMatch.filter((item) => item.data.match).length, 1, "near-simultaneous votes must create one match");
  const expectedMatch = creatorPool.data.dishes.find((dish) => dish.id === matchId);
  const [creatorMatch, partnerMatch] = await Promise.all([
    request(matchPath, creatorCookie), request(matchPath, partnerCookie),
  ]);
  assert.deepEqual(creatorMatch.data, { match: expectedMatch });
  assert.deepEqual(partnerMatch.data, creatorMatch.data, "both users must receive the same shared result");
  assert.deepEqual(Object.keys(creatorMatch.data.match).sort(), ["categories", "foodStyle", "id", "name"], "alternatives stay server-side");
  const stopped = await request(votesPath, creatorCookie, "POST", {
    dishId: creatorIds[3], decision: "want", idempotencyKey: "vote-after-match-01",
  });
  assert.equal(stopped.response.status, 409);
  assert.deepEqual(stopped.data.match, expectedMatch);
  assert.equal((await act(creatorCookie, open.id, "complete", 2, "generic-food-complete")).response.status, 409);
  const acceptedResult = await request(`/api/sessions/${open.id}/food-result`, creatorCookie, "POST", {
    decision: "accept", idempotencyKey: "accept-food-result-01",
  });
  assert.equal(acceptedResult.response.status, 200);
  assert.equal(acceptedResult.data.session.status, "completed");
  assert.deepEqual(acceptedResult.data.result, expectedMatch);
  assert.equal((await request(`/api/sessions/${open.id}/food-result`, creatorCookie, "POST", {
    decision: "accept", idempotencyKey: "accept-food-result-01",
  })).data.duplicate, true);
  assert.equal((await request(`/api/sessions/${open.id}/food-result`, creatorCookie, "POST", {
    decision: "retry", idempotencyKey: "accept-food-result-01",
  })).response.status, 409);

  const smallFoodConditions = { ...foodConditions, meal: "any", category: "korean", allergens: [], exclusions: [] };
  const proxySession = (await create(phong, "food_vote", "create-food-proxy-01", smallFoodConditions)).data.session;
  assert.equal((await act(nhi, proxySession.id, "join", 1, "join-food-proxy-01")).data.session.status, "active");
  const proxyPool = await request(`/api/sessions/${proxySession.id}/food-pool`, phong);
  const proxyIds = proxyPool.data.dishes.map((dish) => dish.id);
  const proxyVotesPath = `/api/sessions/${proxySession.id}/food-votes`;
  const proxyPath = `/api/sessions/${proxySession.id}/food-proxy`;
  for (let index = 0; index < proxyIds.length; index++) {
    const response = await request(proxyVotesPath, phong, "POST", {
      dishId: proxyIds[index], decision: index < 2 ? "want" : "skip", idempotencyKey: `proxy-phong-${index}`,
    });
    assert.equal(response.response.status, 201);
  }
  assert.deepEqual((await request(proxyPath, phong)).data, { proxy: null, exhausted: false, confirmedByMe: false, ready: false });
  let proxyResult;
  for (let index = 0; index < proxyIds.length; index++) {
    proxyResult = await request(proxyVotesPath, nhi, "POST", {
      dishId: proxyIds[index], decision: index === 1 ? "no" : "skip", idempotencyKey: `proxy-nhi-${index}-01`,
    });
    assert.equal(proxyResult.response.status, 201);
  }
  const safeDish = proxyPool.data.dishes[0];
  assert.deepEqual(proxyResult.data.proxy, safeDish, "proxy must come from union wants minus every no");
  assert.equal(proxyResult.data.exhausted, false);
  const confirmations = await Promise.all([
    request(proxyPath, phong, "POST", { idempotencyKey: "confirm-proxy-phong" }),
    request(proxyPath, nhi, "POST", { idempotencyKey: "confirm-proxy-nhi-01" }),
  ]);
  assert.deepEqual(confirmations.map((item) => item.response.status), [201, 201]);
  assert.equal(confirmations.filter((item) => item.data.ready).length, 1);
  const [phongProxy, nhiProxy] = await Promise.all([request(proxyPath, phong), request(proxyPath, nhi)]);
  assert.deepEqual(phongProxy.data, { proxy: safeDish, exhausted: false, confirmedByMe: true, ready: true });
  assert.deepEqual(nhiProxy.data, phongProxy.data);
  assert.equal((await request(proxyPath, phong, "POST", { idempotencyKey: "confirm-proxy-phong" })).data.duplicate, true);
  const retriedResult = await request(`/api/sessions/${proxySession.id}/food-result`, nhi, "POST", {
    decision: "retry", idempotencyKey: "retry-food-result-01",
  });
  assert.equal(retriedResult.response.status, 200);
  assert.equal(retriedResult.data.session.status, "completed");
  assert.deepEqual(retriedResult.data.result, safeDish);

  const concurrentSession = await create(phong, "deep_talk", "create-deep-0001");
  const concurrentId = concurrentSession.data.session.id;
  assert.equal((await act(nhi, concurrentId, "join", 1, "join-deep-blocked")).response.status, 409);
  const consentPath = `/api/sessions/${concurrentId}/deep-talk-consent`;
  const revisedTopics = { ...deepTalkConditions.sensitiveTopics, gia_dinh: "deny" };
  const reviewed = await request(consentPath, nhi, "POST", {
    action: "review", expectedVersion: 1, sensitiveTopics: revisedTopics, idempotencyKey: "review-deep-nhi01",
  });
  assert.equal(reviewed.response.status, 201);
  assert.equal(reviewed.data.session.status, "pending");
  assert.equal(reviewed.data.consent.stage, "final_confirmation");
  assert.equal(reviewed.data.consent.conditions.sensitiveTopics.gia_dinh, "deny");
  const creatorConfirmed = await request(consentPath, phong, "POST", {
    action: "confirm", expectedVersion: 2, idempotencyKey: "confirm-deep-phong",
  });
  assert.equal(creatorConfirmed.data.session.status, "pending");
  assert.equal(creatorConfirmed.data.consent.confirmedByMe, true);
  const ready = await request(consentPath, nhi, "POST", {
    action: "confirm", expectedVersion: 3, idempotencyKey: "confirm-deep-nhi01",
  });
  assert.equal(ready.data.session.status, "active");
  assert.equal(ready.data.consent.stage, "ready");
  assert.equal(ready.data.consent.conditions.sensitiveTopics.gia_dinh, "deny");
  const fallbackDeck = await request(`/api/sessions/${concurrentId}/deep-talk-deck`, phong, "POST", {
    expectedVersion: 4, idempotencyKey: "fallback-deep-001", source: "fallback",
  });
  assert.equal(fallbackDeck.response.status, 201);
  assert.equal(fallbackDeck.data.deck.cardCount, 20);
  assert.doesNotMatch(JSON.stringify(fallbackDeck.data), /seed|cards|question/i);
  const creatorView = await request(`/api/sessions/${concurrentId}/deep-talk-deck`, phong);
  assert.equal(creatorView.response.status, 200);
  assert.deepEqual(Object.keys(creatorView.data).sort(), ["current", "deck", "opened", "players", "progress"]);
  assert.equal(creatorView.data.current.position, 0);
  assert.equal(creatorView.data.opened.length, 0);
  assert.equal((JSON.stringify(creatorView.data).match(/question/g) ?? []).length, 0,
    "the creator must not receive unopened cards");
  assert.equal((await request(`/api/sessions/${concurrentId}/deep-talk-deck`, "invalid-session-cookie")).response.status, 401);
  const replayedFallback = await request(`/api/sessions/${concurrentId}/deep-talk-deck`, phong, "POST", {
    expectedVersion: 4, idempotencyKey: "fallback-deep-001", source: "fallback",
  });
  assert.equal(replayedFallback.data.duplicate, true);
  const playPath = `/api/sessions/${concurrentId}/deep-talk-play`;
  const startPlay = await request(playPath, phong, "POST", {
    action: "start", starterUserId: "user-phong", turnMode: "alternate", expectedVersion: 5, idempotencyKey: "play-start-phong",
  });
  assert.equal(startPlay.response.status, 200);
  assert.deepEqual(startPlay.data.progress.answererUserIds, ["user-phong"]);
  assert.equal(startPlay.data.progress.turnMode, "alternate");
  assert.equal(Number.isInteger(startPlay.data.progress.startedAt), true);
  assert.equal((await request(playPath, phong, "POST", {
    action: "start", starterUserId: "user-phong", turnMode: "alternate", expectedVersion: 5, idempotencyKey: "play-start-phong",
  })).data.duplicate, true);
  const both = await request(playPath, phong, "POST", {
    action: "both", expectedVersion: 6, idempotencyKey: "play-both-card-01",
  });
  assert.deepEqual(both.data.progress.answererUserIds.sort(), ["user-nhi", "user-phong"]);
  const revealed = await request(playPath, phong, "POST", {
    action: "reveal", expectedVersion: 7, idempotencyKey: "play-reveal-card1",
  });
  assert.deepEqual(revealed.data.progress.openedPositions, [0]);
  assert.equal(typeof revealed.data.current.card.question, "string");
  assert.deepEqual(revealed.data.current.card, revealed.data.opened[0].card);
  const competingAdvance = await Promise.all([
    request(playPath, phong, "POST", { action: "next", expectedVersion: 8, idempotencyKey: "play-next-card-001" }),
    request(playPath, nhi, "POST", { action: "skip", expectedVersion: 8, idempotencyKey: "play-skip-card-001" }),
  ]);
  assert.deepEqual(competingAdvance.map((item) => item.response.status).sort(), [200, 409]);
  const afterAdvance = (await request(`/api/sessions/${concurrentId}`, phong)).data.session;
  const switched = await request(playPath, phong, "POST", {
    action: "switch", expectedVersion: afterAdvance.version, idempotencyKey: "play-switch-card1",
  });
  assert.deepEqual(switched.data.progress.answererUserIds, ["user-phong"]);
  const ended = await request(playPath, phong, "POST", {
    action: "end", expectedVersion: switched.data.session.version, idempotencyKey: "play-end-session1",
  });
  assert.equal(ended.response.status, 200);
  assert.equal(ended.data.session.status, "completed");
  assert.equal(Number.isInteger(ended.data.session.completedAt), true);
  const resumedCompleted = await request(`/api/sessions/${concurrentId}/deep-talk-deck`, nhi);
  assert.equal(resumedCompleted.data.progress.currentPosition, ended.data.progress.currentPosition);
  assert.deepEqual(resumedCompleted.data.progress.openedPositions, ended.data.progress.openedPositions);
  assert.deepEqual(resumedCompleted.data.progress.skippedPositions, ended.data.progress.skippedPositions);
  assert.deepEqual(resumedCompleted.data.opened, ended.data.opened);
  assert.equal((JSON.stringify(resumedCompleted.data).match(/question/g) ?? []).length, resumedCompleted.data.opened.length,
    "completed review must expose opened questions only");

  const twoDeviceSession = await create(phong, "deep_talk", "create-deep-two01");
  const twoDeviceId = twoDeviceSession.data.session.id;
  const twoReady = await request(`/api/sessions/${twoDeviceId}/deep-talk-consent`, nhi, "POST", {
    action: "review", expectedVersion: 1, sensitiveTopics: deepTalkConditions.sensitiveTopics, idempotencyKey: "review-deep-two01",
  });
  assert.equal(twoReady.data.session.status, "active");
  const twoDeck = await request(`/api/sessions/${twoDeviceId}/deep-talk-deck`, phong, "POST", {
    expectedVersion: 2, idempotencyKey: "fallback-deep-two", source: "fallback",
  });
  assert.equal(twoDeck.response.status, 429);
  assert.equal(twoDeck.data.error, "Hôm nay đã hết lượt chơi, ngày mai chúng mình chơi lại nhé");
  assert.equal((await request(`/api/sessions/${twoDeviceId}/deep-talk-deck`, phong)).response.status, 404,
    "quota exhaustion must fail closed without storing a deck");

  const snapshot = (await request("/api/sessions", phong)).data;
  assert.equal(snapshot.deepTalkPlayedToday, true);

  console.log("P1.9/P2.16-P2.18/P3.2-P4.15/E1.2-E1.3/E2.3 sessions: stars, claw credits, check-in, media and completion = OK");
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (server.exitCode === null && process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  }
  await rm(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}
