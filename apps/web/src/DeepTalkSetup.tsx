import { useEffect, useState, type FormEvent } from "react";
import deepTalkSpec from "../../../content/deep-talk.v1.json";
import { queueSessionCommand, type OfflineQueueEventDetail } from "./offlineQueue";
import { ErrorState, LoadingState } from "./uiStates";
import type { User } from "./user";

type TopicState = "unset" | "allow" | "deny";
type Conditions = { level: string; duration: string; sensitiveTopics: Record<string, TopicState> };
type Session = { id: string; status: "pending" | "active"; createdByUserId: string; version: number; conditions: Conditions };
type Consent = { stage: "partner_review" | "final_confirmation" | "ready"; revision: number; confirmedByMe: boolean; conditions: Conditions };

const levels = {
  gentle: "Nhẹ nhàng", understand: "Muốn hiểu nhau hơn", deep: "Thành thật sâu sắc", mixed: "Trộn tất cả",
};
const durations = { "15": "15 phút", "30": "30 phút", "60": "60 phút", unlimited: "Không giới hạn" };
const emptyTopics = () => Object.fromEntries(deepTalkSpec.sensitiveTopics.map(({ id }) => [id, "unset"])) as Record<string, TopicState>;

function sessionFrom(payload: unknown): Session | null {
  if (!payload || typeof payload !== "object" || !("sessions" in payload) || !Array.isArray(payload.sessions)) return null;
  const session = payload.sessions.find((item) => item && typeof item === "object" && "feature" in item && item.feature === "deep_talk") as Record<string, unknown> | undefined;
  if (!session || typeof session.id !== "string" || !["pending", "active"].includes(String(session.status))
    || typeof session.createdByUserId !== "string" || !Number.isInteger(session.version)
    || !session.conditions || typeof session.conditions !== "object") return null;
  return session as unknown as Session;
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

function Summary({ conditions }: { conditions: Conditions }) {
  return <dl className="food-summary">
    <div><dt>Mức độ</dt><dd>{levels[conditions.level as keyof typeof levels]}</dd></div>
    <div><dt>Thời lượng gợi ý</dt><dd>{durations[conditions.duration as keyof typeof durations]}</dd></div>
    {deepTalkSpec.sensitiveTopics.map((topic) => <div key={topic.id}><dt>{topic.label}</dt><dd>{deepTalkSpec.consentStates.find(({ id }) => id === conditions.sensitiveTopics[topic.id])?.label}</dd></div>)}
  </dl>;
}

function TopicChoices({ topics, change }: { topics: Record<string, TopicState>; change: (id: string, state: TopicState) => void }) {
  return <div className="deep-talk-topics">
    {deepTalkSpec.sensitiveTopics.map((topic) => <fieldset key={topic.id}>
      <legend>{topic.label}</legend>
      {deepTalkSpec.consentStates.map((state) => <label key={state.id}>
        <input type="radio" name={topic.id} value={state.id} checked={topics[topic.id] === state.id} onChange={() => change(topic.id, state.id as TopicState)} />
        {state.label}
      </label>)}
    </fieldset>)}
  </div>;
}

export function DeepTalkSetup({ user }: { user: User }) {
  const [session, setSession] = useState<Session | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [topics, setTopics] = useState(emptyTopics);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/sessions", { credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response, "Không tải được phiên Deep Talk."));
      const found = sessionFrom(await response.json());
      setSession(found);
      if (!found) return setConsent(null);
      const consentResponse = await fetch(`/api/sessions/${found.id}/deep-talk-consent`, { credentials: "same-origin" });
      if (!consentResponse.ok) throw new Error(await responseError(consentResponse, "Không tải được xác nhận Deep Talk."));
      const data = await consentResponse.json() as { consent: Consent };
      setConsent(data.consent);
      setTopics(data.consent.conditions.sensitiveTopics);
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

  if (loading) return <LoadingState label="Đang tải thiết lập Deep Talk…" />;
  if (error && !session) return <ErrorState title="Chưa mở được Deep Talk" retry={() => void load()}>{error}</ErrorState>;

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
      </div>
      <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
    </section>;
  }

  return <section className="blind-bag-form food-setup" aria-labelledby="page-title">
    <p className="eyebrow">Deep Talk</p>
    <h1 id="page-title">Hai đứa muốn trò chuyện đến đâu?</h1>
    <p>Bộ luôn có đúng 20 lá. Thời lượng chỉ gợi ý số lá nên chơi, còn chủ đề nhạy cảm chỉ xuất hiện khi cả hai cùng đồng ý.</p>
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
      <p className="blind-bag-form__safety">“Không đồng ý” luôn loại tuyệt đối chủ đề đó. Câu trả lời của hai đứa không được thu thập hay gửi cho AI.</p>
      <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
      <button type="submit" disabled={pending}>{pending ? "Đang gửi…" : "Gửi người kia xem lại"}</button>
    </form>
  </section>;
}
