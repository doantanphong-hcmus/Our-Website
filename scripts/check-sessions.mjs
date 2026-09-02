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
  time: "two_three_hours", distance: "under_3", transport: "motorbike", budget: "any",
  setting: "any", experience: "any", surprise: "gentle",
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
    VALUES ('history-deck-${index}','${sessionId}','couple-main','user-phong','history-deck-key-${index}',${index},date('now','+7 hours'),'${deepTalkDeckJson}',unixepoch()-${index});
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
  const data = await response.json();
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
  assert.equal(initial.data.sessions.find((item) => item.feature === "food_vote").status, "expired");

  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "missing-conditions-1",
  })).response.status, 400);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "bad-custom-distance", conditions: { ...blindBagConditions, distance: "custom", customDistanceKm: 0 },
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
  const sessionId = created.data.session.id;
  const replayCreate = await create(phong, "blind_bag", "create-blind-001");
  assert.equal(replayCreate.response.status, 200);
  assert.equal(replayCreate.data.duplicate, true);
  assert.equal((await request("/api/sessions", phong, "POST", {
    feature: "blind_bag", idempotencyKey: "create-blind-001", conditions: { ...blindBagConditions, surprise: "bold" },
  })).response.status, 409);
  assert.equal((await create(phong, "deep_talk", "create-blind-001")).response.status, 409);
  assert.equal((await create(nhi, "blind_bag", "create-blind-002")).response.status, 409);
  assert.equal((await act(phong, sessionId, "join", 1, "join-blind-owner")).response.status, 409);

  const joined = await act(nhi, sessionId, "join", 1, "join-blind-001");
  assert.equal(joined.response.status, 200);
  assert.equal(joined.data.session.status, "active");
  assert.equal(joined.data.session.version, 2);
  assert.equal((await act(nhi, sessionId, "join", 1, "join-blind-001")).data.duplicate, true);
  assert.equal((await act(phong, sessionId, "cancel", 2, "join-blind-001")).response.status, 409);
  assert.equal((await act(phong, sessionId, "cancel", 1, "cancel-stale-001")).response.status, 409);
  const completed = await act(phong, sessionId, "complete", 2, "complete-blind-001");
  assert.equal(completed.response.status, 200);
  assert.equal(completed.data.session.status, "completed");

  const declinedSession = await create(nhi, "blind_bag", "create-decline-001");
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
  assert.equal(twoDeck.response.status, 201);
  const twoPlayPath = `/api/sessions/${twoDeviceId}/deep-talk-play`;
  const twoStarted = await request(twoPlayPath, phong, "POST", {
    action: "start", starterUserId: "user-phong", turnMode: "alternate", playMode: "two",
    expectedVersion: 3, idempotencyKey: "play-two-start01",
  });
  assert.equal(twoStarted.data.progress.playMode, "two");
  assert.equal((await request(twoPlayPath, phong, "POST", {
    action: "next", expectedVersion: 4, idempotencyKey: "play-two-next-no",
  })).response.status, 409);
  await request(twoPlayPath, phong, "POST", { action: "reveal", expectedVersion: 4, idempotencyKey: "play-two-reveal" });
  const partnerSkipped = await request(twoPlayPath, nhi, "POST", {
    action: "skip", expectedVersion: 5, idempotencyKey: "play-two-skip-nhi",
  });
  assert.equal(partnerSkipped.data.progress.currentPosition, 0);
  assert.deepEqual(partnerSkipped.data.progress.readyUserIds, ["user-nhi"]);
  assert.deepEqual(partnerSkipped.data.progress.skippedByUserIds, ["user-nhi"]);
  const creatorSynced = await request(`/api/sessions/${twoDeviceId}/deep-talk-deck`, phong);
  assert.deepEqual(creatorSynced.data.progress.skippedByUserIds, ["user-nhi"], "partner must see who skipped");
  const bothReady = await request(twoPlayPath, phong, "POST", {
    action: "ready", expectedVersion: 6, idempotencyKey: "play-two-ready-ph",
  });
  assert.equal(bothReady.data.progress.currentPosition, 1, "the card advances only after both players are ready");
  assert.deepEqual(bothReady.data.progress.readyUserIds, []);
  assert.equal((await request(twoPlayPath, nhi, "POST", {
    action: "end", expectedVersion: 7, idempotencyKey: "play-two-end-001",
  })).data.session.status, "completed");

  const quotaSession = await create(phong, "deep_talk", "create-deep-quota1");
  const quotaId = quotaSession.data.session.id;
  const quotaReview = await request(`/api/sessions/${quotaId}/deep-talk-consent`, nhi, "POST", {
    action: "review", expectedVersion: 1, sensitiveTopics: deepTalkConditions.sensitiveTopics, idempotencyKey: "review-deep-quota1",
  });
  assert.equal(quotaReview.data.session.status, "active");
  const quotaResult = await request(`/api/sessions/${quotaId}/deep-talk-deck`, phong, "POST", {
    expectedVersion: 2, idempotencyKey: "generate-deep-quota1",
  });
  assert.equal(quotaResult.response.status, 429);
  assert.equal(quotaResult.data.error, "Hôm nay hai bạn đã tạo đủ 3 bộ Deep Talk.");
  assert.equal((await request(`/api/sessions/${quotaId}/deep-talk-deck`, phong)).response.status, 404,
    "quota exhaustion must fail closed without storing a deck");

  console.log("P1.9/P3.2-P4.15 sessions: Deep Talk privacy, idempotency and quota fail-closed = OK");
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
