import { authenticatedUser } from "./auth";
import deepTalkSpec from "../../../content/deep-talk.v1.json";
import foodCatalog from "../../../content/food.v1.json";

interface SessionEnv {
  DB: D1Database;
  AUTH_PEPPER: string;
}

type Status = "pending" | "active" | "declined" | "completed" | "expired" | "cancelled";
type Action = "join" | "decline" | "cancel" | "complete";
type FoodDecision = "want" | "no" | "skip";
export type FoodMatch = { dishId: string; alternatives: string[] };
type FoodFallback = { dishId: string; exhausted: false } | { dishId: null; exhausted: true };
export type FoodVoteChoice = { dishId: string; decision: FoodDecision };
type FoodFinal = { dishId: string; foodStyle: string; mode: "dish"; source: "match" | "proxy"; accepted: boolean };
type TopicState = "unset" | "allow" | "deny";
type DeepTalkConditions = { level: string; duration: string; sensitiveTopics: Record<string, TopicState> };
type DeepTalkConsent = { stage: "final_confirmation" | "ready"; revision: number; confirmedUserIds: string[]; changed: boolean };

interface SessionRow {
  id: string;
  feature: "blind_bag" | "food_vote" | "deep_talk";
  status: Status;
  created_by_user_id: string;
  version: number;
  payload_json: string;
  result_json: string | null;
  expires_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

const features = ["blind_bag", "food_vote", "deep_talk"];
const commandPattern = /^[A-Za-z0-9_-]{8,100}$/;
const selectSession = `SELECT id, feature, status, created_by_user_id, version,
  payload_json, result_json, expires_at, completed_at, created_at, updated_at FROM activity_sessions`;

const conditionChoices = {
  time: ["one_hour", "two_three_hours", "half_day", "any"],
  distance: ["under_3", "three_to_five", "five_to_ten", "custom"],
  transport: ["walk", "motorbike", "car", "any"],
  budget: ["free_low", "under_200k", "two_to_five_hundred_k", "any"],
  setting: ["indoor", "outdoor", "any"],
  experience: ["food", "relax", "art", "books", "play", "explore", "any"],
  surprise: ["gentle", "adventure", "bold"],
} as const;
const foodMeals = ["breakfast", "lunch", "dinner", "late", "any"];
const foodStyles = new Set<string>(foodCatalog.foodStyles.map((item) => item.id));
const foodCategories = new Set<string>(["any", ...foodCatalog.categories.map((item) => item.id)]);
const foodAllergens = new Set<string>(foodCatalog.allergens.map((item) => item.id));
const foodExclusions = new Set<string>(foodCatalog.exclusions.map((item) => item.id));
const foodStyleCategories = new Set(foodCatalog.dishes.flatMap((dish) => dish.categories.map((category) => `${dish.foodStyle}:${category}`)));
const foodDishById = new Map(foodCatalog.dishes.map((dish) => [dish.id, dish]));
const deepTalkLevels = ["gentle", "understand", "deep", "mixed"];
const deepTalkDurations = ["15", "30", "60", "unlimited"];
const deepTalkTopicIds = deepTalkSpec.sensitiveTopics.map((topic) => topic.id);
const topicStates = new Set<TopicState>(deepTalkSpec.consentStates.map((state) => state.id as TopicState));

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function publicSession(row: SessionRow) {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  return {
    id: row.id,
    feature: row.feature,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    version: row.version,
    ...payload,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function blindBagPayload(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  for (const [key, choices] of Object.entries(conditionChoices)) {
    if (typeof input[key] !== "string" || !(choices as readonly string[]).includes(input[key])) return null;
  }
  if (input.distance === "custom"
    && (typeof input.customDistanceKm !== "number" || !Number.isFinite(input.customDistanceKm)
      || input.customDistanceKm < 1 || input.customDistanceKm > 100)) return null;
  return JSON.stringify({
    conditions: {
      time: input.time,
      distance: input.distance,
      ...(input.distance === "custom" ? { customDistanceKm: input.customDistanceKm } : {}),
      transport: input.transport,
      budget: input.budget,
      setting: input.setting,
      experience: input.experience,
      surprise: input.surprise,
    },
  });
}

function foodPayload(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.foodStyle !== "string" || !foodStyles.has(input.foodStyle)
    || typeof input.meal !== "string" || !foodMeals.includes(input.meal)
    || typeof input.category !== "string" || !foodCategories.has(input.category)
    || (input.category !== "any" && !foodStyleCategories.has(`${input.foodStyle}:${input.category}`))) return null;
  const allergens = input.allergens;
  const exclusions = input.exclusions;
  if (!Array.isArray(allergens) || !Array.isArray(exclusions)
    || new Set(allergens).size !== allergens.length || new Set(exclusions).size !== exclusions.length
    || allergens.some((item) => typeof item !== "string" || !foodAllergens.has(item))
    || exclusions.some((item) => typeof item !== "string" || !foodExclusions.has(item))) return null;
  return JSON.stringify({ conditions: {
    foodStyle: input.foodStyle,
    meal: input.meal,
    category: input.category,
    allergens,
    exclusions,
  } });
}

function deepTalkConditions(value: unknown): DeepTalkConditions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const topics = input.sensitiveTopics;
  if (typeof input.level !== "string" || !deepTalkLevels.includes(input.level)
    || typeof input.duration !== "string" || !deepTalkDurations.includes(input.duration)
    || !topics || typeof topics !== "object" || Array.isArray(topics)) return null;
  const values = topics as Record<string, unknown>;
  if (Object.keys(values).sort().join("|") !== [...deepTalkTopicIds].sort().join("|")
    || deepTalkTopicIds.some((id) => !topicStates.has(values[id] as TopicState))) return null;
  return { level: input.level, duration: input.duration,
    sensitiveTopics: Object.fromEntries(deepTalkTopicIds.map((id) => [id, values[id] as TopicState])) };
}

function deepTalkPayload(value: unknown): string | null {
  const conditions = deepTalkConditions(value);
  return conditions ? JSON.stringify({ conditions }) : null;
}

function storedDishPool(resultJson: string | null): string[] | null {
  if (!resultJson) return null;
  try {
    const value = JSON.parse(resultJson) as { dishPool?: unknown };
    const pool = value.dishPool;
    return Array.isArray(pool) && pool.length <= 8 && new Set(pool).size === pool.length
      && pool.every((id) => typeof id === "string" && foodDishById.has(id)) ? pool as string[] : null;
  } catch {
    return null;
  }
}

function storedFoodMatch(resultJson: string | null): FoodMatch | null {
  const pool = storedDishPool(resultJson);
  if (!pool || !resultJson) return null;
  try {
    const match = (JSON.parse(resultJson) as { foodMatch?: unknown }).foodMatch as Record<string, unknown> | undefined;
    if (!match || typeof match.dishId !== "string" || !pool.includes(match.dishId)
      || !Array.isArray(match.alternatives) || new Set(match.alternatives).size !== match.alternatives.length
      || match.alternatives.some((id) => typeof id !== "string" || id === match.dishId || !pool.includes(id))) return null;
    return { dishId: match.dishId, alternatives: match.alternatives as string[] };
  } catch {
    return null;
  }
}

function storedFoodFallback(resultJson: string | null): FoodFallback | null {
  const pool = storedDishPool(resultJson);
  if (!pool || !resultJson) return null;
  try {
    const value = JSON.parse(resultJson) as { foodProxy?: unknown; foodExhausted?: unknown };
    if (value.foodExhausted === true) return { dishId: null, exhausted: true };
    const proxy = value.foodProxy as { dishId?: unknown } | undefined;
    return proxy && typeof proxy.dishId === "string" && pool.includes(proxy.dishId)
      ? { dishId: proxy.dishId, exhausted: false } : null;
  } catch {
    return null;
  }
}

function storedFoodFinal(resultJson: string | null): FoodFinal | null {
  if (!resultJson) return null;
  try {
    const final = (JSON.parse(resultJson) as { foodFinal?: unknown }).foodFinal as Record<string, unknown> | undefined;
    const dish = typeof final?.dishId === "string" ? foodDishById.get(final.dishId) : null;
    if (!dish || final?.foodStyle !== dish.foodStyle || final.mode !== "dish"
      || !["match", "proxy"].includes(String(final.source)) || typeof final.accepted !== "boolean") return null;
    return final as FoodFinal;
  } catch {
    return null;
  }
}

function storedDeepTalkConsent(resultJson: string | null): DeepTalkConsent | null {
  if (!resultJson) return null;
  try {
    const consent = (JSON.parse(resultJson) as { deepTalkConsent?: unknown }).deepTalkConsent as Record<string, unknown> | undefined;
    if (!consent || !["final_confirmation", "ready"].includes(String(consent.stage))
      || !Number.isInteger(consent.revision) || Number(consent.revision) < 1
      || !Array.isArray(consent.confirmedUserIds) || new Set(consent.confirmedUserIds).size !== consent.confirmedUserIds.length
      || consent.confirmedUserIds.some((id) => typeof id !== "string") || typeof consent.changed !== "boolean") return null;
    return consent as DeepTalkConsent;
  } catch {
    return null;
  }
}

export function matchFromPool(pool: string[], mutualIds: Iterable<string>): FoodMatch | null {
  const mutual = new Set(mutualIds);
  const matches = pool.filter((id) => mutual.has(id));
  return matches.length ? { dishId: matches[0], alternatives: matches.slice(1) } : null;
}

export function proxyCandidates(pool: string[], votes: FoodVoteChoice[]): string[] {
  const wanted = new Set(votes.filter((vote) => vote.decision === "want").map((vote) => vote.dishId));
  const rejected = new Set(votes.filter((vote) => vote.decision === "no").map((vote) => vote.dishId));
  return pool.filter((id) => wanted.has(id) && !rejected.has(id));
}

export function foodCandidates(conditions: { foodStyle: string; category: string; allergens: string[]; exclusions: string[] }) {
  return foodCatalog.dishes.filter((dish) => dish.foodStyle === conditions.foodStyle
    && (conditions.category === "any" || dish.categories.includes(conditions.category))
    && !dish.possibleAllergens.some((item) => conditions.allergens.includes(item))
    && !dish.exclusionTags.some((item) => conditions.exclusions.includes(item)));
}

function shuffle<T>(values: T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [shuffled[index], shuffled[random]] = [shuffled[random], shuffled[index]];
  }
  return shuffled;
}

