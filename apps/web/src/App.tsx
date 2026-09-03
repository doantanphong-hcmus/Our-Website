import { useEffect, useState, type AnchorHTMLAttributes, type FormEvent, type MouseEvent } from "react";
import { userFrom, type User } from "./user";
import { discardOfflineCommands, queueSessionCommand, type OfflineQueueEventDetail } from "./offlineQueue";
import { EmptyState, ErrorState, LoadingState } from "./uiStates";
import { BlindBagForm } from "./BlindBagForm";
import { FoodSessionSetup } from "./FoodSessionSetup";
import { DeepTalkSetup } from "./DeepTalkSetup";

type Route = {
  path: string;
  label: string;
  eyebrow: string;
  description: string;
  icon: IconName;
};

type IconName = "home" | "compass" | "food" | "heart" | "calendar" | "sparkle" | "user" | "lock";

function Icon({ name }: { name: IconName }) {
  const paths = {
    home: <><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></>,
    food: <><path d="M5 13h14c0 4-3 7-7 7s-7-3-7-7Z"/><path d="M8 10c-2-2 2-3 0-5M12 10c-2-2 2-3 0-5M16 10c-2-2 2-3 0-5"/></>,
    heart: <path d="M20.8 5.7c-2-2-5.2-2-7.2 0L12 7.3l-1.6-1.6a5.1 5.1 0 0 0-7.2 7.2L12 21l8.8-8.1a5.1 5.1 0 0 0 0-7.2Z"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></>,
    sparkle: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 3.5-6 8-6s7.2 1.8 8 6"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const bottomRoutes: Route[] = [
  { path: "/", label: "Trang chủ", eyebrow: "Chào hai đứa", description: "Một góc nhỏ để bắt đầu điều gì đó cùng nhau.", icon: "home" },
  { path: "/di-dau", label: "Đi đâu", eyebrow: "Cùng ra ngoài", description: "", icon: "compass" },
  { path: "/an-gi", label: "Ăn gì", eyebrow: "Một món cho hôm nay", description: "Để việc chọn món nhẹ nhàng hơn một chút.", icon: "food" },
  { path: "/deep-talk", label: "Deep Talk", eyebrow: "Chuyện của hai đứa", description: "Một khoảng yên để nghe và hiểu nhau hơn.", icon: "heart" },
  { path: "/lich", label: "Lịch", eyebrow: "Những ngày của mình", description: "Giữ các dịp quan trọng ở cùng một nơi.", icon: "calendar" },
];

const extraRoutes: Route[] = [
  { path: "/di-dau/xe-tui-mu", label: "Xé Túi Mù", eyebrow: "Đi đâu", description: "Mở một gợi ý bất ngờ cho buổi hẹn tiếp theo.", icon: "sparkle" },
  { path: "/tai-khoan", label: "Thông tin tài khoản", eyebrow: "Cá nhân", description: "Thông tin của tài khoản đang đăng nhập.", icon: "user" },
  { path: "/doi-mat-khau", label: "Đổi mật khẩu", eyebrow: "Bảo mật", description: "Cập nhật mật khẩu cho tài khoản.", icon: "lock" },
];

function navigate(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

type AppLinkProps = { path: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">;

function AppLink({ path, ...props }: AppLinkProps) {
  return <a {...props} href={path} onClick={(event) => navigate(event, path)} />;
}

function OfflineQueueNotice() {
  const [status, setStatus] = useState<OfflineQueueEventDetail["status"] | null>(null);
  useEffect(() => {
    const update = (event: Event) => setStatus((event as CustomEvent<OfflineQueueEventDetail>).detail.status);
    window.addEventListener("our:offline-queue", update);
    return () => window.removeEventListener("our:offline-queue", update);
  }, []);
  if (!status || status === "idle") return null;
  const messages = {
    queued: "Đã lưu thao tác. Sẽ gửi khi có mạng.",
    retrying: "Kết nối chưa ổn định. Đang chờ để thử lại…",
    sent: "Đã đồng bộ thao tác.",
    conflict: "Phiên đã thay đổi trên thiết bị kia. Vui lòng kiểm tra lại trước khi thao tác tiếp.",
    failed: "Không thể đồng bộ thao tác đã lưu.",
  };
  return (
    <div className="offline-queue-notice" role={status === "conflict" || status === "failed" ? "alert" : "status"}>
      <span>{messages[status]}</span>
      {(status === "conflict" || status === "failed") && <button type="button" onClick={() => void discardOfflineCommands()}>Bỏ thao tác đang chờ</button>}
    </div>
  );
}

type ActivitySession = {
  id: string;
  feature: "blind_bag" | "food_vote" | "deep_talk";
  status: "pending" | "active";
  createdByUserId: string;
  version: number;
  createdAt: number;
};

const activities = {
  blind_bag: { label: "Xé Túi Mù", path: "/di-dau/xe-tui-mu", icon: "sparkle" },
  food_vote: { label: "Hôm Nay Ăn Gì", path: "/an-gi", icon: "food" },
  deep_talk: { label: "Deep Talk", path: "/deep-talk", icon: "heart" },
} as const;

function sessionsFrom(payload: unknown): ActivitySession[] {
  if (!payload || typeof payload !== "object" || !("sessions" in payload) || !Array.isArray(payload.sessions)) return [];
  return payload.sessions.filter((session): session is ActivitySession => {
    if (!session || typeof session !== "object") return false;
    const value = session as Record<string, unknown>;
    return typeof value.id === "string" && value.id.length === 36
      && typeof value.feature === "string" && Object.hasOwn(activities, value.feature)
      && ["pending", "active"].includes(String(value.status))
      && typeof value.createdByUserId === "string" && Number.isInteger(value.version)
      && typeof value.createdAt === "number";
  });
}

function Home({ user }: { user: User }) {
  const [sessions, setSessions] = useState<ActivitySession[] | null>(null);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState<string[]>([]);
  const now = new Date();
  const name = user.nickname ?? user.displayName;
  const partner = user.role === "boyfriend" ? "Nhi" : "Phong";
  const partnerColor = user.role === "boyfriend" ? "#3F6F61" : "#9F3F59";
  const greeting = now.getHours() < 11 ? "Chào buổi sáng" : now.getHours() < 18 ? "Chào buổi chiều" : "Chào buổi tối";

  async function loadSessions() {
    setError("");
    setSessions(null);
    try {
      const response = await fetch("/api/sessions", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Không tải được các phiên đang diễn ra.");
      setSessions(sessionsFrom(await response.json()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được các phiên đang diễn ra.");
    }
  }

  useEffect(() => {
    void loadSessions();
    const synced = (event: Event) => {
      const detail = (event as CustomEvent<OfflineQueueEventDetail>).detail;
      if (detail.status === "sent" || detail.status === "conflict") {
        setClosing([]);
        void loadSessions();
      }
    };
    window.addEventListener("our:offline-queue", synced);
    return () => window.removeEventListener("our:offline-queue", synced);
  }, []);

  async function closeSession(session: ActivitySession) {
    setClosing((items) => [...items, session.id]);
    try {
      await queueSessionCommand(`/api/sessions/${session.id}/cancel`, { expectedVersion: session.version });
    } catch (reason) {
      setClosing((items) => items.filter((id) => id !== session.id));
      setError(reason instanceof Error ? reason.message : "Không thể đóng phiên.");
    }
  }

  return (
    <section className="home" aria-labelledby="page-title">
      <header className="home-greeting">
        <p className="eyebrow">{greeting}</p>
        <h1 id="page-title">{name} ơi, mình làm gì cùng nhau?</h1>
        <div className="couple-avatars" role="img" aria-label={`${name} và ${partner}`}>
          <span style={{ background: user.color }}>{name.slice(0, 1).toUpperCase()}</span>
          <i aria-hidden="true">♥</i>
          <span style={{ background: partnerColor }}>{partner.slice(0, 1)}</span>
        </div>
      </header>

      <nav className="activity-cards" aria-label="Hoạt động chính">
        {Object.values(activities).map((activity) => (
          <AppLink key={activity.path} path={activity.path}>
            <span><Icon name={activity.icon} /></span>
            <strong>{activity.label}</strong>
          </AppLink>
        ))}
      </nav>

      <section className="home-section" aria-labelledby="active-sessions-title">
        <h2 id="active-sessions-title">Phiên đang diễn ra</h2>
        {error && sessions === null ? (
          <ErrorState title="Chưa xem được các phiên" retry={() => void loadSessions()}>{error}</ErrorState>
        ) : sessions === null ? (
          <LoadingState label="Đang tải các phiên…" />
        ) : sessions.length ? sessions.map((session) => {
          const activity = activities[session.feature];
          const creator = session.createdByUserId === user.id ? name : partner;
          const canClose = session.status === "active" || session.createdByUserId === user.id;
          return (
            <article className="session-card" key={session.id}>
              <div>
                <strong>{activity.label}</strong>
                <span>{session.status === "pending" ? "Chờ người còn lại" : "Đang diễn ra"}</span>
              </div>
              <dl>
                <div><dt>Bắt đầu bởi</dt><dd>{creator}</dd></div>
                <div><dt>Tạo lúc</dt><dd><time dateTime={new Date(session.createdAt * 1000).toISOString()}>{new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(session.createdAt * 1000)}</time></dd></div>
              </dl>
              <div className="session-actions">
                <AppLink path={activity.path}>Tiếp tục</AppLink>
                {canClose && <button type="button" disabled={closing.includes(session.id)} onClick={() => void closeSession(session)}>{closing.includes(session.id) ? "Đang đóng…" : "Đóng phiên"}</button>}
              </div>
            </article>
          );
        }) : (
          <EmptyState
            title="Chưa có phiên nào đang mở"
            action={<AppLink path="/di-dau/xe-tui-mu" className="primary-link">Bắt đầu Xé Túi Mù</AppLink>}
          >Chọn một hoạt động để hai đứa bắt đầu cùng nhau.</EmptyState>
        )}
        {error && sessions !== null && <ErrorState title="Chưa thể đóng phiên" retry={() => void loadSessions()}>{error}</ErrorState>}
      </section>

      <AppLink path="/lich" className="today-card">
        <span aria-hidden="true">□</span>
        <span><small>Hôm nay</small><strong>{new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" }).format(now)}</strong></span>
        <b aria-hidden="true">→</b>
      </AppLink>

    </section>
  );
}

type ProfileChanges = Partial<{
  nickname: string;
  avatarKey: string;
  color: string;
  theme: string;
  reducedMotion: boolean;
}>;

async function errorFrom(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : "Không thể lưu thay đổi. Vui lòng thử lại.";
}

function ProfileSettings({ user, save }: { user: User; save: (changes: ProfileChanges) => Promise<void> }) {
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [avatarKey, setAvatarKey] = useState(user.avatarKey ?? "initials");
  const [color, setColor] = useState(user.color);
  const [theme, setTheme] = useState(user.preferences.theme);
  const [reducedMotion, setReducedMotion] = useState(user.preferences.reducedMotion);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setNickname(user.nickname ?? "");
    setAvatarKey(user.avatarKey ?? "initials");
    setColor(user.color);
    setTheme(user.preferences.theme);
    setReducedMotion(user.preferences.reducedMotion);
  }, [user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setError("");
    try {
      await save({
        nickname,
        avatarKey,
        color,
        theme,
        reducedMotion,
      });
      setMessage("Đã lưu thông tin của ông.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể lưu thay đổi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="page-title">
      <p className="eyebrow">Cá nhân</p>
      <h1 id="page-title">Thông tin tài khoản</h1>
      <p className="settings-intro">Tên đăng nhập <strong>{user.username}</strong> · {user.role === "boyfriend" ? "Bạn trai" : "Bạn gái"}</p>
      <form onSubmit={submit} aria-busy={pending}>
        <label htmlFor="nickname">Biệt danh</label>
        <input id="nickname" name="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={80} />

        <fieldset>
          <legend>Ảnh đại diện</legend>
          <div className="avatar-options">
            {["initials", "rose", "sage", "plum"].map((avatar) => (
              <label key={avatar}>
                <input type="radio" name="avatarKey" value={avatar} checked={avatarKey === avatar} onChange={() => setAvatarKey(avatar as NonNullable<User["avatarKey"]>)} />
                <span className={`avatar-preview avatar-preview--${avatar}`} style={{ backgroundColor: avatar === "initials" ? user.color : undefined }}>
                  {avatar === "initials" ? user.displayName.slice(0, 1).toUpperCase() : ""}
                </span>
                <span className="sr-only">{avatar === "initials" ? "Chữ cái" : `Mẫu ${avatar}`}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="profile-color">Màu đại diện</label>
        <input id="profile-color" name="color" type="color" value={color} onChange={(event) => setColor(event.target.value)} />

        <label htmlFor="profile-theme">Giao diện</label>
        <select id="profile-theme" name="theme" value={theme} onChange={(event) => setTheme(event.target.value as User["preferences"]["theme"])}>
          <option value="system">Theo thiết bị</option>
          <option value="light">Sáng</option>
          <option value="dark">Tối</option>
        </select>

        <label className="setting-toggle">
          <span>Giảm chuyển động</span>
          <input name="reducedMotion" type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
        </label>
        <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
        <button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu thay đổi"}</button>
      </form>
    </section>
  );
}

function ChangePassword({ onChanged }: { onChanged: (user: User) => void }) {
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== form.get("confirmPassword")) return setError("Hai mật khẩu mới chưa khớp.");
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload: unknown = await response.clone().json().catch(() => null);
      const user = response.ok ? userFrom(payload) : null;
      if (!user) throw new Error(await errorFrom(response));
      onChanged(user);
      formElement.reset();
      setMessage("Đã đổi mật khẩu và đăng xuất các thiết bị cũ.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể đổi mật khẩu.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="page-title">
      <p className="eyebrow">Bảo mật</p>
      <h1 id="page-title">Đổi mật khẩu</h1>
      <p className="settings-intro">Sau khi đổi, các phiên đăng nhập cũ sẽ hết hiệu lực.</p>
      <form onSubmit={submit} aria-busy={pending}>
        <label htmlFor="current-password">Mật khẩu hiện tại</label>
        <input id="current-password" name="currentPassword" type={show ? "text" : "password"} autoComplete="current-password" required />
        <label htmlFor="new-password">Mật khẩu mới</label>
        <input id="new-password" name="newPassword" type={show ? "text" : "password"} autoComplete="new-password" minLength={12} required />
        <label htmlFor="confirm-password">Nhập lại mật khẩu mới</label>
        <input id="confirm-password" name="confirmPassword" type={show ? "text" : "password"} autoComplete="new-password" minLength={12} required />
        <label className="setting-toggle"><span>Hiện mật khẩu</span><input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} /></label>
        <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
        <button type="submit" disabled={pending}>{pending ? "Đang đổi…" : "Đổi mật khẩu"}</button>
      </form>
    </section>
  );
}

export function App({ user, onUserChange, onLogout }: {
  user: User;
  onUserChange: (user: User) => void;
  onLogout: () => Promise<void>;
}) {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [menuPending, setMenuPending] = useState(false);
  const [menuError, setMenuError] = useState("");

  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  useEffect(() => {
    if (user.preferences.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = user.preferences.theme;
    document.documentElement.dataset.motion = user.preferences.reducedMotion ? "reduced" : "full";
  }, [user.preferences]);

  async function saveProfile(changes: ProfileChanges) {
    const response = await fetch("/api/auth/profile", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    const payload: unknown = await response.clone().json().catch(() => null);
    const updated = response.ok ? userFrom(payload) : null;
    if (!updated) throw new Error(await errorFrom(response));
    onUserChange(updated);
  }

  async function menuAction(action: () => Promise<void>) {
    setMenuPending(true);
    setMenuError("");
    try { await action(); }
    catch (reason) { setMenuError(reason instanceof Error ? reason.message : "Không thể thực hiện."); }
    finally { setMenuPending(false); }
  }

  const route = [...bottomRoutes, ...extraRoutes].find((item) => item.path === pathname);
  const activeBottomPath = pathname.startsWith("/di-dau") ? "/di-dau" : pathname;

  useEffect(() => {
    document.title = `${route?.label ?? "Không tìm thấy trang"} · Phong & Nhi`;
  }, [route]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Đến nội dung chính</a>
      <header className="top-bar">
        <AppLink path="/" className="brand" aria-label="Về trang chủ"><img src="/favicon.png" alt="" /></AppLink>
        <details className="avatar-menu">
          <summary aria-label="Mở menu tài khoản" style={{ background: user.color }}><span aria-hidden="true">{(user.nickname ?? user.displayName).slice(0, 2).toUpperCase()}</span></summary>
          <div className="avatar-menu__panel">
            <p className="avatar-menu__name">{user.nickname ?? user.displayName}</p>
            <AppLink path="/tai-khoan">Thông tin tài khoản</AppLink>
            <AppLink path="/doi-mat-khau">Đổi mật khẩu</AppLink>
            <label><span>Chế độ tối</span><input type="checkbox" checked={user.preferences.theme === "dark"} disabled={menuPending} onChange={(event) => void menuAction(() => saveProfile({ theme: event.target.checked ? "dark" : "light" }))} /></label>
            <label><span>Giảm chuyển động</span><input type="checkbox" checked={user.preferences.reducedMotion} disabled={menuPending} onChange={(event) => void menuAction(() => saveProfile({ reducedMotion: event.target.checked }))} /></label>
            {menuError && <p className="avatar-menu__error" role="alert">{menuError}</p>}
            <button type="button" disabled={menuPending} onClick={() => void menuAction(onLogout)}>Đăng xuất</button>
          </div>
        </details>
      </header>
      <OfflineQueueNotice />

      <main id="main-content" tabIndex={-1}>
        {route?.path === "/" ? (
          <Home user={user} />
        ) : route?.path === "/tai-khoan" ? (
          <ProfileSettings user={user} save={saveProfile} />
        ) : route?.path === "/doi-mat-khau" ? (
          <ChangePassword onChanged={onUserChange} />
        ) : route?.path === "/di-dau/xe-tui-mu" ? (
          <BlindBagForm />
        ) : route?.path === "/an-gi" ? (
          <FoodSessionSetup user={user} />
        ) : route?.path === "/deep-talk" ? (
          <DeepTalkSetup user={user} />
        ) : route?.path === "/di-dau" ? (
          <section className="route-card coming-soon" aria-labelledby="page-title">
            <h1 id="page-title">Coming soon ... em bé hãy đợi anh</h1>
          </section>
        ) : route ? (
          <section className="route-card" aria-labelledby="page-title">
            <span className="route-card__icon"><Icon name={route.icon} /></span>
            <p className="eyebrow">{route.eyebrow}</p>
            <h1 id="page-title">{route.label}</h1>
            <p>{route.description}</p>
          </section>
        ) : (
          <section className="route-card" aria-labelledby="page-title">
            <p className="eyebrow">Lạc đường rồi</p>
            <h1 id="page-title">Không tìm thấy trang</h1>
            <p>Đường dẫn này không tồn tại hoặc đã được thay đổi.</p>
            <AppLink path="/" className="primary-link">Về trang chủ</AppLink>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Điều hướng chính">
        {bottomRoutes.map((item) => (
          <AppLink
            key={item.path}
            path={item.path}
            className={activeBottomPath === item.path ? "is-active" : undefined}
            aria-current={activeBottomPath === item.path ? "page" : undefined}
          >
            <span className="bottom-nav__icon"><Icon name={item.icon} /></span>
            <span>{item.label}</span>
            {activeBottomPath === item.path && <span className="sr-only">, trang hiện tại</span>}
          </AppLink>
        ))}
      </nav>
    </div>
  );
}
