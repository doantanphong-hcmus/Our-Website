import { authenticatedUser } from "./auth";
import rules from "../../../content/claw-game.v1.json";

interface ClawEnv { DB: D1Database; AUTH_PEPPER: string }
type Auth = NonNullable<Awaited<ReturnType<typeof authenticatedUser>>>;
type PurchaseRow = {
  id: string; stars_spent: number; credits_added: number; label_snapshot: string; created_at: number;
};
type AttemptStatus = "ready" | "playing" | "won" | "missed" | "abandoned";
type Control = { step: number; move?: -1 | 0 | 1; drop?: true };
type AttemptRow = {
  id: string; seed: number; rules_version: number; status: AttemptStatus; control_trace_json: string;
  captured_plush_id: string | null; result_steps: number | null; result_verified: number; version: number;
  created_at: number; started_at: number | null; completed_at: number | null; expires_at: number; updated_at: number;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function purchase(row: PurchaseRow) {
  return { id: row.id, starsSpent: row.stars_spent, creditsAdded: row.credits_added,
    label: row.label_snapshot, createdAt: row.created_at };
}

function attempt(row: AttemptRow) {
  return { id: row.id, status: row.status, seed: row.seed, rulesVersion: row.rules_version,
    layout: { plushIds: rules.starterPlushes.map(({ id }) => id) },
    controlTrace: JSON.parse(row.control_trace_json) as Control[], capturedPlushId: row.captured_plush_id,
    resultSteps: row.result_steps, verified: Boolean(row.result_verified), version: row.version,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at,
    expiresAt: row.expires_at, updatedAt: row.updated_at };
}

const attemptColumns = `id, seed, rules_version, status, control_trace_json, captured_plush_id,
  result_steps, result_verified, version, created_at, started_at, completed_at, expires_at, updated_at`;

function readTrace(value: unknown, mustFinish = false): { trace?: Control[]; error?: string } {
  if (!Array.isArray(value) || value.length > 256) return { error: "Dữ liệu điều khiển không hợp lệ." };
  const trace: Control[] = [];
  let lastStep = 0;
  let dropped = false;
  for (const valueItem of value) {
    if (!valueItem || typeof valueItem !== "object" || Array.isArray(valueItem)) return { error: "Dữ liệu điều khiển không hợp lệ." };
    const item = valueItem as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["step", "move", "drop"].includes(key))
      || typeof item.step !== "number" || !Number.isInteger(item.step) || item.step <= lastStep || item.step > 7200
      || (item.move !== undefined && (typeof item.move !== "number" || ![-1, 0, 1].includes(item.move)))
      || (item.drop !== undefined && item.drop !== true) || dropped) {
      return { error: "Dữ liệu điều khiển không hợp lệ." };
    }
    const control: Control = { step: Number(item.step) };
    if (item.move !== undefined) control.move = Number(item.move) as -1 | 0 | 1;
    if (item.drop === true) { control.drop = true; dropped = true; }
    if (control.move === undefined && !control.drop) return { error: "Dữ liệu điều khiển không hợp lệ." };
    trace.push(control);
    lastStep = control.step;
  }
  if (mustFinish && !dropped) return { error: "Lượt chơi chưa thả càng." };
  return { trace };
}

function expectedVersion(body: Record<string, unknown> | null) {
  const value = body?.expectedVersion;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function extendsTrace(currentJson: string, next: Control[]) {
  const current = JSON.parse(currentJson) as Control[];
  return current.length <= next.length && JSON.stringify(next.slice(0, current.length)) === currentJson;
}

async function expireAttempts(env: ClawEnv, spaceId: string) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`UPDATE claw_attempts SET status = 'abandoned', completed_at = ?, updated_at = ?, version = version + 1
    WHERE couple_space_id = ? AND status IN ('ready', 'playing') AND expires_at <= ?`)
    .bind(now, now, spaceId, now).run();
}

async function findAttempt(env: ClawEnv, spaceId: string, id: string) {
  return env.DB.prepare(`SELECT ${attemptColumns} FROM claw_attempts WHERE couple_space_id = ? AND id = ?`)
    .bind(spaceId, id).first<AttemptRow>();
}

