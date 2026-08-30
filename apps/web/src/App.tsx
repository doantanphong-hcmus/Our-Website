import { useEffect, useState, type AnchorHTMLAttributes, type FormEvent, type MouseEvent } from "react";
import { userFrom, type User } from "./user";

type Route = {
  path: string;
  label: string;
  eyebrow: string;
  description: string;
  icon: string;
};

const bottomRoutes: Route[] = [
  { path: "/", label: "Trang chủ", eyebrow: "Chào hai đứa", description: "Một góc nhỏ để bắt đầu điều gì đó cùng nhau.", icon: "⌂" },
  { path: "/di-dau", label: "Đi đâu", eyebrow: "Cùng ra ngoài", description: "Chọn ngẫu nhiên hoặc xem lại những nơi mình đã lưu.", icon: "⌖" },
  { path: "/an-gi", label: "Ăn gì", eyebrow: "Một món cho hôm nay", description: "Để việc chọn món nhẹ nhàng hơn một chút.", icon: "♨" },
  { path: "/deep-talk", label: "Deep Talk", eyebrow: "Chuyện của hai đứa", description: "Một khoảng yên để nghe và hiểu nhau hơn.", icon: "♡" },
  { path: "/lich", label: "Lịch", eyebrow: "Những ngày của mình", description: "Giữ các dịp quan trọng ở cùng một nơi.", icon: "□" },
];

const extraRoutes: Route[] = [
  { path: "/di-dau/xe-tui-mu", label: "Xé Túi Mù", eyebrow: "Đi đâu", description: "Mở một gợi ý bất ngờ cho buổi hẹn tiếp theo.", icon: "◇" },
  { path: "/di-dau/ban-do", label: "Bản đồ", eyebrow: "Đi đâu", description: "Nhìn lại những địa điểm của hai đứa trên bản đồ.", icon: "⌖" },
  { path: "/di-dau/ho-chieu", label: "Hộ chiếu", eyebrow: "Đi đâu", description: "Lưu dấu những nơi cả hai đã cùng ghé qua.", icon: "▧" },
  { path: "/tai-khoan", label: "Thông tin tài khoản", eyebrow: "Cá nhân", description: "Thông tin của tài khoản đang đăng nhập.", icon: "○" },
  { path: "/doi-mat-khau", label: "Đổi mật khẩu", eyebrow: "Bảo mật", description: "Cập nhật mật khẩu cho tài khoản.", icon: "◇" },
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
        <AppLink path="/" className="brand" aria-label="Về trang chủ">P<span aria-hidden="true">&</span>N</AppLink>
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

      <main id="main-content" tabIndex={-1}>
        {route?.path === "/tai-khoan" ? (
          <ProfileSettings user={user} save={saveProfile} />
        ) : route?.path === "/doi-mat-khau" ? (
          <ChangePassword onChanged={onUserChange} />
        ) : route ? (
          <section className="route-card" aria-labelledby="page-title">
            <span className="route-card__icon" aria-hidden="true">{route.icon}</span>
            <p className="eyebrow">{route.eyebrow}</p>
            <h1 id="page-title">{route.label}</h1>
            <p>{route.description}</p>
            {route.path === "/di-dau" && (
              <nav className="place-links" aria-label="Các mục Đi đâu">
                <AppLink path="/di-dau/xe-tui-mu">Xé Túi Mù</AppLink>
                <AppLink path="/di-dau/ban-do">Bản đồ</AppLink>
                <AppLink path="/di-dau/ho-chieu">Hộ chiếu</AppLink>
              </nav>
            )}
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
            <span className="bottom-nav__icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
            {activeBottomPath === item.path && <span className="sr-only">, trang hiện tại</span>}
          </AppLink>
        ))}
      </nav>
    </div>
  );
}
