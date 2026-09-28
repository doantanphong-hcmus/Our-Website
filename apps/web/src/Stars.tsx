import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { User } from "./user";

type Activity = { id: string; label: string; condition: string; points?: number; minimumPoints?: number; maximumPoints?: number };
type Reward = { id: string; label: string; cost: number };
type StarTransaction = { id: string; kind: string; delta: number; balanceAfter: number; label: string; note: string | null; createdAt: number };
type Wallet = { balance: number; updatedAt: number; activities: Activity[]; rewards: Reward[]; transactions: StarTransaction[] };

async function payloadFrom(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string; wallet?: Wallet; celebrations?: StarTransaction[] } | null;
  if (!response.ok) throw new Error(payload?.error ?? "Không thể xử lý lúc này.");
  return payload;
}

export function Stars({ user }: { user: User }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [open, setOpen] = useState(false);
  const [celebrations, setCelebrations] = useState<StarTransaction[]>([]);
  const [activityId, setActivityId] = useState("listening");
  const [points, setPoints] = useState(10);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const retry = useRef({ fingerprint: "", key: "" });
  const redeemRetry = useRef({ rewardId: "", key: "" });

  async function loadWallet() {
    const response = await fetch("/api/stars", { credentials: "same-origin" });
    const payload = await payloadFrom(response);
    if (payload?.wallet) setWallet(payload.wallet);
  }

  async function claimCelebration() {
    if (user.role !== "girlfriend") return;
    const response = await fetch("/api/stars/celebrations/claim", { method: "POST", credentials: "same-origin" });
    const payload = await payloadFrom(response);
    if (payload?.celebrations?.length) setCelebrations(payload.celebrations);
  }

  useEffect(() => {
    void loadWallet().catch(() => setError("Chưa tải được ví sao."));
    const timer = window.setTimeout(() => void claimCelebration().catch(() => {}), 150);
    let stopped = false;
    let reconnect = 0;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (stopped || !navigator.onLine) return;
      const url = new URL("/ws", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.addEventListener("message", ({ data }) => {
        try {
          const event = JSON.parse(String(data)) as { type?: string };
          if (event.type !== "star.updated") return;
          void loadWallet();
          void claimCelebration();
        } catch { /* ignore malformed realtime messages */ }
      });
      socket.addEventListener("close", () => { if (!stopped) reconnect = window.setTimeout(connect, 1_000); });
    };
    connect();
    return () => { stopped = true; window.clearTimeout(timer); window.clearTimeout(reconnect); socket?.close(); };
  }, []);

  const selected = wallet?.activities.find(({ id }) => id === activityId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const input = { activityId, ...(activityId === "special" ? { points } : {}), note: note.trim() || undefined };
    const fingerprint = JSON.stringify(input);
    if (retry.current.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
    setPending(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/stars/award", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, idempotencyKey: retry.current.key }) });
      const payload = await payloadFrom(response);
      if (payload?.wallet) setWallet(payload.wallet);
      retry.current = { fingerprint: "", key: "" };
      setNote("");
      setMessage(`Đã tặng ${activityId === "special" ? points : selected.points} ⭐ cho Nhi.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tặng sao."); }
    finally { setPending(false); }
  }

  async function redeem(reward: Reward) {
    if (redeemRetry.current.rewardId !== reward.id) redeemRetry.current = { rewardId: reward.id, key: crypto.randomUUID() };
    setPending(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/stars/redeem", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId: reward.id, idempotencyKey: redeemRetry.current.key }) });
      const payload = await payloadFrom(response);
      if (payload?.wallet) setWallet(payload.wallet);
      redeemRetry.current = { rewardId: "", key: "" };
      setMessage(`Đã ghi nhận đổi “${reward.label}”.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể đổi thưởng."); }
    finally { setPending(false); }
  }

  return <>
    <button className="star-wallet-button" type="button" onClick={() => setOpen(true)}
      aria-label={user.role === "boyfriend" ? "Mở phần tặng sao" : `Ví có ${wallet?.balance ?? 0} sao`}>
      <span aria-hidden="true">⭐</span>{user.role === "girlfriend" ? wallet?.balance ?? "…" : "Tặng sao"}
    </button>

    {open && createPortal(<div className="star-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="star-panel" role="dialog" aria-modal="true" aria-labelledby="star-title">
        <button className="star-panel__close" type="button" aria-label="Đóng" onClick={() => setOpen(false)}>×</button>
        <p className="eyebrow">Góc học tiếng Anh</p>
        <h2 id="star-title">{user.role === "boyfriend" ? "Tặng sao cho Nhi" : "Ví sao của Nhi"}</h2>
        <p className="star-balance"><span>{wallet?.balance ?? "…"}</span> ⭐</p>
        <a className="claw-entry" href="/gap-thu" onClick={() => setOpen(false)}><span aria-hidden="true">🕹️</span><span><strong>Máy gắp thú</strong><small>20 sao đổi 5 lượt chơi</small></span><b aria-hidden="true">→</b></a>
        {user.role === "boyfriend" ? <form className="star-award-form" onSubmit={submit}>
          <label>Hoạt động<select value={activityId} onChange={(event) => { setActivityId(event.target.value); setMessage(""); setError(""); }}>
            {wallet?.activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.label}</option>)}
          </select></label>
          {activityId === "special" ? <label>Số sao<input type="number" min="1" max="100" required value={points} onChange={(event) => setPoints(Number(event.target.value))} /></label>
            : <p className="star-rule"><strong>+{selected?.points ?? 0} ⭐</strong> · {selected?.condition}</p>}
          <label>Lời nhắn {activityId !== "special" && <small>(không bắt buộc)</small>}<textarea maxLength={500} required={activityId === "special"} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          {message && <p className="star-feedback" role="status">{message}</p>}
          {error && <p className="star-feedback star-feedback--error" role="alert">{error}</p>}
          <button type="submit" disabled={pending || !wallet}>{pending ? "Đang tặng…" : "Tặng sao"}</button>
        </form> : null}
        <div className="star-rewards">
          <h3>Bảng đổi thưởng</h3>
          <ul>{wallet?.rewards.map((reward) => {
            const shortfall = Math.max(0, reward.cost - wallet.balance);
            return <li key={reward.id}>
              <span><strong>{reward.cost} ⭐</strong>{reward.label}</span>
              {user.role === "boyfriend" && <button type="button" disabled={pending || shortfall > 0} onClick={() => void redeem(reward)}>
                {shortfall ? `Thiếu ${shortfall} ⭐` : "Ghi nhận đổi"}
              </button>}
            </li>;
          })}</ul>
        </div>
        {user.role === "girlfriend" ? <div className="star-history">
          <h3>Lịch sử gần đây</h3>
          {wallet?.transactions.length ? <ul>{wallet.transactions.map((item) => <li key={item.id}>
            <span><strong>{item.label}</strong>{item.note && <small>{item.note}</small>}</span><b>{item.delta > 0 ? "+" : ""}{item.delta} ⭐</b>
          </li>)}</ul> : <p>Chưa có sao nào. Mình bắt đầu từ hôm nay nhé!</p>}
          {error && <p className="star-feedback star-feedback--error" role="alert">{error}</p>}
        </div> : null}
      </section>
    </div>, document.body)}

    {!!celebrations.length && createPortal(<div className="star-celebration" role="dialog" aria-modal="true" aria-labelledby="celebration-title">
      <div className="star-celebration__sparkles" aria-hidden="true">⭐ ✦ ⭐ ✧ ⭐</div>
      <section>
        <button className="star-panel__close" type="button" aria-label="Đóng" onClick={() => setCelebrations([])}>×</button>
        <span className="star-celebration__star" aria-hidden="true">⭐</span>
        <p className="eyebrow">Tuyệt vời quá em bé ơi!</p>
        <h2 id="celebration-title">Em vừa nhận được {celebrations.reduce((sum, item) => sum + item.delta, 0)} sao</h2>
        {celebrations.map((item) => <p key={item.id}><strong>{item.label}</strong>{item.note ? ` · ${item.note}` : ""}</p>)}
        <button type="button" onClick={() => setCelebrations([])}>Nhận sao</button>
      </section>
    </div>, document.body)}
  </>;
}
