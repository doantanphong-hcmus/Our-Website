import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="ui-state ui-state--loading" role="status" aria-label={label}>
      <span className="ui-skeleton ui-skeleton--picture" aria-hidden="true" />
      <span className="ui-skeleton" aria-hidden="true" />
      <span className="ui-skeleton ui-skeleton--short" aria-hidden="true" />
      <h3>{label}</h3>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="ui-state ui-state--empty">
      <div className="ui-state__illustration"><img src="/couple-empty-state.jpg" alt="Phong và Nhi" /></div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

function defaultBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.assign("/");
}

export function ErrorState({ title, children, retry, back = defaultBack }: {
  title: string;
  children: ReactNode;
  retry: () => void;
  back?: () => void;
}) {
  return (
    <div className="ui-state ui-state--error" role="alert">
      <div className="ui-state__error-mark" aria-hidden="true">!</div>
      <h3>{title}</h3>
      <p>{children}</p>
      <div className="ui-state__actions">
        <button type="button" onClick={retry}>Thử lại</button>
        <button type="button" onClick={back}>Quay lại</button>
      </div>
    </div>
  );
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const online = () => setOffline(false);
    const disconnected = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  return offline ? <div className="offline-banner" role="status">Đang ngoại tuyến · Thao tác hỗ trợ offline sẽ được gửi khi có mạng.</div> : null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error boundary", error, info.componentStack);
  }

  render() {
    if (this.state.failed) return (
      <main className="fatal-error">
        <ErrorState title="Trang này vừa gặp sự cố" retry={() => this.setState({ failed: false })}>
          Hãy thử mở lại khu vực này. Các thao tác đã đồng bộ vẫn an toàn.
        </ErrorState>
      </main>
    );
    return this.props.children;
  }
}