function publicDish(id: string) {
  const dish = foodDishById.get(id)!;
  return { id: dish.id, name: dish.name, foodStyle: dish.foodStyle, categories: dish.categories };
}

function publicDishPool(ids: string[]) {
  return { dishes: ids.map(publicDish) };
}

function publicFallback(fallback: FoodFallback) {
  return { proxy: fallback.dishId ? publicDish(fallback.dishId) : null, exhausted: fallback.exhausted };
}

async function resolveFoodFallback(env: SessionEnv, spaceId: string, sessionId: string, pool: string[], resultJson: string): Promise<FoodFallback | null> {
  const votes = await env.DB.prepare(`SELECT user_id, dish_id, decision FROM food_votes WHERE session_id = ?`)
    .bind(sessionId).all<{ user_id: string; dish_id: string; decision: FoodDecision }>();
  const rows = votes.results ?? [];
  const counts = new Map<string, number>();
  for (const vote of rows) counts.set(vote.user_id, (counts.get(vote.user_id) ?? 0) + 1);
  if (counts.size !== 2 || [...counts.values()].some((count) => count !== pool.length)) return null;

  const candidates = proxyCandidates(pool, rows.map((vote) => ({ dishId: vote.dish_id, decision: vote.decision })));
  const fallback: FoodFallback = candidates.length
    ? { dishId: candidates[crypto.getRandomValues(new Uint32Array(1))[0] % candidates.length], exhausted: false }
    : { dishId: null, exhausted: true };
  const nextResult = JSON.stringify({ dishPool: pool,
    ...(fallback.dishId ? { foodProxy: { dishId: fallback.dishId } } : { foodExhausted: true }) });
  const saved = await env.DB.prepare(`UPDATE activity_sessions SET result_json = ?, updated_at = unixepoch()
    WHERE id = ? AND couple_space_id = ? AND status = 'active' AND result_json = ?`)
    .bind(nextResult, sessionId, spaceId, resultJson).run();
  if (saved.meta.changes === 1) return fallback;
  const winner = await env.DB.prepare("SELECT result_json FROM activity_sessions WHERE id = ? AND couple_space_id = ?")
    .bind(sessionId, spaceId).first<{ result_json: string | null }>();
  return storedFoodFallback(winner?.result_json ?? null);
}

