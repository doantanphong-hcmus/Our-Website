import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

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

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
  }, [reducedMotion]);

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
          <summary aria-label="Mở menu tài khoản"><span aria-hidden="true">PN</span></summary>
          <div className="avatar-menu__panel">
            <p className="avatar-menu__name">Phong & Nhi</p>
            <AppLink path="/tai-khoan">Thông tin tài khoản</AppLink>
            <AppLink path="/doi-mat-khau">Đổi mật khẩu</AppLink>
            <label><span>Chế độ tối</span><input type="checkbox" checked={dark} onChange={(event) => setDark(event.target.checked)} /></label>
            <label><span>Giảm chuyển động</span><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /></label>
            <button type="button" disabled title="Được kết nối khi hoàn thành xác thực ở P1.6">Đăng xuất</button>
          </div>
        </details>
      </header>

      <main id="main-content" tabIndex={-1}>
        {route ? (
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
