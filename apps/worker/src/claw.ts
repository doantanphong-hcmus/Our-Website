import { authenticatedUser } from "./auth";
import rules from "../../../content/claw-game.v1.json";

interface ClawEnv { DB: D1Database; AUTH_PEPPER: string }
type Auth = NonNullable<Awaited<ReturnType<typeof authenticatedUser>>>;
type PurchaseRow = {
  id: string; stars_spent: number; credits_added: number; label_snapshot: string; created_at: number;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function purchase(row: PurchaseRow) {
  return { id: row.id, starsSpent: row.stars_spent, creditsAdded: row.credits_added,
    label: row.label_snapshot, createdAt: row.created_at };
}

async function creditState(env: ClawEnv, spaceId: string) {
  const [wallet, daily] = await env.DB.batch([
    env.DB.prepare("SELECT balance, updated_at FROM claw_credit_wallets WHERE couple_space_id = ?").bind(spaceId),
    env.DB.prepare(`SELECT count(*) AS count FROM claw_credit_purchases
      WHERE couple_space_id = ? AND date(created_at, 'unixepoch', '+7 hours') = date('now', '+7 hours')`).bind(spaceId),
  ]);
  const row = wallet.results[0] as { balance: number; updated_at: number } | undefined;
  if (!row) throw new Error("Claw credit wallet is missing");
  return { balance: row.balance, updatedAt: row.updated_at, packCost: rules.economy.packCost,
    attemptsPerPack: rules.economy.attemptsPerPack, purchasedToday: Number(daily.results[0]?.count ?? 0),
    maximumPacksPerDay: rules.economy.maximumPacksPerVietnamDay };
}

async function buyCredits(request: Request, env: ClawEnv, auth: Auth) {
  const body = await request.json<Record<string, unknown>>().catch(() => null);
  if (auth.user.role !== rules.economy.purchaseRole) {
    return json({ error: "Chỉ Nhi mới có thể dùng sao mua lượt gắp thú." }, 403);
  }
  const key = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) return json({ error: "Mã thao tác không hợp lệ." }, 400);

  const existing = await env.DB.prepare(`SELECT id, stars_spent, credits_added, label_snapshot, created_at
    FROM claw_credit_purchases WHERE couple_space_id = ? AND idempotency_key = ?`)
    .bind(auth.user.couple_space_id, key).first<PurchaseRow>();
  if (existing) return json({ credits: await creditState(env, auth.user.couple_space_id),
    purchase: purchase(existing), duplicate: true });

  const [usedKey, stars, credits] = await env.DB.batch([
    env.DB.prepare("SELECT 1 FROM star_transactions WHERE couple_space_id = ? AND idempotency_key = ?")
      .bind(auth.user.couple_space_id, key),
    env.DB.prepare("SELECT balance FROM star_wallets WHERE couple_space_id = ?").bind(auth.user.couple_space_id),
    env.DB.prepare(`SELECT count(*) AS count FROM claw_credit_purchases
      WHERE couple_space_id = ? AND date(created_at, 'unixepoch', '+7 hours') = date('now', '+7 hours')`)
      .bind(auth.user.couple_space_id),
  ]);
  if (usedKey.results.length) return json({ error: "Mã thao tác đã được dùng cho một giao dịch khác." }, 409);
  const starBalance = Number(stars.results[0]?.balance ?? 0);
  if (Number(credits.results[0]?.count ?? 0) >= rules.economy.maximumPacksPerVietnamDay) {
    return json({ error: "Hôm nay em đã mua đủ lượt gắp thú rồi nhé." }, 409);
  }
  if (starBalance < rules.economy.packCost) return json({ error: "Ví chưa đủ sao để mua lượt gắp thú." }, 409);

  const row: PurchaseRow = { id: crypto.randomUUID(), stars_spent: rules.economy.packCost,
    credits_added: rules.economy.attemptsPerPack, label_snapshot: `${rules.economy.attemptsPerPack} lượt gắp thú`,
    created_at: Math.floor(Date.now() / 1000) };
  await env.DB.prepare(`INSERT INTO claw_credit_purchases
    (id, couple_space_id, buyer_user_id, idempotency_key, star_transaction_id,
      stars_spent, credits_added, label_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, auth.user.couple_space_id, auth.user.id, key, crypto.randomUUID(),
      row.stars_spent, row.credits_added, row.label_snapshot, row.created_at).run();
  const starWallet = await env.DB.prepare("SELECT balance, updated_at FROM star_wallets WHERE couple_space_id = ?")
    .bind(auth.user.couple_space_id).first<{ balance: number; updated_at: number }>();
  return json({ wallet: { balance: starWallet?.balance ?? 0, updatedAt: starWallet?.updated_at ?? row.created_at },
    credits: await creditState(env, auth.user.couple_space_id), purchase: purchase(row) }, 201);
}

export async function handleClaw(request: Request, env: ClawEnv): Promise<Response> {
  const auth = await authenticatedUser(request, env);
  if (!auth) return json({ error: "Phiên đăng nhập đã hết hạn." }, 401);
  const path = new URL(request.url).pathname;
  if (path === "/api/claw/credits" && request.method === "GET") {
    return json({ credits: await creditState(env, auth.user.couple_space_id) });
  }
  if (path === "/api/claw/credits/purchase" && request.method === "POST") return buyCredits(request, env, auth);
  return json({ error: "Không tìm thấy." }, 404);
}
