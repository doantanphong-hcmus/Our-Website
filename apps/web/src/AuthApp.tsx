import { useEffect, useState, type FormEvent } from "react";
import { App } from "./App";
import { userFrom, type User } from "./user";

type AuthState =
  | { kind: "checking" }
  | { kind: "guest" }
  | { kind: "authenticated"; user: User }
  | { kind: "unavailable" };

function StatusScreen({ retry }: { retry?: () => void }) {
  return (
    <main className="auth-status" aria-live="polite">
      <div className="product-mark" aria-hidden="true">P<span>&</span>N</div>
      {retry ? (
        <>
          <h1>Chưa thể kết nối</h1>
          <p>Không kiểm tra được phiên đăng nhập. Kết nối của ông vẫn được giữ nguyên.</p>
          <button type="button" onClick={retry}>Thử lại</button>
        </>
      ) : (
        <>
          <div className="auth-status__pulse" aria-hidden="true" />
          <h1>Đang mở góc nhỏ của hai đứa…</h1>
          <p>Chờ một chút nhé.</p>
        </>
      )}
    </main>
  );
}

function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const user = response.ok ? userFrom(payload) : null;
      if (user) return onSuccess(user);
      const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Đăng nhập chưa thành công. Vui lòng thử lại.";
      setError(message);
    } catch {
      setError("Không thể kết nối. Kiểm tra mạng rồi thử lại nhé.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-heading">
          <div className="product-mark" aria-hidden="true">P<span>&</span>N</div>
          <p className="eyebrow">Phong & Nhi</p>
          <h1 id="login-title">Chào mừng về nhà</h1>
          <p>Đăng nhập để tiếp tục câu chuyện của hai đứa.</p>
        </div>

        <div className="login-illustration" aria-hidden="true">
          <span className="character character--one"><i /></span>
          <span className="character character--two"><i /></span>
          <b />
        </div>

        <form onSubmit={submit} aria-busy={pending}>
          <label htmlFor="username">Tên đăng nhập</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            enterKeyHint="next"
            maxLength={64}
            readOnly={pending}
            required
          />

          <label htmlFor="password">Mật khẩu</label>
          <div className="password-field">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              enterKeyHint="go"
              maxLength={256}
              readOnly={pending}
              required
            />
            <button
              type="button"
              aria-pressed={showPassword}
              aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? "Ẩn" : "Hiện"}
            </button>
          </div>

          <div className="login-feedback" role={error ? "alert" : "status"} aria-live="polite">
            {error && <p>{error}</p>}
          </div>
          <button className="login-submit" type="submit" disabled={pending}>
            {pending ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function AuthApp() {
  const [auth, setAuth] = useState<AuthState>({ kind: "checking" });

  async function checkSession(signal?: AbortSignal) {
    setAuth({ kind: "checking" });
    try {
      const response = await fetch("/api/auth/session", { credentials: "same-origin", signal });
      if (response.status === 401) return setAuth({ kind: "guest" });
      const user = response.ok ? userFrom(await response.json().catch(() => null)) : null;
      setAuth(user ? { kind: "authenticated", user } : { kind: "unavailable" });
    } catch {
      if (signal?.aborted) return;
      setAuth({ kind: "unavailable" });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (auth.kind !== "authenticated") document.title = `${auth.kind === "guest" ? "Đăng nhập" : "Đang kết nối"} · Phong & Nhi`;
  }, [auth.kind]);

  async function logout() {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("Không thể đăng xuất lúc này.");
    setAuth({ kind: "guest" });
  }

  if (auth.kind === "checking") return <StatusScreen />;
  if (auth.kind === "unavailable") return <StatusScreen retry={() => void checkSession()} />;
  if (auth.kind === "guest") return <Login onSuccess={(user) => setAuth({ kind: "authenticated", user })} />;
  return <App
    user={auth.user}
    onUserChange={(user) => setAuth({ kind: "authenticated", user })}
    onLogout={logout}
  />;
}