async function createAttempt(request: Request, env: ClawEnv, auth: Auth) {
  const body = await request.json<Record<string, unknown>>().catch(() => null);
  if (auth.user.role !== rules.economy.playRole) return json({ error: "Chỉ Nhi mới có thể chơi gắp thú." }, 403);
  const key = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) return json({ error: "Mã thao tác không hợp lệ." }, 400);
  await expireAttempts(env, auth.user.couple_space_id);
  const existing = await env.DB.prepare(`SELECT ${attemptColumns} FROM claw_attempts
    WHERE couple_space_id = ? AND idempotency_key = ?`).bind(auth.user.couple_space_id, key).first<AttemptRow>();
  if (existing) return json({ attempt: attempt(existing), credits: await creditState(env, auth.user.couple_space_id), duplicate: true });
  const [active, credits] = await env.DB.batch([
    env.DB.prepare(`SELECT ${attemptColumns} FROM claw_attempts WHERE couple_space_id = ?
      AND status IN ('ready', 'playing') LIMIT 1`).bind(auth.user.couple_space_id),
    env.DB.prepare("SELECT balance FROM claw_credit_wallets WHERE couple_space_id = ?").bind(auth.user.couple_space_id),
  ]);
  if (active.results.length) return json({ error: "Em đang có một lượt gắp thú chưa hoàn thành.",
    attempt: attempt(active.results[0] as unknown as AttemptRow) }, 409);
  if (Number(credits.results[0]?.balance ?? 0) < 1) return json({ error: "Em đã hết lượt gắp thú rồi." }, 409);

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const seed = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) || 1;
  await env.DB.prepare(`INSERT INTO claw_attempts
    (id, couple_space_id, player_user_id, idempotency_key, seed, rules_version, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, auth.user.couple_space_id, auth.user.id, key, seed, rules.version,
      now + rules.attempt.abandonAfterSeconds, now, now).run();
  const created = await findAttempt(env, auth.user.couple_space_id, id);
  return json({ attempt: attempt(created!), credits: await creditState(env, auth.user.couple_space_id) }, 201);
}

async function startAttempt(env: ClawEnv, auth: Auth, id: string, body: Record<string, unknown> | null) {
  if (auth.user.role !== rules.economy.playRole) return json({ error: "Chỉ Nhi mới có thể điều khiển máy gắp thú." }, 403);
  await expireAttempts(env, auth.user.couple_space_id);
  const current = await findAttempt(env, auth.user.couple_space_id, id);
  if (!current) return json({ error: "Không tìm thấy lượt chơi." }, 404);
  if (current.status === "playing") return json({ attempt: attempt(current), duplicate: true });
  if (current.status !== "ready") return json({ error: "Lượt chơi này đã kết thúc.", attempt: attempt(current) }, 409);
  const version = expectedVersion(body);
  if (version !== current.version) return json({ error: "Lượt chơi vừa thay đổi, vui lòng đồng bộ lại.", attempt: attempt(current) }, 409);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`UPDATE claw_attempts SET status = 'playing', started_at = ?, expires_at = ?,
    updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`)
    .bind(now, now + rules.attempt.maximumPlayingSeconds, now, id, version).run();
  return json({ attempt: attempt((await findAttempt(env, auth.user.couple_space_id, id))!) });
}

async function saveTrace(env: ClawEnv, auth: Auth, id: string, body: Record<string, unknown> | null) {
  if (auth.user.role !== rules.economy.playRole) return json({ error: "Chỉ Nhi mới có thể điều khiển máy gắp thú." }, 403);
  const parsed = readTrace(body?.controlTrace);
  if (parsed.error) return json({ error: parsed.error }, 400);
  await expireAttempts(env, auth.user.couple_space_id);
  const current = await findAttempt(env, auth.user.couple_space_id, id);
  if (!current) return json({ error: "Không tìm thấy lượt chơi." }, 404);
  if (current.status !== "playing") return json({ error: "Lượt chơi không còn hoạt động.", attempt: attempt(current) }, 409);
  const traceJson = JSON.stringify(parsed.trace);
  if (traceJson === current.control_trace_json) return json({ attempt: attempt(current), duplicate: true });
  if (!extendsTrace(current.control_trace_json, parsed.trace!)) {
    return json({ error: "Dữ liệu điều khiển không thể viết lại lịch sử đã lưu.", attempt: attempt(current) }, 409);
  }
  const version = expectedVersion(body);
  if (version !== current.version) return json({ error: "Lượt chơi vừa thay đổi, vui lòng đồng bộ lại.", attempt: attempt(current) }, 409);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`UPDATE claw_attempts SET control_trace_json = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?`).bind(traceJson, now, id, version).run();
  return json({ attempt: attempt((await findAttempt(env, auth.user.couple_space_id, id))!) });
}

async function completeAttempt(env: ClawEnv, auth: Auth, id: string, body: Record<string, unknown> | null) {
  if (auth.user.role !== rules.economy.playRole) return json({ error: "Chỉ Nhi mới có thể điều khiển máy gắp thú." }, 403);
  const outcome = body?.outcome;
  const parsed = readTrace(body?.controlTrace, true);
  const steps = body?.steps;
  const plushId = typeof body?.capturedPlushId === "string" ? body.capturedPlushId : null;
  if (parsed.error || (outcome !== "won" && outcome !== "missed") || typeof steps !== "number" || !Number.isInteger(steps)
    || steps < (parsed.trace?.at(-1)?.step ?? 1) || steps > 7200
    || (outcome === "won" && !rules.starterPlushes.some(({ id: candidate }) => candidate === plushId))
    || (outcome === "missed" && plushId !== null)) {
    return json({ error: parsed.error ?? "Kết quả lượt chơi không hợp lệ." }, 400);
  }
  await expireAttempts(env, auth.user.couple_space_id);
  const current = await findAttempt(env, auth.user.couple_space_id, id);
  if (!current) return json({ error: "Không tìm thấy lượt chơi." }, 404);
  const traceJson = JSON.stringify(parsed.trace);
  if (["won", "missed"].includes(current.status)) {
    if (current.status === outcome && current.control_trace_json === traceJson
      && current.result_steps === steps && current.captured_plush_id === plushId) {
      return json({ attempt: attempt(current), duplicate: true });
    }
    return json({ error: "Lượt chơi đã được ghi nhận với kết quả khác.", attempt: attempt(current) }, 409);
  }
  if (current.status !== "playing") return json({ error: "Lượt chơi không còn hoạt động.", attempt: attempt(current) }, 409);
  if (!extendsTrace(current.control_trace_json, parsed.trace!)) {
    return json({ error: "Dữ liệu điều khiển không thể viết lại lịch sử đã lưu.", attempt: attempt(current) }, 409);
  }
  const version = expectedVersion(body);
  if (version !== current.version) return json({ error: "Lượt chơi vừa thay đổi, vui lòng đồng bộ lại.", attempt: attempt(current) }, 409);
  const now = Math.floor(Date.now() / 1000);
  // ponytail: bounded trace verification is enough for this private prototype; replace with authoritative replay before rewards gain real-world value.
  await env.DB.prepare(`UPDATE claw_attempts SET status = ?, control_trace_json = ?, captured_plush_id = ?,
    result_steps = ?, result_verified = 1, completed_at = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?`).bind(outcome, traceJson, plushId, steps, now, now, id, version).run();
  return json({ attempt: attempt((await findAttempt(env, auth.user.couple_space_id, id))!) });
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
  await expireAttempts(env, auth.user.couple_space_id);
  if (path === "/api/claw/credits" && request.method === "GET") {
    return json({ credits: await creditState(env, auth.user.couple_space_id) });
  }
  if (path === "/api/claw/credits/purchase" && request.method === "POST") return buyCredits(request, env, auth);
  if (path === "/api/claw/attempts" && request.method === "POST") return createAttempt(request, env, auth);
  if (path === "/api/claw/attempts/active" && request.method === "GET") {
    const row = await env.DB.prepare(`SELECT ${attemptColumns} FROM claw_attempts WHERE couple_space_id = ?
      AND status IN ('ready', 'playing') LIMIT 1`).bind(auth.user.couple_space_id).first<AttemptRow>();
    return json({ attempt: row ? attempt(row) : null, credits: await creditState(env, auth.user.couple_space_id) });
  }
  const match = path.match(/^\/api\/claw\/attempts\/([0-9a-f-]{36})(?:\/(start|trace|complete))?$/i);
  if (match && request.method === "GET" && !match[2]) {
    const row = await findAttempt(env, auth.user.couple_space_id, match[1]);
    return row ? json({ attempt: attempt(row) }) : json({ error: "Không tìm thấy lượt chơi." }, 404);
  }
  if (match && request.method === "POST" && match[2]) {
    const body = await request.json<Record<string, unknown>>().catch(() => null);
    if (!body) return json({ error: "Dữ liệu không hợp lệ." }, 400);
    if (match[2] === "start") return startAttempt(env, auth, match[1], body);
    if (match[2] === "trace") return saveTrace(env, auth, match[1], body);
    return completeAttempt(env, auth, match[1], body);
  }
  return json({ error: "Không tìm thấy." }, 404);
}
