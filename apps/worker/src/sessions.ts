import { authenticatedUser } from "./auth";

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
  expires_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

const features = ["blind_bag", "food_vote", "deep_talk"];
const commandPattern = /^[A-Za-z0-9_-]{8,100}$/;
const selectSession = `SELECT id, feature, status, created_by_user_id, version,
  expires_at, completed_at, created_at, updated_at FROM activity_sessions`;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function publicSession(row: SessionRow) {
  return {
    id: row.id,
    feature: row.feature,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    version: row.version,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  await expirePending(env.DB, spaceId);
  const duplicate = await env.DB.prepare(`${selectSession} WHERE couple_space_id = ? AND idempotency_key = ?`)
    .bind(spaceId, idempotencyKey).first<SessionRow>();
  if (duplicate) return duplicate.feature === feature && duplicate.created_by_user_id === userId
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
        (id, couple_space_id, feature, status, created_by_user_id, version, idempotency_key, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, 1, ?, ?, ?, ?)`)
        .bind(id, spaceId, feature, userId, idempotencyKey, now + 24 * 60 * 60, now, now),
      env.DB.prepare(`INSERT INTO activity_session_events
        (idempotency_key, session_id, couple_space_id, actor_user_id, action, from_status, to_status, version)
        VALUES (?, ?, ?, ?, 'create', 'none', 'pending', 1)`)
        .bind(idempotencyKey, id, spaceId, userId),
    ]);
  } catch {
    const retry = await env.DB.prepare(`${selectSession} WHERE couple_space_id = ? AND idempotency_key = ?`)
      .bind(spaceId, idempotencyKey).first<SessionRow>();
    if (retry && retry.feature === feature && retry.created_by_user_id === userId) return json({ session: publicSession(retry), duplicate: true });
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
      await expirePending(env.DB, spaceId);
      const rows = await env.DB.prepare(`${selectSession} WHERE couple_space_id = ? ORDER BY updated_at DESC LIMIT 20`)
        .bind(spaceId).all<SessionRow>();
      return json({ sessions: rows.results.map(publicSession) });
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
  const action = parts[3] as Action;
  if (parts.length === 4 && request.method === "POST" && ["join", "decline", "cancel", "complete"].includes(action)) {
    return act(request, env, userId, spaceId, sessionId, action);
  }
  return json({ error: "Not found" }, 404);
}
