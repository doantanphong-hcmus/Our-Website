import { useEffect, useRef, useState, type FormEvent } from "react";
import deepTalkSpec from "../../../content/deep-talk.v1.json";
import { queueSessionCommand, type OfflineQueueEventDetail } from "./offlineQueue";
import { ErrorState, LoadingState } from "./uiStates";
import type { User } from "./user";

type TopicState = "unset" | "allow" | "deny";
type Conditions = { level: string; duration: string; sensitiveTopics: Record<string, TopicState> };
type Session = { id: string; status: "pending" | "active" | "completed"; createdByUserId: string; version: number; conditions: Conditions;
  createdAt?: number; completedAt?: number | null };
type Consent = { stage: "partner_review" | "final_confirmation" | "ready"; revision: number; confirmedByMe: boolean; conditions: Conditions };
type Player = { id: string; name: string; color: string };
type DeckView = {
  players: Player[];
  progress: { started: boolean; startedAt: number | null; currentPosition: number; openedPositions: number[]; skippedPositions: number[]; turnMode: "alternate" | "manual" | null;
    playMode: "one" | "two"; answererUserIds: string[]; readyUserIds: string[]; skippedByUserIds: string[] };
  current: { position: number; card?: { question: string } };
  opened: Array<{ position: number; card: { question: string } }>;
};

const levels = {
  gentle: "Nhẹ nhàng", understand: "Muốn hiểu nhau hơn", deep: "Thành thật sâu sắc", mixed: "Trộn tất cả",
};
const durations = { "15": "15 phút", "30": "30 phút", "60": "60 phút", unlimited: "Không giới hạn" };
const emptyTopics = () => Object.fromEntries(deepTalkSpec.sensitiveTopics.map(({ id }) => [id, "unset"])) as Record<string, TopicState>;
const visibleTopics = deepTalkSpec.sensitiveTopics.filter(({ id }) => id !== "nguoi_yeu_cu");

function sessionFrom(payload: unknown): Session | null {
  if (!payload || typeof payload !== "object" || !("sessions" in payload) || !Array.isArray(payload.sessions)) return null;
  const deepTalk = payload.sessions.filter((item) => item && typeof item === "object" && "feature" in item && item.feature === "deep_talk") as Record<string, unknown>[];
  const session = deepTalk.find(({ status }) => ["pending", "active"].includes(String(status)))
    ?? deepTalk.find(({ status }) => status === "completed");
  if (!session || typeof session.id !== "string" || !["pending", "active", "completed"].includes(String(session.status))
    || typeof session.createdByUserId !== "string" || !Number.isInteger(session.version)
    || !session.conditions || typeof session.conditions !== "object") return null;
  return session as unknown as Session;
}

