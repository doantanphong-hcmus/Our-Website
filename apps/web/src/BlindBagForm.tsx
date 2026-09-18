import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { queueSessionCommand, type OfflineQueueEventDetail } from "./offlineQueue";
import type { User } from "./user";

type Position = { latitude: number; longitude: number; accuracyMeters: number };
type Origin = ({ kind: "current" } & Position) | { kind: "address"; address: string };
type Conditions = { distance: string; customDistanceKm?: number; budget: string; origin: Origin };
type CandidateSufficiency = {
  count: number | null;
  minimum: 3;
  status: "sufficient" | "insufficient" | "unresolved";
  suggestion?: "distance" | "budget" | "either" | "both" | "catalog";
  reason?: "address_requires_coordinates";
};
type BlindBagSession = {
  id: string;
  status: "pending" | "active";
  createdByUserId: string;
  version: number;
  conditions: Conditions;
  confirmation?: { revision: number; confirmedUserIds: string[] };
  tear?: { readyUserIds: string[]; tornByUserId: string | null; progress: number; phase: "waiting" | "tearing" | "torn" };
  result?: { name: string; type: string; address: string; description: string; distanceKm: number;
    latitude: number; longitude: number; photoUrl: string | null; rating: number | null;
    reviewCount: number | null; openingHours: string | null; challenge: string | null };
  candidateSufficiency?: CandidateSufficiency;
};

const distanceLabels: Record<string, string> = { under_3: "Dưới 3 km", three_to_five: "3–5 km", five_to_ten: "5–10 km", custom: "Tùy chỉnh" };
const budgetLabels: Record<string, string> = { free_low: "Miễn phí hoặc rất thấp", under_200k: "Dưới 200.000 đồng", two_to_five_hundred_k: "200.000–500.000 đồng", any: "Không quan trọng" };
const placeTypeLabels: Record<string, string> = { attraction: "Điểm tham quan", museum: "Bảo tàng", park: "Công viên", art_space: "Không gian nghệ thuật",
  live_performance: "Biểu diễn", market: "Khu chợ", theme_park: "Khu vui chơi", creative_workshop: "Workshop sáng tạo",
  interactive_experience: "Trải nghiệm tương tác", scenic_spot: "Điểm ngắm cảnh", concept_cafe: "Quán cà phê", unique_food: "Ăn uống độc đáo" };

