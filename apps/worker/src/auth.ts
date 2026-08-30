interface AuthEnv {
  DB: D1Database;
  AUTH_PEPPER: string;
}

interface UserRow {
  id: string;
  couple_space_id: string;
  username: string;
  password_hash: string;
  display_name: string;
  nickname: string | null;
  avatar_key: string | null;
  color: string;
  role: "boyfriend" | "girlfriend";
  theme: "system" | "light" | "dark";
  reduced_motion: number;
}

interface LimitRow {
  failure_count: number;
  blocked_until: number;
}

const encoder = new TextEncoder();
const COOKIE = "__Host-our_session";
const ITERATIONS = 50_000;
const IDLE_SECONDS = 7 * 24 * 60 * 60;
const ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;
const DUMMY_HASH = `pbkdf2-sha256+pepper$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;
const GENERIC_LOGIN_ERROR = "Tên đăng nhập hoặc mật khẩu không đúng.";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function pepperPassword(password: string, pepper: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(password)));
}

async function derive(password: string, pepper: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", await pepperPassword(password, pepper), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(left, right);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  const passwordLength = encoder.encode(password).length;
  if (passwordLength < 1 || passwordLength > 256 || encoder.encode(pepper).length < 32) {
    throw new Error("Invalid password hashing input");
  }
  const salt = randomBytes(16);
  const hash = await derive(password, pepper, salt, ITERATIONS);
  return `pbkdf2-sha256+pepper$${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

async function verifyPassword(password: string, pepper: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, rawIterations, rawSalt, rawHash, extra] = encoded.split("$");
    const iterations = Number(rawIterations);
    if (extra || algorithm !== "pbkdf2-sha256+pepper" || !Number.isInteger(iterations) || iterations < 50_000 || iterations > 1_000_000) return false;
    const expected = base64ToBytes(rawHash);
    if (expected.length !== 32) return false;
    return timingSafeEqual(await derive(password, pepper, base64ToBytes(rawSalt), iterations), expected);
  } catch {
    return false;
  }
}

async function sha256(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function loginError(status = 401, retryAfter?: number): Response {
  return json(
    { error: status === 429 ? "Thử đăng nhập quá nhiều lần. Vui lòng thử lại sau." : GENERIC_LOGIN_ERROR },
    status,
    retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
  );
}

function cookieValue(request: Request): string | null {
  const prefix = `${COOKIE}=`;
  return request.headers.get("Cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function sessionCookie(token: string, maxAge = ABSOLUTE_SECONDS): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function limitKeys(request: Request, username: string): Promise<[string, string]> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  return Promise.all([sha256(`account:${username}`), sha256(`ip:${ip}`)]);
}

async function blockedFor(db: D1Database, keys: string[], now: number): Promise<number> {
  const rows = await db.batch(keys.map((key) => db.prepare(
    "SELECT failure_count, blocked_until FROM auth_login_limits WHERE key = ?",
  ).bind(key)));
  return Math.max(0, ...rows.map((result) => {
    const row = result.results[0] as unknown as LimitRow | undefined;
    return row ? row.blocked_until - now : 0;
  }));
}

async function recordFailure(db: D1Database, keys: string[], now: number): Promise<void> {
  const sql = `INSERT INTO auth_login_limits (key, failure_count, blocked_until, updated_at)
    VALUES (?, 1, 0, ?)
    ON CONFLICT (key) DO UPDATE SET
      failure_count = failure_count + 1,
      blocked_until = ? + CASE
        WHEN failure_count + 1 < 5 THEN 0
        ELSE min(5 << min(failure_count - 4, 8), 900)
      END,
      updated_at = ?`;
  await db.batch(keys.map((key) => db.prepare(sql).bind(key, now, now, now)));
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    coupleSpaceId: user.couple_space_id,
    username: user.username,
    displayName: user.display_name,
    nickname: user.nickname,
    avatarKey: user.avatar_key,
    color: user.color,
    role: user.role,
    preferences: { theme: user.theme, reducedMotion: Boolean(user.reduced_motion) },
  };
}

const userSql = `SELECT u.id, u.couple_space_id, u.username, u.password_hash,
  u.display_name, u.nickname, u.avatar_key, u.color, u.role,
  p.theme, p.reduced_motion
  FROM users u JOIN user_preferences p ON p.user_id = u.id`;

async function login(request: Request, env: AuthEnv): Promise<Response> {
  if (!env.AUTH_PEPPER || encoder.encode(env.AUTH_PEPPER).length < 32) throw new Error("AUTH_PEPPER is not configured");
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return loginError();
  let input: { username?: unknown; password?: unknown };
  try {
    const body: unknown = await request.json();
    input = body && typeof body === "object" ? body : {};
  } catch {
    return loginError();
  }

  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const passwordBytes = encoder.encode(password).length;
  if (!/^[a-z0-9._-]{3,64}$/.test(username) || passwordBytes < 1 || passwordBytes > 256) return loginError();

  const now = Math.floor(Date.now() / 1000);
  const keys = await limitKeys(request, username);
  const retryAfter = await blockedFor(env.DB, keys, now);
  if (retryAfter > 0) return loginError(429, retryAfter);

  const user = await env.DB.prepare(`${userSql} WHERE u.username = ? COLLATE NOCASE`).bind(username).first<UserRow>();
  const usableHash = user?.password_hash.startsWith("pbkdf2-sha256+pepper$") ? user.password_hash : DUMMY_HASH;
  if (!user || !await verifyPassword(password, env.AUTH_PEPPER, usableHash)) {
    await recordFailure(env.DB, keys, now);
    return loginError();
  }

  const token = bytesToBase64(randomBytes(32)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const expiresAt = now + ABSOLUTE_SECONDS;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_login_limits WHERE key IN (?, ?)").bind(...keys),
    env.DB.prepare(`INSERT INTO auth_sessions
      (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(), user.id, await sha256(token), now, now, now + IDLE_SECONDS, expiresAt,
    ),
  ]);

  return json({ user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token) });
}

async function currentSession(request: Request, env: AuthEnv): Promise<Response> {
  const token = cookieValue(request);
  if (!token || token.length !== 43) return json({ error: "Chưa đăng nhập." }, 401);
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256(token);
  const user = await env.DB.prepare(`${userSql}
    JOIN auth_sessions s ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL
      AND s.expires_at > ? AND s.idle_expires_at > ?`).bind(tokenHash, now, now).first<UserRow>();
  if (!user) return json({ error: "Phiên đăng nhập đã hết hạn." }, 401, { "Set-Cookie": sessionCookie("", 0) });

  await env.DB.prepare(`UPDATE auth_sessions SET
    last_seen_at = ?, idle_expires_at = min(expires_at, ?)
    WHERE token_hash = ? AND last_seen_at < ?`).bind(now, now + IDLE_SECONDS, tokenHash, now - 900).run();
  return json({ user: publicUser(user) });
}

async function logout(request: Request, env: AuthEnv): Promise<Response> {
  const token = cookieValue(request);
  if (token) {
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(Math.floor(Date.now() / 1000), await sha256(token)).run();
  }
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie("", 0) },
  });
}

export async function handleAuth(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/login") return request.method === "POST" ? login(request, env) : json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  if (path === "/api/auth/session") return request.method === "GET" ? currentSession(request, env) : json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  if (path === "/api/auth/logout") return request.method === "POST" ? logout(request, env) : json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  return null;
}
