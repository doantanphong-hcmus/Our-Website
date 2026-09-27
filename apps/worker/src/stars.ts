import { authenticatedUser } from "./auth";
import catalog from "../../../content/english-stars.v1.json";

interface StarsEnv { DB: D1Database; AUTH_PEPPER: string }
type Activity = (typeof catalog.activities)[number];
type TransactionRow = {
  id: string; kind: "award" | "redeem" | "adjustment"; delta: number; balance_after: number;
  rule_id: string; label_snapshot: string; note: string | null; created_at: number;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function transaction(row: TransactionRow) {
  return { id: row.id, kind: row.kind, delta: row.delta, balanceAfter: row.balance_after,
    ruleId: row.rule_id, label: row.label_snapshot, note: row.note, createdAt: row.created_at };
}

async function wallet(env: StarsEnv, spaceId: string) {
  const row = await env.DB.prepare("SELECT balance, updated_at FROM star_wallets WHERE couple_space_id = ?")
    .bind(spaceId).first<{ balance: number; updated_at: number }>();
  if (!row) throw new Error("Star wallet is missing");
  const history = await env.DB.prepare(`SELECT id, kind, delta, balance_after, rule_id, label_snapshot, note, created_at
    FROM star_transactions WHERE couple_space_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30`)
    .bind(spaceId).all<TransactionRow>();
  return { balance: row.balance, updatedAt: row.updated_at, currency: catalog.currency,
    activities: catalog.activities, rewards: catalog.rewards, transactions: history.results.map(transaction) };
}

async function award(request: Request, env: StarsEnv, auth: NonNullable<Awaited<ReturnType<typeof authenticatedUser>>>) {
  const body = await request.json<Record<string, unknown>>().catch(() => null);
  if (auth.user.role !== "boyfriend") return json({ error: "Chỉ Nam mới có thể tặng sao." }, 403);
  if (!body) return json({ error: "Dữ liệu không hợp lệ." }, 400);
  const activity = catalog.activities.find((item) => item.id === body.activityId) as Activity | undefined;
  const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  if (!activity || !/^[A-Za-z0-9_-]{8,100}$/.test(key) || (note?.length ?? 0) > 500) {
    return json({ error: "Hoạt động hoặc mã thao tác không hợp lệ." }, 400);
  }
  const points = activity.id === "special" ? Number(body.points) : "points" in activity ? activity.points : NaN;
  if (!Number.isInteger(points) || points < 1 || points > 100 || (activity.id === "special" && !note)) {
    return json({ error: "Thưởng đặc biệt cần từ 1 đến 100 sao và có lý do." }, 400);
  }

  const existing = await env.DB.prepare(`SELECT id, kind, delta, balance_after, rule_id, label_snapshot, note, created_at
    FROM star_transactions WHERE couple_space_id = ? AND idempotency_key = ?`)
    .bind(auth.user.couple_space_id, key).first<TransactionRow>();
  if (existing) {
    if (existing.rule_id !== activity.id || existing.delta !== points || existing.note !== note) {
      return json({ error: "Mã thao tác đã được dùng cho một lần tặng khác." }, 409);
    }
    return json({ wallet: await wallet(env, auth.user.couple_space_id), transaction: transaction(existing), duplicate: true });
  }

  if (activity.limit === "daily") {
    const daily = await env.DB.prepare(`SELECT 1 FROM star_transactions
      WHERE couple_space_id = ? AND kind = 'award' AND rule_id = ?
      AND date(created_at, 'unixepoch', '+7 hours') = date('now', '+7 hours') LIMIT 1`)
      .bind(auth.user.couple_space_id, activity.id).first();
    if (daily) return json({ error: `${activity.label} hôm nay đã được tặng sao rồi.` }, 409);
  }

  const current = await env.DB.prepare("SELECT balance FROM star_wallets WHERE couple_space_id = ?")
    .bind(auth.user.couple_space_id).first<{ balance: number }>();
  if (!current) return json({ error: "Chưa tìm thấy ví sao." }, 409);
  const next = current.balance + points;
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE star_wallets SET balance = ?, updated_at = ?
      WHERE couple_space_id = ? AND balance = ?`).bind(next, now, auth.user.couple_space_id, current.balance),
    env.DB.prepare(`INSERT INTO star_transactions
      (id, couple_space_id, actor_user_id, idempotency_key, kind, delta, balance_after, rule_id, label_snapshot, note, created_at)
      SELECT ?, ?, ?, ?, 'award', ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(id, auth.user.couple_space_id, auth.user.id, key, points, next, activity.id, activity.label, note, now),
  ]);
  if (results[1].meta.changes !== 1) return json({ error: "Số dư vừa thay đổi, vui lòng thử lại." }, 409);
  const created: TransactionRow = { id, kind: "award", delta: points, balance_after: next,
    rule_id: activity.id, label_snapshot: activity.label, note, created_at: now };
  return json({ wallet: await wallet(env, auth.user.couple_space_id), transaction: transaction(created) }, 201);
}

async function claimCelebrations(request: Request, env: StarsEnv, auth: NonNullable<Awaited<ReturnType<typeof authenticatedUser>>>) {
  await request.arrayBuffer();
  if (auth.user.role !== "girlfriend") return json({ error: "Chỉ Nhi mới nhận lời chúc này." }, 403);
  const rows = await env.DB.prepare(`SELECT t.id, t.kind, t.delta, t.balance_after, t.rule_id,
      t.label_snapshot, t.note, t.created_at
    FROM star_transactions t LEFT JOIN star_celebrations c ON c.transaction_id = t.id
    WHERE t.couple_space_id = ? AND t.kind = 'award' AND c.transaction_id IS NULL
    ORDER BY t.created_at, t.rowid LIMIT 50`).bind(auth.user.couple_space_id).all<TransactionRow>();
  if (!rows.results.length) return json({ celebrations: [] });
  await env.DB.batch(rows.results.map((row) => env.DB.prepare(`INSERT INTO star_celebrations
    (transaction_id, couple_space_id, beneficiary_user_id) VALUES (?, ?, ?)`)
    .bind(row.id, auth.user.couple_space_id, auth.user.id)));
  return json({ celebrations: rows.results.map(transaction) });
}

export async function handleStars(request: Request, env: StarsEnv): Promise<Response> {
  const auth = await authenticatedUser(request, env);
  if (!auth) return json({ error: "Phiên đăng nhập đã hết hạn." }, 401);
  const path = new URL(request.url).pathname;
  if (path === "/api/stars" && request.method === "GET") return json({ wallet: await wallet(env, auth.user.couple_space_id) });
  if (path === "/api/stars/award" && request.method === "POST") return award(request, env, auth);
  if (path === "/api/stars/celebrations/claim" && request.method === "POST") return claimCelebrations(request, env, auth);
  return json({ error: "Không tìm thấy." }, 404);
}