function dateTime(value?: number | null) {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(value * 1_000) : "—";
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

function Summary({ conditions }: { conditions: Conditions }) {
  return <dl className="food-summary">
    <div><dt>Mức độ</dt><dd>{levels[conditions.level as keyof typeof levels]}</dd></div>
    <div><dt>Thời lượng gợi ý</dt><dd>{durations[conditions.duration as keyof typeof durations]}</dd></div>
    {visibleTopics.map((topic) => <div key={topic.id}><dt>{topic.label}</dt><dd>{deepTalkSpec.consentStates.find(({ id }) => id === conditions.sensitiveTopics[topic.id])?.label}</dd></div>)}
  </dl>;
}

function TopicChoices({ topics, change }: { topics: Record<string, TopicState>; change: (id: string, state: TopicState) => void }) {
  return <div className="deep-talk-topics">
    {visibleTopics.map((topic) => <fieldset key={topic.id}>
      <legend>{topic.label}</legend>
      {deepTalkSpec.consentStates.map((state) => <label key={state.id}>
        <input type="radio" name={topic.id} value={state.id} checked={topics[topic.id] === state.id} onChange={() => change(topic.id, state.id as TopicState)} />
        {state.label}
      </label>)}
    </fieldset>)}
  </div>;
}

const waitingCopy = [
  "Đang xếp nhịp mở lòng cho hai đứa…",
  "Đang kiểm tra để các câu không lặp ý…",
  "Đang giữ đúng những chủ đề cả hai đã đồng ý…",
  "Sắp đủ 20 lá rồi, nội dung vẫn được giữ kín.",
];

function DeepTalkWaiting({ offerNow, switching, useFallback }: {
  offerNow: boolean; switching: boolean; useFallback: () => void;
}) {
  const [step, setStep] = useState(0);
  const [fallbackAvailable, setFallbackAvailable] = useState(offerNow);

  useEffect(() => {
    if (offerNow) setFallbackAvailable(true);
  }, [offerNow]);

  useEffect(() => {
    const copyTimer = window.setInterval(() => setStep((value) => (value + 1) % waitingCopy.length), 6_000);
    const fallbackTimer = window.setTimeout(() => setFallbackAvailable(true), 30_000);
    return () => {
      window.clearInterval(copyTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  return <section className="blind-bag-form food-setup deep-talk-waiting" aria-labelledby="page-title" aria-busy="true">
    <p className="eyebrow">Deep Talk · tạo bộ bài</p>
    <h1 id="page-title">{switching ? "Đang mở bộ an toàn có sẵn" : "Đang chuẩn bị 20 lá cho hai đứa"}</h1>
    <div className="deep-talk-card-stack" aria-hidden="true">
      <span /><span /><span><b>?</b></span>
    </div>
    <p className="deep-talk-waiting__copy" role="status" aria-live="polite">
      {switching ? "Chỉ còn một chút nữa thôi…" : waitingCopy[step]}
    </p>
    {fallbackAvailable && <div className="deep-talk-fallback">
      <strong>Không cần chờ thêm đâu.</strong>
      <p>Hai đứa có thể dùng ngay bộ 20 lá đã được kiểm tra sẵn, vẫn đúng các nguyên tắc an toàn.</p>
      <button type="button" disabled={switching} onClick={useFallback}>{switching ? "Đang chuyển…" : "Dùng bộ an toàn có sẵn"}</button>
    </div>}
  </section>;
}

export function DeepTalkSetup({ user }: { user: User }) {
  const [session, setSession] = useState<Session | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [topics, setTopics] = useState(emptyTopics);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [generation, setGeneration] = useState<"idle" | "waiting" | "fallback" | "ready">("idle");
  const [deck, setDeck] = useState<DeckView | null>(null);
  const [starter, setStarter] = useState(user.id);
  const [turnMode, setTurnMode] = useState<"alternate" | "manual">("alternate");
  const [playMode, setPlayMode] = useState<"one" | "two">("one");
  const [offerFallback, setOfferFallback] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const generationRequest = useRef(0);
  const swipeStart = useRef<number | null>(null);
  const suppressClick = useRef(false);

  async function loadDeck(target: Session) {
    const response = await fetch(`/api/sessions/${target.id}/deep-talk-deck`, { credentials: "same-origin" });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(await responseError(response, "Không tải được bộ Deep Talk."));
    const value = await response.json() as DeckView;
    setDeck(value);
    setGeneration("ready");
    return true;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/sessions", { credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response, "Không tải được phiên Deep Talk."));
      const found = sessionFrom(await response.json());
      setSession(found);
      if (!found) return setConsent(null);
      if (found.status === "completed") {
        setConsent(null);
        await loadDeck(found);
        return;
      }
      const consentResponse = await fetch(`/api/sessions/${found.id}/deep-talk-consent`, { credentials: "same-origin" });
      if (!consentResponse.ok) throw new Error(await responseError(consentResponse, "Không tải được xác nhận Deep Talk."));
      const data = await consentResponse.json() as { consent: Consent };
      setConsent(data.consent);
      setTopics(data.consent.conditions.sensitiveTopics);
      if (data.consent.stage === "ready") await loadDeck(found);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được phiên Deep Talk.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const sync = (event: Event) => {
      const status = (event as CustomEvent<OfflineQueueEventDetail>).detail.status;
      if (status === "sent" || status === "conflict") void load();
    };
    window.addEventListener("our:offline-queue", sync);
    return () => window.removeEventListener("our:offline-queue", sync);
  }, []);

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let retry = 0;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (stopped || !navigator.onLine) return;
      const url = new URL("/ws", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.addEventListener("message", ({ data }) => {
        if (data === "pong") return;
        try {
          const event = JSON.parse(String(data)) as { type?: string; session?: Session; sessions?: Session[] };
          if (!["session.snapshot", "session.updated"].includes(event.type ?? "")) return;
          const synced = event.session?.id === session.id ? event.session : event.sessions?.find(({ id }) => id === session.id);
          if (synced) setSession(synced);
          void loadDeck(synced ?? session);
        } catch { /* ignore malformed realtime messages */ }
      });
      socket.addEventListener("close", () => {
        if (!stopped) retry = window.setTimeout(connect, 1_000);
      });
    };
    const online = () => { void loadDeck(session); connect(); };
    connect();
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      window.removeEventListener("online", online);
      socket?.close();
    };
  }, [session?.id]);

  async function command(path: string, input: Record<string, unknown>, success: string) {
    setPending(true);
    setMessage("");
    setError("");
    try {
      await queueSessionCommand(path, input);
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được xác nhận Deep Talk.");
    } finally {
      setPending(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void command("/api/sessions", { feature: "deep_talk", conditions: {
      level: form.get("level"), duration: form.get("duration"), sensitiveTopics: topics,
    } }, "Đã gửi thiết lập để người kia xem lại.");
  }

  async function generateDeck(source: "ai" | "fallback") {
    if (!session) return;
    const requestId = ++generationRequest.current;
    setGeneration(source === "fallback" ? "fallback" : "waiting");
    if (source === "ai") setOfferFallback(false);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}/deep-talk-deck`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: session.version, idempotencyKey: crypto.randomUUID(), source }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Chưa tạo được bộ Deep Talk."));
      const payload = await response.json() as { session?: Session };
      if (requestId !== generationRequest.current) return;
      const current = payload.session ?? session;
      setSession(current);
      await loadDeck(current);
    } catch (reason) {
      if (requestId !== generationRequest.current) return;
      setError(reason instanceof Error ? reason.message : "Chưa tạo được bộ Deep Talk.");
      setOfferFallback(true);
      setGeneration("waiting");
    }
  }

  async function play(action: string, extra: Record<string, unknown> = {}) {
    if (!session) return;
    setPending(true);
    setError("");
    setMessage("");
    const path = `/api/sessions/${session.id}/deep-talk-play`;
    const command = { action, expectedVersion: session.version, idempotencyKey: crypto.randomUUID(), ...extra };
    try {
      const response = await fetch(path, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok) {
        if (response.status === 409) await loadDeck(session);
        throw new Error(await responseError(response, "Không cập nhật được lượt Deep Talk."));
      }
      const payload = await response.json() as DeckView & { session: Session };
      setSession(payload.session);
      setDeck(payload);
      if (action === "reveal" && !user.preferences.reducedMotion) navigator.vibrate?.(18);
    } catch (reason) {
      if (!navigator.onLine || reason instanceof TypeError) {
        await queueSessionCommand(path, command);
        setMessage("Đã giữ thao tác. Sẽ đồng bộ khi có mạng trở lại.");
      } else setError(reason instanceof Error ? reason.message : "Không cập nhật được lượt Deep Talk.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <LoadingState label="Đang tải thiết lập Deep Talk…" />;
  if (error && !session) return <ErrorState title="Chưa mở được Deep Talk" retry={() => void load()}>{error}</ErrorState>;

  if (session && consent?.stage === "ready" && (generation === "waiting" || generation === "fallback")) {
    return <>
      <DeepTalkWaiting offerNow={offerFallback} switching={generation === "fallback"} useFallback={() => void generateDeck("fallback")} />
      {error && <div className="settings-feedback deep-talk-generation-error" role="alert">{error}</div>}
    </>;
  }

  if (session && (session.status === "completed" || consent?.stage === "ready") && generation === "ready" && deck) {
    if (session.status === "completed") return <section className="blind-bag-form food-setup deep-talk-ready" aria-labelledby="page-title">
      <p className="eyebrow">Deep Talk · đã khép lại</p>
      <div className="deep-talk-ready__mark" aria-hidden="true">♡</div>
      <h1 id="page-title">Cảm ơn hai đứa đã lắng nghe nhau</h1>
      <p>Phiên đã kết thúc. Hai đứa không cần phải chơi hết 20 lá.</p>
      <dl className="deep-talk-summary">
        <div><dt>Đã chơi</dt><dd>{deck.progress.openedPositions.length} lá</dd></div>
        <div><dt>Đã bỏ qua</dt><dd>{deck.progress.skippedPositions.length} lá</dd></div>
        <div><dt>Bắt đầu</dt><dd>{dateTime(deck.progress.startedAt ?? session.createdAt)}</dd></div>
        <div><dt>Kết thúc</dt><dd>{dateTime(session.completedAt)}</dd></div>
      </dl>
      {deck.opened.length > 0 && <details className="deep-talk-review">
        <summary>Xem lại câu hỏi đã mở</summary>
        <ol>{deck.opened.map(({ position, card }) => <li key={position}>{card.question}</li>)}</ol>
      </details>}
    </section>;

    if (!deck.progress.started) return <section className="blind-bag-form food-setup deep-talk-ready" aria-labelledby="page-title">
      <p className="eyebrow">Deep Talk · sẵn sàng</p>
      <div className="deep-talk-ready__mark" aria-hidden="true">20</div>
      <h1 id="page-title">Ai sẽ bắt đầu?</h1>
      <p>Chọn người trả lời lá đầu tiên và cách đổi lượt. Nội dung từng lá vẫn được giữ kín.</p>
      <form className="deep-talk-start" onSubmit={(event) => { event.preventDefault(); void play("start", { starterUserId: starter, turnMode, playMode }); }}>
        <fieldset><legend>Người bắt đầu</legend>{deck.players.map((player) => <label key={player.id}>
          <input type="radio" name="starter" value={player.id} checked={starter === player.id} onChange={() => setStarter(player.id)} />
          <span style={{ background: player.color }} aria-hidden="true">{player.name.slice(0, 1)}</span>{player.name}
        </label>)}</fieldset>
        <label>Cách đổi lượt<select value={turnMode} onChange={(event) => setTurnMode(event.target.value as "alternate" | "manual")}>
          <option value="alternate">Tự đổi sau mỗi câu</option><option value="manual">Tự chọn người trả lời</option>
        </select></label>
        <label>Thiết bị chơi<select value={playMode} onChange={(event) => setPlayMode(event.target.value as "one" | "two")}>
          <option value="one">Chơi chung một thiết bị</option><option value="two">Mỗi người một thiết bị</option>
        </select></label>
        <button type="submit" disabled={pending}>Bắt đầu chơi</button>
      </form>
      <div className="settings-feedback" role={error ? "alert" : "status"}>{error}</div>
    </section>;

    const revealed = deck.progress.openedPositions.includes(deck.current.position);
    const answerers = deck.players.filter(({ id }) => deck.progress.answererUserIds.includes(id));
    const readyByMe = deck.progress.readyUserIds.includes(user.id);
    const skippedBy = deck.players.filter(({ id }) => deck.progress.skippedByUserIds.includes(id));
    return <section className="deep-talk-play" aria-labelledby="page-title">
      <header><p className="eyebrow">Deep Talk · lá {deck.current.position + 1}/20</p>
        <h1 id="page-title">{answerers.length === 2 ? "Cả hai cùng trả lời" : `Lượt của ${answerers[0]?.name ?? "hai đứa"}`}</h1></header>
      <button type="button" className={`deep-talk-card${revealed ? " deep-talk-card--open" : ""}`} disabled={pending || revealed}
        aria-label={revealed ? `Lá ${deck.current.position + 1}: ${deck.current.card?.question ?? ""}` : `Lật lá ${deck.current.position + 1}`}
        onPointerDown={(event) => { swipeStart.current = revealed ? null : event.clientX; }}
        onPointerUp={(event) => {
          if (swipeStart.current !== null && Math.abs(event.clientX - swipeStart.current) >= 48) {
            suppressClick.current = true;
            window.setTimeout(() => { suppressClick.current = false; }, 0);
            void play("reveal");
          }
          swipeStart.current = null;
        }}
        onPointerCancel={() => { swipeStart.current = null; }}
        onClick={() => {
          if (suppressClick.current) return;
          void play("reveal");
        }}>
        <span className="deep-talk-card__inner">
          <span className="deep-talk-card__face deep-talk-card__back"><b aria-hidden="true">♡</b><span>Chạm hoặc vuốt để lật</span></span>
          {revealed && deck.current.card && <span className="deep-talk-card__face deep-talk-card__front">{deck.current.card.question}</span>}
        </span>
      </button>
      <div className="deep-talk-play__primary">
        {revealed && (deck.progress.playMode === "two"
          ? <button type="button" disabled={pending || readyByMe} onClick={() => void play("ready")}>{readyByMe ? "Đã sẵn sàng · chờ người kia" : "Tôi đã sẵn sàng"}</button>
          : <button type="button" disabled={pending} onClick={() => void play("next")}>Tiếp tục</button>)}
        <button type="button" className="secondary-button" disabled={pending || deck.progress.skippedByUserIds.includes(user.id)} onClick={() => void play("skip")}>Bỏ qua</button>
      </div>
      {deck.progress.playMode === "two" && (deck.progress.readyUserIds.length > 0 || skippedBy.length > 0) && <div className="deep-talk-sync" role="status" aria-live="polite">
        {skippedBy.length > 0 && <span>{skippedBy.map(({ name }) => name).join(" và ")} đã chọn bỏ qua.</span>}
        <span>{deck.progress.readyUserIds.length}/2 người đã sẵn sàng sang lá tiếp theo.</span>
      </div>}
      <div className="deep-talk-play__choices">
        <button type="button" disabled={pending || answerers.length === 2} onClick={() => void play("both")}>Cả hai cùng trả lời</button>
        <button type="button" disabled={pending} onClick={() => void play("switch")}>Đổi người</button>
        <button type="button" className="text-button" disabled={pending} onClick={() => {
          if (window.confirm("Kết thúc phiên Deep Talk tại đây?")) void play("end");
        }}>Kết thúc phiên</button>
      </div>
      <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
    </section>;
  }

  if (session && consent) {
    const ownsSession = session.createdByUserId === user.id;
    const partnerReview = consent.stage === "partner_review";
    const finalConfirmation = consent.stage === "final_confirmation";
    return <section className="blind-bag-form food-setup" aria-labelledby="page-title">
      <p className="eyebrow">Deep Talk · consent</p>
      <h1 id="page-title">{consent.stage === "ready" ? "Hai đứa đã thống nhất" : partnerReview && ownsSession ? "Đang chờ người kia xem lại" : partnerReview ? "Xem lại thiết lập" : "Xác nhận bản cuối"}</h1>
      <p>{consent.stage === "ready" ? "Thiết lập đã an toàn để chuyển sang bước tạo 20 lá. Nội dung các lá vẫn được giữ bí mật."
        : finalConfirmation ? "Một lựa chọn đã thay đổi. Cả hai cần xác nhận đúng bản này trước khi tạo bộ bài."
          : ownsSession ? "Người kia có thể giữ nguyên hoặc thay đổi trạng thái chủ đề nhạy cảm." : "Mức độ và thời lượng do người tạo chọn. Ông có thể điều chỉnh từng chủ đề bên dưới."}</p>
      {partnerReview && !ownsSession ? <TopicChoices topics={topics} change={(id, state) => setTopics((value) => ({ ...value, [id]: state }))} /> : <Summary conditions={consent.conditions} />}
      <div className="food-actions">
        {partnerReview && !ownsSession && <button type="button" disabled={pending} onClick={() => void command(`/api/sessions/${session.id}/deep-talk-consent`, {
          action: "review", expectedVersion: session.version, sensitiveTopics: topics,
        }, "Đã gửi lựa chọn của ông.")}>Xác nhận lựa chọn</button>}
        {finalConfirmation && <button type="button" disabled={pending || consent.confirmedByMe} onClick={() => void command(`/api/sessions/${session.id}/deep-talk-consent`, {
          action: "confirm", expectedVersion: session.version,
        }, "Đã xác nhận bản cuối.")}>{consent.confirmedByMe ? "Đã xác nhận · chờ người kia" : "Tôi xác nhận bản cuối"}</button>}
        {session.status === "pending" && ownsSession && <button type="button" className="secondary-button" disabled={pending} onClick={() => void command(`/api/sessions/${session.id}/cancel`, {
          expectedVersion: session.version,
        }, "Đã hủy thiết lập.")}>Hủy thiết lập</button>}
        {consent.stage === "ready" && <button type="button" disabled={pending} onClick={() => void generateDeck("ai")}>Tạo bộ 20 lá</button>}
      </div>
      <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
    </section>;
  }

  return <section className="blind-bag-form food-setup" aria-labelledby="page-title">
    <p className="eyebrow">Deep Talk</p>
    <h1 id="page-title">Hai đứa muốn trò chuyện đến đâu?</h1>
    <form onSubmit={create} aria-busy={pending}>
      <label>Mức độ
        <select name="level" defaultValue="understand">
          {Object.entries(levels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label>Thời lượng gợi ý
        <select name="duration" defaultValue="30">
          {Object.entries(durations).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <TopicChoices topics={topics} change={(id, state) => setTopics((value) => ({ ...value, [id]: state }))} />
      <p className="blind-bag-form__safety">Không thoải mái thì cứ chọn “Không đồng ý” — cuộc trò chuyện này luôn tôn trọng cả hai.</p>
      <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
      <button type="submit" disabled={pending}>{pending ? "Đang gửi…" : "Gửi người kia xem lại"}</button>
    </form>
  </section>;
}