async function userDishOrder(env: SessionEnv, spaceId: string, sessionId: string, userId: string, ids: string[]): Promise<string[]> {
  if (ids.length < 2) return ids;
  const users = await env.DB.prepare("SELECT id FROM users WHERE couple_space_id = ? ORDER BY id")
    .bind(spaceId).all<{ id: string }>();
  const userIds = (users.results ?? []).map((user) => user.id);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_PEPPER),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const orderFor = async (targetUserId: string) => (await Promise.all(ids.map(async (id) => ({
    id,
    rank: new Uint8Array(await crypto.subtle.sign("HMAC", key,
      new TextEncoder().encode(`food-order:v1:${sessionId}:${targetUserId}:${id}`))),
  })))).sort((left, right) => {
    for (let index = 0; index < left.rank.length; index++) {
      if (left.rank[index] !== right.rank[index]) return left.rank[index] - right.rank[index];
    }
    return left.id.localeCompare(right.id);
  }).map((item) => item.id);
  const orders = await Promise.all(userIds.map(orderFor));
  if (orders.length === 2 && orders[0].every((id, index) => id === orders[1][index])) {
    [orders[1][0], orders[1][1]] = [orders[1][1], orders[1][0]];
  }
  return orders[userIds.indexOf(userId)] ?? orderFor(userId);
}