function ResultCard({ result }: { result: NonNullable<BlindBagSession["result"]> }) {
  const maps = new URL("https://www.google.com/maps/search/");
  maps.searchParams.set("api", "1");
  maps.searchParams.set("query", `${result.latitude},${result.longitude}`);
  return <article className="blind-bag-result">
    {result.photoUrl && <img src={result.photoUrl} alt={result.name} loading="lazy" />}
    <p className="eyebrow">Điểm đến của hai đứa</p>
    <h2>{result.name}</h2>
    <p className="blind-bag-result__type">{placeTypeLabels[result.type] ?? "Điểm đến"}</p>
    <p>{result.description}</p>
    <dl>
      <div><dt>Địa chỉ</dt><dd>{result.address}</dd></div>
      <div><dt>Cách điểm xuất phát</dt><dd>{result.distanceKm.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km đường chim bay</dd></div>
      {result.openingHours && <div><dt>Giờ mở cửa</dt><dd>{result.openingHours}</dd></div>}
      {result.rating !== null && <div><dt>Đánh giá</dt><dd>{result.rating}/5{result.reviewCount !== null ? ` · ${result.reviewCount} lượt` : ""}</dd></div>}
    </dl>
    {result.challenge && <section className="blind-bag-result__challenge"><h3>Thử thách nhỏ</h3><p>{result.challenge}</p></section>}
    <a className="button blind-bag-result__maps" href={maps.href} target="_blank" rel="noopener noreferrer">Mở Google Maps</a>
  </article>;
}

function activeBlindBag(payload: unknown): BlindBagSession | null {
  if (!payload || typeof payload !== "object" || !("sessions" in payload) || !Array.isArray(payload.sessions)) return null;
  return payload.sessions.find((item): item is BlindBagSession => Boolean(item && typeof item === "object"
    && (item as { feature?: unknown }).feature === "blind_bag"
    && ["pending", "active"].includes(String((item as { status?: unknown }).status)))) ?? null;
}

function Summary({ conditions }: { conditions: Conditions }) {
  const distance = conditions.distance === "custom" ? `Tối đa ${conditions.customDistanceKm} km` : distanceLabels[conditions.distance];
  const origin = conditions.origin.kind === "address" ? conditions.origin.address : "Vị trí hiện tại đã chọn";
  return <dl className="blind-bag-summary">
    <div><dt>Điểm xuất phát</dt><dd>{origin}</dd></div>
    <div><dt>Khoảng cách</dt><dd>{distance}</dd></div>
    <div><dt>Ngân sách</dt><dd>{budgetLabels[conditions.budget]}</dd></div>
  </dl>;
}

function Sufficiency({ value }: { value: CandidateSufficiency }) {
  if (value.status === "sufficient") {
    return <p className="blind-bag-sufficiency blind-bag-sufficiency--ready">Có {value.count} địa điểm phù hợp — đủ để mở túi.</p>;
  }
  if (value.status === "unresolved") {
    return <p className="blind-bag-sufficiency">Chưa thể đếm chính xác từ địa chỉ nhập tay. Hãy dùng vị trí hiện tại để kiểm tra trước khi chốt.</p>;
  }
  const suggestions = {
    distance: "nới khoảng cách",
    budget: "nới ngân sách",
    either: "nới khoảng cách hoặc ngân sách",
    both: "nới cả khoảng cách lẫn ngân sách",
    catalog: "thử một điểm xuất phát khác",
  } as const;
  return <p className="blind-bag-sufficiency">Mới có {value.count}/{value.minimum} địa điểm phù hợp. Hãy {suggestions[value.suggestion ?? "catalog"]} rồi gửi lại nhé.</p>;
}

export function BlindBagForm({ user }: { user: User }) {
  const [session, setSession] = useState<BlindBagSession | null | undefined>();
  const [editing, setEditing] = useState(false);
  const [distance, setDistance] = useState("under_3");
  const [budget, setBudget] = useState("any");
  const [originMode, setOriginMode] = useState<"current" | "address">("current");
  const [address, setAddress] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stageDismissed, setStageDismissed] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const stage = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; height: number } | null>(null);

  const readyCount = session?.tear?.readyUserIds.length ?? 0;
  const showStage = session?.status === "active" && session.conditions.origin.kind === "current" && readyCount === 2 && !stageDismissed;

  useEffect(() => { setStageDismissed(false); }, [session?.id]);

  useEffect(() => {
    const dialog = stage.current;
    if (showStage && dialog && !dialog.open) dialog.showModal();
    if (!showStage && dialog?.open) dialog.close();
  }, [showStage]);

  async function loadSession() {
    try {
      const response = await fetch("/api/sessions", { credentials: "same-origin" });
      if (!response.ok) throw new Error();
      setSession(activeBlindBag(await response.json()));
    } catch {
      setError("Không tải được phiên Xé Túi Mù.");
      setSession(null);
    }
  }

  useEffect(() => {
    void loadSession();
    const synced = (event: Event) => {
      const { status } = (event as CustomEvent<OfflineQueueEventDetail>).detail;
      if (status === "sent" || status === "conflict") {
        setPending(false);
        void loadSession();
      }
    };
    window.addEventListener("our:offline-queue", synced);
    return () => window.removeEventListener("our:offline-queue", synced);
  }, []);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (stopped || !navigator.onLine || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      const url = new URL("/ws", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.addEventListener("message", ({ data }) => {
        try {
          const event = JSON.parse(String(data)) as { type?: string; session?: BlindBagSession & { feature?: string }; sessions?: unknown[] };
          if (event.type === "session.snapshot") setSession(activeBlindBag(event));
          if (event.type === "session.updated" && event.session?.feature === "blind_bag") {
            setSession(["pending", "active"].includes(event.session.status) ? event.session : null);
          }
        } catch { /* ignore malformed realtime messages */ }
      });
      socket.addEventListener("close", () => { if (!stopped) retry = window.setTimeout(connect, 1_000); });
    };
    const online = () => { void loadSession(); connect(); };
    connect();
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      window.removeEventListener("online", online);
      socket?.close();
    };
  }, []);

  function edit() {
    if (!session) return;
    setDistance(session.conditions.distance);
    setBudget(session.conditions.budget);
    setOriginMode(session.conditions.origin.kind);
    if (session.conditions.origin.kind === "address") setAddress(session.conditions.origin.address);
    else setPosition(session.conditions.origin);
    setEditing(true);
    setMessage("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customDistanceKm = distance === "custom" ? Number(form.get("customDistanceKm")) : undefined;
    const origin = originMode === "current"
      ? position && { kind: "current", ...position }
      : address.trim() && { kind: "address", address: address.trim() };
    if (!origin) {
      setError(originMode === "current" ? "Hãy lấy vị trí hiện tại trước nhé." : "Hãy nhập địa chỉ xuất phát nhé.");
      return;
    }
    const conditions = { distance, ...(customDistanceKm === undefined ? {} : { customDistanceKm }), budget, origin };
    setPending(true);
    setMessage("");
    setError("");
    try {
      if (session) {
        await queueSessionCommand(`/api/sessions/${session.id}/blind-bag-confirmation`, {
          action: "revise", expectedVersion: session.version, conditions,
        });
        setMessage("Đã gửi bản mới để người kia xác nhận lại.");
      } else {
        await queueSessionCommand("/api/sessions", { feature: "blind_bag", conditions });
        setMessage("Đã gửi người kia xác nhận.");
      }
    } catch (reason) {
      setPending(false);
      setError(reason instanceof Error ? reason.message : "Không thể lưu điều kiện.");
    }
  }

  async function review(action: "confirm" | "decline") {
    if (!session) return;
    setPending(true);
    setMessage("");
    setError("");
    try {
      const path = action === "confirm" ? "blind-bag-confirmation" : "decline";
      await queueSessionCommand(`/api/sessions/${session.id}/${path}`, {
        ...(action === "confirm" ? { action } : {}), expectedVersion: session.version,
      });
      setMessage(action === "confirm" ? "Đã đồng ý." : "Đã từ chối phiên này.");
    } catch (reason) {
      setPending(false);
      setError(reason instanceof Error ? reason.message : "Không thể gửi xác nhận.");
    }
  }

  async function tearCommand(action: "ready" | "tear" | "tear_progress", version: number, progress?: number): Promise<BlindBagSession> {
    const response = await fetch(`/api/sessions/${session!.id}/blind-bag-tear`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, expectedVersion: version, idempotencyKey: crypto.randomUUID(), ...(progress === undefined ? {} : { progress }) }),
    });
    const data = await response.json() as { session?: BlindBagSession; error?: string };
    if (!response.ok) {
      if (data.session) setSession(data.session);
      throw new Error(data.error ?? "Không đồng bộ được túi mù.");
    }
    setSession(data.session!);
    return data.session!;
  }

  async function readyOrTear(action: "ready" | "tear") {
    if (!session) return;
    setPending(true);
    setError("");
    try {
      let current = action === "tear" && session.tear?.phase === "tearing"
        ? session : await tearCommand(action, session.version);
      if (action === "tear") {
        setDragProgress(0);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
          || document.documentElement.dataset.motion === "reduced";
        for (const progress of reducedMotion ? [100] : [25, 50, 75, 100]) {
          if (progress <= (current.tear?.progress ?? 0)) continue;
          if (!reducedMotion) await new Promise((resolve) => window.setTimeout(resolve, 550));
          current = await tearCommand("tear_progress", current.version, progress);
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đồng bộ được túi mù.");
    } finally {
      setPending(false);
    }
  }

  function dragStart(event: PointerEvent<HTMLButtonElement>) {
    if (pending || session?.tear?.phase !== "waiting") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientY > bounds.top + bounds.height * 0.35) return;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, height: bounds.height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragMove(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    setDragProgress(Math.max(0, Math.min(100, (event.clientY - drag.current.startY) / drag.current.height * 100)));
  }

  function dragEnd(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const distance = event.clientY - drag.current.startY;
    const longEnough = distance >= drag.current.height * 0.62;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (longEnough) void readyOrTear("tear");
    else setDragProgress(0);
  }

  function dragCancel() {
    drag.current = null;
    setDragProgress(0);
  }

  function dragKey(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
      event.preventDefault();
      void readyOrTear("tear");
    }
  }

  function locate() {
    setLocating(true);
    setError("");
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocating(false);
      setOriginMode("address");
      setLocationMessage("Thiết bị này không hỗ trợ định vị. Mình nhập địa chỉ nhé.");
      return;
    }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setPosition({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: Math.round(coords.accuracy) });
      setLocating(false);
      setLocationMessage("Đã lấy vị trí hiện tại.");
    }, () => {
      setLocating(false);
      setOriginMode("address");
      setLocationMessage("Không lấy được vị trí. Mình nhập địa chỉ nhé.");
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
  }

  if (session === undefined) return <section className="blind-bag-form" aria-busy="true"><p>Đang mở túi mù…</p></section>;

  const confirmedUserIds = session?.confirmation?.confirmedUserIds ?? (session ? [session.createdByUserId] : []);
  const confirmedByMe = confirmedUserIds.includes(user.id);
  if (session && !editing) return <section className="blind-bag-form" aria-labelledby="page-title">
    <p className="eyebrow">Xé Túi Mù</p>
    <h1 id="page-title">{session.status === "active" ? "Hai đứa đã chốt kèo" : confirmedByMe ? "Chờ người kia xem lại" : "Một lời mời đang chờ mình"}</h1>
    <Summary conditions={session.conditions} />
    {session.candidateSufficiency && <Sufficiency value={session.candidateSufficiency} />}
    {session.status === "pending" && <div className="blind-bag-review-actions">
      {!confirmedByMe && <button type="button" disabled={pending} onClick={() => void review("confirm")}>Đồng ý</button>}
      <button type="button" className="secondary-button" disabled={pending} onClick={edit}>{confirmedByMe ? "Chỉnh lại" : "Đề nghị sửa"}</button>
      {!confirmedByMe && <button type="button" className="text-button" disabled={pending} onClick={() => void review("decline")}>Từ chối</button>}
    </div>}
    {session.status === "active" && <div className="blind-bag-tear">
      <p>{readyCount}/2 người đã sẵn sàng.</p>
      {!session.tear?.readyUserIds.includes(user.id) && <button type="button" disabled={pending} onClick={() => void readyOrTear("ready")}>Mình sẵn sàng</button>}
      {readyCount === 2 && session.conditions.origin.kind !== "current" && <p>Cần chọn vị trí hiện tại để xác định khoảng cách trước khi xé.</p>}
      {readyCount === 2 && session.conditions.origin.kind === "current" && <button type="button" onClick={() => setStageDismissed(false)}>Xem túi mù</button>}
      <dialog ref={stage} className="blind-bag-stage" aria-label="Xé Túi Mù" onClose={() => setStageDismissed(true)}>
        <button type="button" className="blind-bag-stage__close" aria-label="Đóng màn xé túi" onClick={() => stage.current?.close()}>×</button>
        {session.tear?.phase === "torn" && session.result ? <ResultCard result={session.result} /> : <div className="blind-bag-stage__scene" style={{ "--rip-length": `${session.tear?.phase === "waiting" ? dragProgress : session.tear?.progress ?? 0}%` } as CSSProperties}>
          <p className="blind-bag-stage__eyebrow">Một chuyến đi bí mật</p>
          <div className="blind-bag-stage__bag">
            <div className="blind-bag-stage__card" style={{ transform: `translateY(${(100 - (session.tear?.progress ?? 0)) * 0.6}px)`, opacity: session.tear?.phase === "waiting" ? 0 : 1 }} aria-hidden={session.tear?.phase !== "torn"}>
              <span>✦</span><strong>Điều bất ngờ đang chờ hai đứa</strong><small>Địa điểm sẽ hiện ở bước tiếp theo</small>
            </div>
            <div className="blind-bag-stage__piece blind-bag-stage__piece--left" style={{ transform: `translateX(-${(session.tear?.progress ?? 0) * 0.75}px) rotate(-${(session.tear?.progress ?? 0) * 0.07}deg)` }} />
            <div className="blind-bag-stage__piece blind-bag-stage__piece--right" style={{ transform: `translateX(${(session.tear?.progress ?? 0) * 0.75}px) rotate(${(session.tear?.progress ?? 0) * 0.07}deg)` }} />
            <span className="blind-bag-stage__seal" style={{ opacity: session.tear?.phase === "waiting" ? 1 : 0 }} aria-hidden="true">?</span>
            <span className="blind-bag-stage__rip" style={{ opacity: session.tear?.phase === "torn" ? 0 : 1 }} aria-hidden="true" />
            {session.tear?.phase === "waiting" && <button type="button" className="blind-bag-stage__gesture" disabled={pending || session.conditions.origin.kind !== "current"}
              aria-describedby="blind-bag-gesture-hint" aria-label="Vuốt từ trên xuống để xé túi mù"
              onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragCancel} onKeyDown={dragKey} />}
          </div>
          <div className="blind-bag-stage__footer" role="status" aria-live="polite">
            {session.tear?.phase === "waiting" ? <p id="blind-bag-gesture-hint">Vuốt từ mép trên xuống hết đường niêm phong để mở túi.</p>
              : session.tear?.phase === "tearing" ? <><p>{session.tear.tornByUserId === user.id ? "Mình đang xé túi…" : "Người kia đang xé túi…"}</p>
                <progress max="100" value={session.tear.progress} aria-label="Tiến độ xé túi" />
                {session.tear.tornByUserId === user.id && !pending && <button type="button" onClick={() => void readyOrTear("tear")}>Tiếp tục xé</button>}</>
                : <p>Túi đã mở! Hai đứa cùng chờ xem điều bất ngờ nhé.</p>}
          </div>
        </div>}
      </dialog>
    </div>}
    <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
  </section>;

  return <section className="blind-bag-form" aria-labelledby="page-title">
    <p className="eyebrow">Xé Túi Mù</p>
    <h1 id="page-title">Hai đứa muốn đi xa và chi bao nhiêu?</h1>
    <p>Còn lại cứ để túi mù lo.</p>
    <form onSubmit={submit} aria-busy={pending}>
      <fieldset className="blind-bag-origin">
        <legend>Điểm xuất phát</legend>
        <div className="blind-bag-origin__choices">
          <label><input type="radio" name="originMode" checked={originMode === "current"} onChange={() => { setOriginMode("current"); setError(""); setLocationMessage(""); }} />Vị trí hiện tại</label>
          <label><input type="radio" name="originMode" checked={originMode === "address"} onChange={() => { setOriginMode("address"); setError(""); setLocationMessage(""); }} />Nhập địa chỉ</label>
        </div>
        {originMode === "current" ? <button type="button" className="secondary-button" disabled={locating} onClick={locate}>{locating ? "Đang lấy vị trí…" : position ? "Lấy lại vị trí" : "Dùng vị trí hiện tại"}</button> : <label>Địa chỉ xuất phát
          <input name="originAddress" autoComplete="street-address" minLength={5} maxLength={200} required value={address} onChange={(event) => setAddress(event.target.value)} />
        </label>}
        <p className="blind-bag-origin__feedback" role="status" aria-live="polite">{locationMessage}</p>
      </fieldset>
      <label>Khoảng cách
        <select name="distance" value={distance} onChange={(event) => setDistance(event.target.value)}>
          <option value="under_3">Dưới 3 km</option><option value="three_to_five">3–5 km</option>
          <option value="five_to_ten">5–10 km</option><option value="custom">Tùy chỉnh</option>
        </select>
      </label>
      {distance === "custom" && <label>Khoảng cách tối đa (km)
        <input name="customDistanceKm" type="number" inputMode="decimal" min="1" max="100" step="0.5" required defaultValue={session?.conditions.customDistanceKm} />
      </label>}
      <label>Ngân sách cho hai người
        <select name="budget" value={budget} onChange={(event) => setBudget(event.target.value)}>
          <option value="free_low">Miễn phí hoặc rất thấp</option><option value="under_200k">Dưới 200.000 đồng</option>
          <option value="two_to_five_hundred_k">200.000–500.000 đồng</option><option value="any">Không quan trọng</option>
        </select>
      </label>
      <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
      <button type="submit" disabled={pending}>{pending ? "Đang gửi…" : session ? "Gửi lại để xác nhận" : "Gửi người kia xác nhận"}</button>
      {session && <button type="button" className="text-button" onClick={() => setEditing(false)}>Quay lại</button>}
    </form>
  </section>;
}
