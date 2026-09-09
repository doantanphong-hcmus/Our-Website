import { useEffect, useState, type FormEvent } from "react";
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
  candidateSufficiency?: CandidateSufficiency;
};

const distanceLabels: Record<string, string> = { under_3: "Dưới 3 km", three_to_five: "3–5 km", five_to_ten: "5–10 km", custom: "Tùy chỉnh" };
const budgetLabels: Record<string, string> = { free_low: "Miễn phí hoặc rất thấp", under_200k: "Dưới 200.000 đồng", two_to_five_hundred_k: "200.000–500.000 đồng", any: "Không quan trọng" };

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
    {session.status === "active" && <p>Túi mù đang chuẩn bị những địa điểm phù hợp.</p>}
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