async function dishPool(env: SessionEnv, userId: string, spaceId: string, sessionId: string): Promise<Response> {
  const session = await env.DB.prepare(`SELECT feature, status, payload_json, result_json FROM activity_sessions
    WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId)
    .first<{ feature: string; status: Status; payload_json: string; result_json: string | null }>();
  if (!session) return json({ error: "Không tìm thấy phiên." }, 404);
  if (session.feature !== "food_vote" || session.status !== "active") return json({ error: "Phiên chọn món chưa sẵn sàng." }, 409);
  const existing = storedDishPool(session.result_json);
  if (existing) return json(publicDishPool(await userDishOrder(env, spaceId, sessionId, userId, existing)));
  if (session.result_json) return json({ error: "Dữ liệu pool món không hợp lệ." }, 500);

  const payload = JSON.parse(session.payload_json) as { conditions: {
    foodStyle: string; category: string; allergens: string[]; exclusions: string[];
  } };
  const { foodStyle, category, allergens, exclusions } = payload.conditions;
  const candidates = foodCandidates({ foodStyle, category, allergens, exclusions });

  const recentRows = await env.DB.prepare(`SELECT result_json FROM activity_sessions
    WHERE couple_space_id = ? AND id <> ? AND feature = 'food_vote' AND status = 'completed'
      AND updated_at >= ? AND result_json IS NOT NULL ORDER BY updated_at DESC LIMIT 100`)
    .bind(spaceId, sessionId, Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60)
    .all<{ result_json: string }>();
  const recent = new Set((recentRows.results ?? []).map((row) => storedFoodFinal(row.result_json))
    .filter((final) => final?.accepted && final.foodStyle === foodStyle).map((final) => final!.dishId));
  const ids = [
    ...shuffle(candidates.filter((dish) => !recent.has(dish.id))),
    ...shuffle(candidates.filter((dish) => recent.has(dish.id))),
  ].slice(0, 8).map((dish) => dish.id);

  const saved = await env.DB.prepare(`UPDATE activity_sessions SET result_json = ?
    WHERE id = ? AND couple_space_id = ? AND status = 'active' AND result_json IS NULL`)
    .bind(JSON.stringify({ dishPool: ids }), sessionId, spaceId).run();
  if (saved.meta.changes === 1) return json(publicDishPool(await userDishOrder(env, spaceId, sessionId, userId, ids)));
  const winner = await env.DB.prepare("SELECT result_json FROM activity_sessions WHERE id = ? AND couple_space_id = ?")
    .bind(sessionId, spaceId).first<{ result_json: string | null }>();
  const winnerPool = storedDishPool(winner?.result_json ?? null);
  return winnerPool
    ? json(publicDishPool(await userDishOrder(env, spaceId, sessionId, userId, winnerPool)))
    : json({ error: "Phiên đã thay đổi." }, 409);
}

async function foodVotes(request: Request, env: SessionEnv, userId: string, spaceId: string, sessionId: string): Promise<Response> {
  const session = await env.DB.prepare(`SELECT feature, status, result_json FROM activity_sessions
    WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId)
    .first<{ feature: string; status: Status; result_json: string | null }>();
  if (!session) return json({ error: "Không tìm thấy phiên." }, 404);
  if (session.feature !== "food_vote" || session.status !== "active") return json({ error: "Phiên chọn món chưa sẵn sàng." }, 409);
  const pool = storedDishPool(session.result_json);
  if (!pool) return json({ error: "Pool món chưa sẵn sàng." }, 409);
  const existingMatch = storedFoodMatch(session.result_json);
  const existingFallback = storedFoodFallback(session.result_json);

  if (request.method === "GET") {
    const votes = await env.DB.prepare(`SELECT dish_id, decision FROM food_votes
      WHERE session_id = ? AND user_id = ? ORDER BY created_at, dish_id`).bind(sessionId, userId)
      .all<{ dish_id: string; decision: FoodDecision }>();
    return json({ votes: (votes.results ?? []).map((vote) => ({ dishId: vote.dish_id, decision: vote.decision })) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const input = await body(request);
  const dishId = input?.dishId;
  const decision = input?.decision;
  const idempotencyKey = input?.idempotencyKey;
  if (typeof dishId !== "string" || !pool.includes(dishId)
    || !["want", "no", "skip"].includes(String(decision))
    || typeof idempotencyKey !== "string" || !commandPattern.test(idempotencyKey)) {
    return json({ error: "Lựa chọn món không hợp lệ." }, 400);
  }
  const foodDecision = decision as FoodDecision;
  const existingKey = await env.DB.prepare(`SELECT session_id, user_id, dish_id, decision FROM food_votes
    WHERE idempotency_key = ?`).bind(idempotencyKey)
    .first<{ session_id: string; user_id: string; dish_id: string; decision: FoodDecision }>();
  if (existingKey) return existingKey.session_id === sessionId && existingKey.user_id === userId
    && existingKey.dish_id === dishId && existingKey.decision === foodDecision
    ? json({ vote: { dishId, decision: foodDecision }, duplicate: true,
      ...(existingMatch ? { match: publicDish(existingMatch.dishId) } : existingFallback ? publicFallback(existingFallback) : {}) })
    : json({ error: "Idempotency key đã được dùng cho lựa chọn khác." }, 409);
  if (existingMatch) return json({ error: "Hai đứa đã có món trùng ý.", match: publicDish(existingMatch.dishId) }, 409);
  if (existingFallback) return json({ error: "Hai đứa đã bình chọn xong.", ...publicFallback(existingFallback) }, 409);
  const existingVote = await env.DB.prepare(`SELECT decision FROM food_votes
    WHERE session_id = ? AND user_id = ? AND dish_id = ?`).bind(sessionId, userId, dishId)
    .first<{ decision: FoodDecision }>();
  if (existingVote) return existingVote.decision === foodDecision
    ? json({ vote: { dishId, decision: foodDecision }, duplicate: true })
    : json({ error: "Món này đã được chọn trước đó." }, 409);

  try {
    await env.DB.prepare(`INSERT INTO food_votes (session_id, user_id, dish_id, decision, idempotency_key)
      VALUES (?, ?, ?, ?, ?)`).bind(sessionId, userId, dishId, foodDecision, idempotencyKey).run();
  } catch {
    const retry = await env.DB.prepare(`SELECT decision FROM food_votes
      WHERE session_id = ? AND user_id = ? AND dish_id = ?`).bind(sessionId, userId, dishId)
      .first<{ decision: FoodDecision }>();
    return retry?.decision === foodDecision
      ? json({ vote: { dishId, decision: foodDecision }, duplicate: true })
      : json({ error: "Không thể lưu lựa chọn món." }, 409);
  }
  let match: FoodMatch | null = null;
  let fallback: FoodFallback | null = null;
  if (foodDecision === "want") {
    const mutual = await env.DB.prepare(`SELECT dish_id FROM food_votes WHERE session_id = ? AND decision = 'want'
      GROUP BY dish_id HAVING count(DISTINCT user_id) >= 2`).bind(sessionId).all<{ dish_id: string }>();
    const candidate = matchFromPool(pool, (mutual.results ?? []).map((vote) => vote.dish_id));
    if (candidate) {
      const resultJson = JSON.stringify({ dishPool: pool, foodMatch: candidate });
      const saved = await env.DB.prepare(`UPDATE activity_sessions SET result_json = ?, updated_at = unixepoch()
        WHERE id = ? AND couple_space_id = ? AND status = 'active' AND result_json = ?`)
        .bind(resultJson, sessionId, spaceId, session.result_json).run();
      if (saved.meta.changes === 1) match = candidate;
      else {
        const winner = await env.DB.prepare("SELECT result_json FROM activity_sessions WHERE id = ? AND couple_space_id = ?")
          .bind(sessionId, spaceId).first<{ result_json: string | null }>();
        match = storedFoodMatch(winner?.result_json ?? null);
      }
    }
  }
  if (!match) fallback = await resolveFoodFallback(env, spaceId, sessionId, pool, session.result_json);
  return json({ vote: { dishId, decision: foodDecision },
    ...(match ? { match: publicDish(match.dishId) } : fallback ? publicFallback(fallback) : {}) }, 201);
}

async function foodMatch(env: SessionEnv, spaceId: string, sessionId: string): Promise<Response> {
  const session = await env.DB.prepare(`SELECT feature, status, result_json FROM activity_sessions
    WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId)
    .first<{ feature: string; status: Status; result_json: string | null }>();
  if (!session) return json({ error: "Không tìm thấy phiên." }, 404);
  if (session.feature !== "food_vote" || session.status !== "active") return json({ error: "Phiên chọn món chưa sẵn sàng." }, 409);
  if (!storedDishPool(session.result_json)) return json({ error: "Pool món chưa sẵn sàng." }, 409);
  const match = storedFoodMatch(session.result_json);
  return json({ match: match ? publicDish(match.dishId) : null });
}

async function foodProxy(request: Request, env: SessionEnv, userId: string, spaceId: string, sessionId: string): Promise<Response> {
  const session = await env.DB.prepare(`SELECT feature, status, result_json FROM activity_sessions
    WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId)
    .first<{ feature: string; status: Status; result_json: string | null }>();
  if (!session) return json({ error: "Không tìm thấy phiên." }, 404);
  if (session.feature !== "food_vote" || session.status !== "active") return json({ error: "Phiên chọn món chưa sẵn sàng." }, 409);
  if (storedFoodMatch(session.result_json)) return json({ error: "Hai đứa đã có món trùng ý." }, 409);
  const fallback = storedFoodFallback(session.result_json);

  const state = async (duplicate = false) => {
    if (!fallback) return { proxy: null, exhausted: false, confirmedByMe: false, ready: false };
    if (fallback.exhausted) return { ...publicFallback(fallback), confirmedByMe: false, ready: false };
    const confirmations = await env.DB.prepare("SELECT user_id FROM food_proxy_confirmations WHERE session_id = ?")
      .bind(sessionId).all<{ user_id: string }>();
    const userIds = (confirmations.results ?? []).map((item) => item.user_id);
    return { ...publicFallback(fallback), confirmedByMe: userIds.includes(userId), ready: userIds.length >= 2,
      ...(duplicate ? { duplicate: true } : {}) };
  };

  if (request.method === "GET") return json(await state());
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!fallback || fallback.exhausted) return json({ error: "Chưa có món để chốt hộ." }, 409);
  const input = await body(request);
  const idempotencyKey = input?.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !commandPattern.test(idempotencyKey)) return json({ error: "Lệnh xác nhận không hợp lệ." }, 400);
  const previousKey = await env.DB.prepare("SELECT session_id, user_id FROM food_proxy_confirmations WHERE idempotency_key = ?")
    .bind(idempotencyKey).first<{ session_id: string; user_id: string }>();
  if (previousKey) return previousKey.session_id === sessionId && previousKey.user_id === userId
    ? json(await state(true)) : json({ error: "Idempotency key đã được dùng cho lệnh khác." }, 409);
  const previousUser = await env.DB.prepare("SELECT 1 FROM food_proxy_confirmations WHERE session_id = ? AND user_id = ?")
    .bind(sessionId, userId).first();
  if (previousUser) return json(await state(true));
  try {
    await env.DB.prepare("INSERT INTO food_proxy_confirmations (session_id, user_id, idempotency_key) VALUES (?, ?, ?)")
      .bind(sessionId, userId, idempotencyKey).run();
  } catch {
    const retry = await env.DB.prepare("SELECT 1 FROM food_proxy_confirmations WHERE session_id = ? AND user_id = ?")
      .bind(sessionId, userId).first();
    return retry ? json(await state(true)) : json({ error: "Không thể lưu xác nhận chốt hộ." }, 409);
  }
  return json(await state(), 201);
}

async function foodResult(request: Request, env: SessionEnv, userId: string, spaceId: string, sessionId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const input = await body(request);
  const decision = input?.decision;
  const idempotencyKey = input?.idempotencyKey;
  if (!["accept", "retry"].includes(String(decision))
    || typeof idempotencyKey !== "string" || !commandPattern.test(idempotencyKey)) {
    return json({ error: "Lệnh chốt món không hợp lệ." }, 400);
  }
  const accepted = decision === "accept";
  const previous = await env.DB.prepare(`SELECT session_id, action FROM activity_session_events
    WHERE couple_space_id = ? AND idempotency_key = ?`).bind(spaceId, idempotencyKey)
    .first<{ session_id: string; action: string }>();
  if (previous) {
    const replay = await env.DB.prepare(`${selectSession} WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId).first<SessionRow>();
    const final = storedFoodFinal(replay?.result_json ?? null);
    return previous.session_id === sessionId && previous.action === "complete" && final?.accepted === accepted
      ? json({ session: publicSession(replay!), result: publicDish(final.dishId), duplicate: true })
      : json({ error: "Idempotency key đã được dùng cho lệnh khác." }, 409);
  }

  const current = await env.DB.prepare(`${selectSession} WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId).first<SessionRow>();
  if (!current) return json({ error: "Không tìm thấy phiên." }, 404);
  if (current.feature !== "food_vote" || current.status !== "active") return json({ error: "Phiên chọn món chưa sẵn sàng để chốt." }, 409);
  const match = storedFoodMatch(current.result_json);
  const fallback = storedFoodFallback(current.result_json);
  let source: FoodFinal["source"] | null = match ? "match" : null;
  let dishId = match?.dishId ?? null;
  if (!dishId && fallback && !fallback.exhausted) {
    const confirmations = await env.DB.prepare("SELECT count(*) AS total FROM food_proxy_confirmations WHERE session_id = ?")
      .bind(sessionId).first<{ total: number }>();
    if (Number(confirmations?.total ?? 0) >= 2) {
      source = "proxy";
      dishId = fallback.dishId;
    }
  }
  if (!dishId || !source) return json({ error: "Chưa có kết quả chung để chốt." }, 409);
  const payload = JSON.parse(current.payload_json) as { conditions?: { foodStyle?: unknown } };
  const foodStyle = payload.conditions?.foodStyle;
  if (typeof foodStyle !== "string" || foodDishById.get(dishId)?.foodStyle !== foodStyle) return json({ error: "Kết quả món không hợp lệ." }, 500);

  const now = Math.floor(Date.now() / 1000);
  const resultJson = JSON.stringify({ ...(JSON.parse(current.result_json!) as Record<string, unknown>),
    foodFinal: { dishId, foodStyle, mode: "dish", source, accepted } satisfies FoodFinal });
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE activity_sessions SET status = 'completed', version = version + 1,
      result_json = ?, expires_at = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND couple_space_id = ? AND version = ? AND status = 'active'`)
      .bind(resultJson, now, now, sessionId, spaceId, current.version),
    env.DB.prepare(`INSERT INTO activity_session_events
      (idempotency_key, session_id, couple_space_id, actor_user_id, action, from_status, to_status, version)
      SELECT ?, ?, ?, ?, 'complete', 'active', 'completed', ? WHERE changes() = 1`)
      .bind(idempotencyKey, sessionId, spaceId, userId, current.version + 1),
  ]);
  if (results[0].meta.changes !== 1) return json({ error: "Phiên đã thay đổi." }, 409);
  const updated = await env.DB.prepare(`${selectSession} WHERE id = ?`).bind(sessionId).first<SessionRow>();
  return json({ session: publicSession(updated!), result: publicDish(dishId) });
}

async function deepTalkConsent(request: Request, env: SessionEnv, userId: string, spaceId: string, sessionId: string): Promise<Response> {
  const current = await env.DB.prepare(`${selectSession} WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId).first<SessionRow>();
  if (!current) return json({ error: "Không tìm thấy phiên." }, 404);
  if (current.feature !== "deep_talk" || !["pending", "active"].includes(current.status)) {
    return json({ error: "Phiên Deep Talk chưa sẵn sàng." }, 409);
  }
  const conditions = (JSON.parse(current.payload_json) as { conditions?: unknown }).conditions;
  const parsedConditions = deepTalkConditions(conditions);
  if (!parsedConditions) return json({ error: "Thiết lập Deep Talk không hợp lệ." }, 500);
  const stored = storedDeepTalkConsent(current.result_json);
  const state = (row = current, duplicate = false) => {
    const rowConditions = deepTalkConditions((JSON.parse(row.payload_json) as { conditions?: unknown }).conditions)!;
    const consent = storedDeepTalkConsent(row.result_json);
    return { session: publicSession(row), consent: {
      stage: row.status === "active" ? "ready" : consent?.stage ?? "partner_review",
      revision: consent?.revision ?? 1,
      confirmedByMe: consent?.confirmedUserIds.includes(userId) ?? row.created_by_user_id === userId,
      conditions: rowConditions,
    }, ...(duplicate ? { duplicate: true } : {}) };
  };
  if (request.method === "GET") return json(state());
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (current.status === "active") return json({ error: "Thiết lập Deep Talk đã được xác nhận." }, 409);

  const input = await body(request);
  const action = input?.action;
  const expectedVersion = input?.expectedVersion;
  const idempotencyKey = input?.idempotencyKey;
  if (!["review", "confirm"].includes(String(action)) || !Number.isInteger(expectedVersion)
    || typeof idempotencyKey !== "string" || !commandPattern.test(idempotencyKey)) {
    return json({ error: "Lệnh xác nhận Deep Talk không hợp lệ." }, 400);
  }
  let nextConditions = parsedConditions;
  if (action === "review") {
    const reviewed = deepTalkConditions({ ...parsedConditions, sensitiveTopics: input?.sensitiveTopics });
    if (!reviewed) return json({ error: "Lựa chọn chủ đề nhạy cảm không hợp lệ." }, 400);
    nextConditions = reviewed;
  }
  const inputJson = JSON.stringify(action === "review"
    ? { action, sensitiveTopics: nextConditions.sensitiveTopics } : { action });
  const previous = await env.DB.prepare(`SELECT session_id, user_id, action, input_json FROM deep_talk_consent_events
    WHERE idempotency_key = ?`).bind(idempotencyKey)
    .first<{ session_id: string; user_id: string; action: string; input_json: string }>();
  if (previous) {
    const replay = await env.DB.prepare(`${selectSession} WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId).first<SessionRow>();
    return previous.session_id === sessionId && previous.user_id === userId
      && previous.action === action && previous.input_json === inputJson && replay
      ? json(state(replay, true)) : json({ error: "Idempotency key đã được dùng cho lệnh khác." }, 409);
  }
  if (current.version !== expectedVersion) return json({ error: "Phiên đã thay đổi.", ...state() }, 409);

  let nextConsent: DeepTalkConsent;
  let nextStatus: Status = "pending";
  if (action === "review") {
    if (userId === current.created_by_user_id || stored) return json({ error: "Lượt xem lại của người kia đã kết thúc." }, 409);
    const changed = JSON.stringify(nextConditions.sensitiveTopics) !== JSON.stringify(parsedConditions.sensitiveTopics);
    nextConsent = changed
      ? { stage: "final_confirmation", revision: 2, confirmedUserIds: [], changed: true }
      : { stage: "ready", revision: 1, confirmedUserIds: [current.created_by_user_id, userId], changed: false };
    if (!changed) nextStatus = "active";
  } else {
    if (!stored || stored.stage !== "final_confirmation" || stored.confirmedUserIds.includes(userId)) {
      return json({ error: "Không có bản cuối cần xác nhận." }, 409);
    }
    const confirmedUserIds = [...stored.confirmedUserIds, userId];
    nextStatus = confirmedUserIds.length >= 2 ? "active" : "pending";
    nextConsent = { ...stored, stage: nextStatus === "active" ? "ready" : "final_confirmation", confirmedUserIds };
  }

  const now = Math.floor(Date.now() / 1000);
  const result = { ...(current.result_json ? JSON.parse(current.result_json) as Record<string, unknown> : {}), deepTalkConsent: nextConsent };
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE activity_sessions SET status = ?, version = version + 1, payload_json = ?, result_json = ?,
      expires_at = ?, updated_at = ? WHERE id = ? AND couple_space_id = ? AND version = ? AND status = 'pending'`)
      .bind(nextStatus, JSON.stringify({ conditions: nextConditions }), JSON.stringify(result),
        nextStatus === "active" ? null : current.expires_at, now, sessionId, spaceId, current.version),
    env.DB.prepare(`INSERT INTO deep_talk_consent_events (idempotency_key, session_id, user_id, action, input_json, revision)
      SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(idempotencyKey, sessionId, userId, action, inputJson, nextConsent.revision),
  ]);
  if (results[0].meta.changes !== 1) return json({ error: "Phiên đã thay đổi." }, 409);
  const updated = await env.DB.prepare(`${selectSession} WHERE id = ?`).bind(sessionId).first<SessionRow>();
  return json(state(updated!), 201);
}

export async function sessionSnapshot(env: SessionEnv, spaceId: string) {
  await expirePending(env.DB, spaceId);
  const [rows, latest] = await env.DB.batch([
    env.DB.prepare(`${selectSession} WHERE couple_space_id = ? ORDER BY updated_at DESC LIMIT 20`).bind(spaceId),
    env.DB.prepare(`SELECT coalesce(max(rowid), 0) AS version FROM activity_session_events
      WHERE couple_space_id = ?`).bind(spaceId),
  ]);
  return {
    eventVersion: Number((latest.results[0] as { version?: number } | undefined)?.version ?? 0),
    sessions: (rows.results as unknown as SessionRow[]).map(publicSession),
  };
}

async function expirePending(db: D1Database, spaceId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`UPDATE activity_sessions SET status = 'expired', version = version + 1,
    updated_at = ? WHERE couple_space_id = ? AND status = 'pending' AND expires_at <= ?`)
    .bind(now, spaceId, now).run();
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return null;
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function createSession(request: Request, env: SessionEnv, userId: string, spaceId: string): Promise<Response> {
  const input = await body(request);
  const feature = input?.feature;
  const idempotencyKey = input?.idempotencyKey;
  if (typeof feature !== "string" || !features.includes(feature)
    || typeof idempotencyKey !== "string" || !commandPattern.test(idempotencyKey)) {
    return json({ error: "Dữ liệu tạo phiên không hợp lệ." }, 400);
  }
  const payloadJson = feature === "blind_bag"
    ? blindBagPayload(input?.conditions)
    : feature === "food_vote" ? foodPayload(input?.conditions) : deepTalkPayload(input?.conditions);
  if (!payloadJson) return json({ error: feature === "food_vote" ? "Thiết lập món ăn không hợp lệ."
    : feature === "deep_talk" ? "Thiết lập Deep Talk không hợp lệ." : "Điều kiện Xé Túi Mù không hợp lệ." }, 400);

  await expirePending(env.DB, spaceId);
  const duplicate = await env.DB.prepare(`${selectSession} WHERE couple_space_id = ? AND idempotency_key = ?`)
    .bind(spaceId, idempotencyKey).first<SessionRow>();
  if (duplicate) return duplicate.feature === feature && duplicate.created_by_user_id === userId && duplicate.payload_json === payloadJson
    ? json({ session: publicSession(duplicate), duplicate: true })
    : json({ error: "Idempotency key đã được dùng cho lệnh khác." }, 409);
  if (await env.DB.prepare("SELECT 1 FROM activity_session_events WHERE idempotency_key = ?").bind(idempotencyKey).first()) {
    return json({ error: "Idempotency key đã được dùng cho lệnh khác." }, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO activity_sessions
        (id, couple_space_id, feature, status, created_by_user_id, version, idempotency_key, payload_json, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, 1, ?, ?, ?, ?, ?)`)
        .bind(id, spaceId, feature, userId, idempotencyKey, payloadJson, now + 24 * 60 * 60, now, now),
      env.DB.prepare(`INSERT INTO activity_session_events
        (idempotency_key, session_id, couple_space_id, actor_user_id, action, from_status, to_status, version)
        VALUES (?, ?, ?, ?, 'create', 'none', 'pending', 1)`)
        .bind(idempotencyKey, id, spaceId, userId),
    ]);
  } catch {
    const retry = await env.DB.prepare(`${selectSession} WHERE couple_space_id = ? AND idempotency_key = ?`)
      .bind(spaceId, idempotencyKey).first<SessionRow>();
    if (retry && retry.feature === feature && retry.created_by_user_id === userId && retry.payload_json === payloadJson) return json({ session: publicSession(retry), duplicate: true });
    return json({ error: "Tính năng này đang có một phiên chưa kết thúc." }, 409);
  }
  const created = await env.DB.prepare(`${selectSession} WHERE id = ?`).bind(id).first<SessionRow>();
  return json({ session: publicSession(created!) }, 201);
}

