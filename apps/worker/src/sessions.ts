import { authenticatedUser } from "./auth";
import foodCatalog from "../../../content/food.v1.json";

interface SessionEnv {
  DB: D1Database;
  AUTH_PEPPER: string;
}

type Status = "pending" | "active" | "declined" | "completed" | "expired" | "cancelled";
type Action = "join" | "decline" | "cancel" | "complete";

interface SessionRow {
  id: string;
  feature: "blind_bag" | "food_vote" | "deep_talk";
  status: Status;
  created_by_user_id: string;
  version: number;
  payload_json: string;
  expires_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

const features = ["blind_bag", "food_vote", "deep_talk"];
const commandPattern = /^[A-Za-z0-9_-]{8,100}$/;
const selectSession = `SELECT id, feature, status, created_by_user_id, version,
  payload_json, expires_at, completed_at, created_at, updated_at FROM activity_sessions`;

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

function shuffle<T>(values: T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [shuffled[index], shuffled[random]] = [shuffled[random], shuffled[index]];
  }
  return shuffled;
}

function publicDishPool(ids: string[]) {
  return { dishes: ids.map((id) => {
    const dish = foodDishById.get(id)!;
    return { id: dish.id, name: dish.name, foodStyle: dish.foodStyle, categories: dish.categories };
  }) };
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
  const candidates = foodCatalog.dishes.filter((dish) => dish.foodStyle === foodStyle
    && (category === "any" || dish.categories.includes(category))
    && !dish.possibleAllergens.some((item) => allergens.includes(item))
    && !dish.exclusionTags.some((item) => exclusions.includes(item)));

  const recentRows = await env.DB.prepare(`SELECT result_json FROM activity_sessions
    WHERE couple_space_id = ? AND id <> ? AND feature = 'food_vote' AND status = 'completed'
      AND updated_at >= ? AND result_json IS NOT NULL ORDER BY updated_at DESC LIMIT 100`)
    .bind(spaceId, sessionId, Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60)
    .all<{ result_json: string }>();
  const recent = new Set((recentRows.results ?? []).flatMap((row) => storedDishPool(row.result_json) ?? []));
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
    : feature === "food_vote" ? foodPayload(input?.conditions) : "{}";
  if (!payloadJson) return json({ error: feature === "food_vote" ? "Thiết lập món ăn không hợp lệ." : "Điều kiện Xé Túi Mù không hợp lệ." }, 400);

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
    if (action === "join") return "active";
    if (action === "decline") return "declined";
  }
  if (action === "cancel" && (row.status === "active" || (row.status === "pending" && actorId === row.created_by_user_id))) return "cancelled";
  if (action === "complete" && row.status === "active") return "completed";
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
  const action = parts[3] as Action;
  if (parts.length === 4 && request.method === "POST" && ["join", "decline", "cancel", "complete"].includes(action)) {
    return act(request, env, userId, spaceId, sessionId, action);
  }
  return json({ error: "Not found" }, 404);
}