function transition(row: SessionRow, action: Action, actorId: string): Status | null {
  if (row.status === "pending" && actorId !== row.created_by_user_id) {
    if (action === "join" && row.feature !== "deep_talk") return "active";
    if (action === "decline") return "declined";
  }
  if (action === "cancel" && (row.status === "active" || (row.status === "pending" && actorId === row.created_by_user_id))) return "cancelled";
  if (action === "complete" && row.status === "active" && row.feature !== "food_vote") return "completed";
  return null;
}

async function act(request: Request, env: SessionEnv, userId: string, spaceId: string, sessionId: string, action: Action): Promise<Response> {
  const input = await body(request);
  const expectedVersion = input?.expectedVersion;
  const idempotencyKey = input?.idempotencyKey;
  if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1
    || typeof idempotencyKey !== "string" || !commandPattern.test(idempotencyKey)) {
    return json({ error: "Lệnh cập nhật phiên không hợp lệ." }, 400);
  }

  await expirePending(env.DB, spaceId);
  const previous = await env.DB.prepare(`SELECT session_id, action FROM activity_session_events
    WHERE couple_space_id = ? AND idempotency_key = ?`).bind(spaceId, idempotencyKey).first<{ session_id: string; action: string }>();
  if (previous) {
    if (previous.session_id !== sessionId || previous.action !== action) return json({ error: "Idempotency key đã được dùng cho lệnh khác." }, 409);
    const replay = await env.DB.prepare(`${selectSession} WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId).first<SessionRow>();
    return replay ? json({ session: publicSession(replay), duplicate: true }) : json({ error: "Không tìm thấy phiên." }, 404);
  }

  const current = await env.DB.prepare(`${selectSession} WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId).first<SessionRow>();
  if (!current) return json({ error: "Không tìm thấy phiên." }, 404);
  if (current.version !== expectedVersion) return json({ error: "Phiên đã thay đổi.", session: publicSession(current) }, 409);
  const nextStatus = transition(current, action, userId);
  if (!nextStatus) return json({ error: "Thao tác không hợp lệ ở trạng thái hiện tại." }, 409);

  const now = Math.floor(Date.now() / 1000);
  const completedAt = nextStatus === "completed" ? now : null;
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE activity_sessions SET status = ?, version = version + 1,
      expires_at = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND couple_space_id = ? AND version = ? AND status = ?`)
      .bind(nextStatus, completedAt, now, sessionId, spaceId, expectedVersion, current.status),
    env.DB.prepare(`INSERT INTO activity_session_events
      (idempotency_key, session_id, couple_space_id, actor_user_id, action, from_status, to_status, version)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(idempotencyKey, sessionId, spaceId, userId, action, current.status, nextStatus, current.version + 1),
  ]);
  if (results[0].meta.changes !== 1) {
    const conflict = await env.DB.prepare(`${selectSession} WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId).first<SessionRow>();
    return json({ error: "Phiên đã thay đổi.", session: conflict ? publicSession(conflict) : undefined }, 409);
  }
  const updated = await env.DB.prepare(`${selectSession} WHERE id = ?`).bind(sessionId).first<SessionRow>();
  return json({ session: publicSession(updated!) });
}

export async function handleSessions(request: Request, env: SessionEnv): Promise<Response> {
  const auth = await authenticatedUser(request, env);
  if (!auth) return json({ error: "Phiên đăng nhập đã hết hạn." }, 401);
  const { id: userId, couple_space_id: spaceId } = auth.user;
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length === 2) {
    if (request.method === "POST") return createSession(request, env, userId, spaceId);
    if (request.method === "GET") {
      return json(await sessionSnapshot(env, spaceId));
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const sessionId = parts[2];
  if (!/^[0-9a-f-]{36}$/i.test(sessionId ?? "")) return json({ error: "Không tìm thấy phiên." }, 404);
  if (parts.length === 3 && request.method === "GET") {
    await expirePending(env.DB, spaceId);
    const row = await env.DB.prepare(`${selectSession} WHERE id = ? AND couple_space_id = ?`).bind(sessionId, spaceId).first<SessionRow>();
    return row ? json({ session: publicSession(row) }) : json({ error: "Không tìm thấy phiên." }, 404);
  }
  if (parts.length === 4 && parts[3] === "food-pool" && request.method === "GET") {
    return dishPool(env, userId, spaceId, sessionId);
  }
  if (parts.length === 4 && parts[3] === "food-votes") {
    return foodVotes(request, env, userId, spaceId, sessionId);
  }
  if (parts.length === 4 && parts[3] === "food-match" && request.method === "GET") {
    return foodMatch(env, spaceId, sessionId);
  }
  if (parts.length === 4 && parts[3] === "food-proxy") {
    return foodProxy(request, env, userId, spaceId, sessionId);
  }
  if (parts.length === 4 && parts[3] === "food-result") {
    return foodResult(request, env, userId, spaceId, sessionId);
  }
  if (parts.length === 4 && parts[3] === "deep-talk-consent") {
    return deepTalkConsent(request, env, userId, spaceId, sessionId);
  }
  const action = parts[3] as Action;
  if (parts.length === 4 && request.method === "POST" && ["join", "decline", "cancel", "complete"].includes(action)) {
    return act(request, env, userId, spaceId, sessionId, action);
  }
  return json({ error: "Not found" }, 404);
}
