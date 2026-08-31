import { useEffect, useMemo, useState, type FormEvent } from "react";
import foodCatalog from "../../../content/food.v1.json";
import { queueSessionCommand, type OfflineQueueEventDetail } from "./offlineQueue";
import { ErrorState, LoadingState } from "./uiStates";
import type { User } from "./user";

type FoodConditions = {
  foodStyle: "full_meal" | "snack";
  meal: "breakfast" | "lunch" | "dinner" | "late" | "any";
  category: string;
  allergens: string[];
  exclusions: string[];
};

type FoodSession = {
  id: string;
  status: "pending" | "active";
  createdByUserId: string;
  version: number;
  conditions: FoodConditions;
};

type FoodDish = {
  id: string;
  name: string;
  foodStyle: "full_meal" | "snack";
  categories: string[];
};

type FoodDecision = "want" | "no" | "skip";
type FoodVote = { dishId: string; decision: FoodDecision };
type FoodProxy = { proxy: FoodDish | null; exhausted: boolean; confirmedByMe: boolean; ready: boolean };

const mealLabels: Record<FoodConditions["meal"], string> = {
  breakfast: "Bữa sáng",
  lunch: "Bữa trưa",
  dinner: "Bữa tối",
  late: "Ăn khuya",
  any: "Bất kỳ lúc nào",
};

function foodSessionFrom(value: unknown): FoodSession | null {
  if (!value || typeof value !== "object" || !("sessions" in value) || !Array.isArray(value.sessions)) return null;
  const session = value.sessions.find((item) => item && typeof item === "object"
    && "feature" in item && item.feature === "food_vote"
    && "status" in item && ["pending", "active"].includes(String(item.status))) as Record<string, unknown> | undefined;
  if (!session || typeof session.id !== "string" || typeof session.createdByUserId !== "string"
    || !Number.isInteger(session.version) || !session.conditions || typeof session.conditions !== "object") return null;
  const conditions = session.conditions as Record<string, unknown>;
  if (!["full_meal", "snack"].includes(String(conditions.foodStyle))
    || !Object.hasOwn(mealLabels, String(conditions.meal)) || typeof conditions.category !== "string"
    || !Array.isArray(conditions.allergens) || !Array.isArray(conditions.exclusions)) return null;
  return { ...session, conditions } as FoodSession;
}

function label(items: { id: string; label: string }[], id: string) {
  return items.find((item) => item.id === id)?.label ?? id;
}

function SessionSummary({ session }: { session: FoodSession }) {
  const conditions = session.conditions;
  return (
    <dl className="food-summary">
      <div><dt>Trường phái</dt><dd>{label(foodCatalog.foodStyles, conditions.foodStyle)}</dd></div>
      <div><dt>Bữa ăn</dt><dd>{mealLabels[conditions.meal]}</dd></div>
      <div><dt>Danh mục</dt><dd>{conditions.category === "any" ? "Bất kỳ" : label(foodCatalog.categories, conditions.category)}</dd></div>
      <div><dt>Dị ứng cần tránh</dt><dd>{conditions.allergens.length ? conditions.allergens.map((id) => label(foodCatalog.allergens, id)).join(", ") : "Không có"}</dd></div>
      <div><dt>Không muốn ăn</dt><dd>{conditions.exclusions.length ? conditions.exclusions.map((id) => label(foodCatalog.exclusions, id)).join(", ") : "Không có"}</dd></div>
    </dl>
  );
}

async function responseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

function FoodVoting({ sessionId }: { sessionId: string }) {
  const [dishes, setDishes] = useState<FoodDish[]>([]);
  const [votes, setVotes] = useState<FoodVote[]>([]);
  const [match, setMatch] = useState<FoodDish | null>(null);
  const [proxy, setProxy] = useState<FoodProxy>({ proxy: null, exhausted: false, confirmedByMe: false, ready: false });
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [poolResponse, votesResponse, matchResponse, proxyResponse] = await Promise.all([
        fetch(`/api/sessions/${sessionId}/food-pool`, { credentials: "same-origin" }),
        fetch(`/api/sessions/${sessionId}/food-votes`, { credentials: "same-origin" }),
        fetch(`/api/sessions/${sessionId}/food-match`, { credentials: "same-origin" }),
        fetch(`/api/sessions/${sessionId}/food-proxy`, { credentials: "same-origin" }),
      ]);
      if (!poolResponse.ok) throw new Error(await responseError(poolResponse, "Không tải được danh sách món."));
      if (!votesResponse.ok) throw new Error(await responseError(votesResponse, "Không tải được lựa chọn đã lưu."));
      if (!matchResponse.ok) throw new Error(await responseError(matchResponse, "Không tải được kết quả chung."));
      if (!proxyResponse.ok && proxyResponse.status !== 409) throw new Error(await responseError(proxyResponse, "Không tải được phương án chốt hộ."));
      const pool = await poolResponse.json() as { dishes?: unknown };
      const saved = await votesResponse.json() as { votes?: unknown };
      const result = await matchResponse.json() as { match?: unknown };
      const fallback = proxyResponse.ok ? await proxyResponse.json() as FoodProxy : null;
      if (!Array.isArray(pool.dishes) || !Array.isArray(saved.votes)
        || !(result.match === null || (result.match && typeof result.match === "object" && "id" in result.match))) {
        throw new Error("Dữ liệu chọn món không hợp lệ.");
      }
      setDishes(pool.dishes as FoodDish[]);
      setVotes(saved.votes as FoodVote[]);
      setMatch(result.match as FoodDish | null);
      if (fallback) setProxy(fallback);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được phần chọn món.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [sessionId]);

  const votedIds = new Set(votes.map((vote) => vote.dishId));
  const dish = dishes.find((item) => !votedIds.has(item.id));

  async function vote(decision: FoodDecision) {
    if (!dish) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/food-votes`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dishId: dish.id, decision, idempotencyKey: crypto.randomUUID() }),
      });
      if (response.status === 409) return void await load();
      if (!response.ok) throw new Error(await responseError(response, "Không lưu được lựa chọn."));
      const result = await response.json() as { match?: FoodDish; proxy?: FoodDish | null; exhausted?: boolean };
      setVotes((current) => [...current.filter((item) => item.dishId !== dish.id), { dishId: dish.id, decision }]);
      if (result.match) setMatch(result.match);
      if ("proxy" in result || result.exhausted) setProxy({ proxy: result.proxy ?? null, exhausted: result.exhausted === true, confirmedByMe: false, ready: false });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được lựa chọn.");
    } finally {
      setPending(false);
    }
  }

  async function confirmProxy() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/food-proxy`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Không xác nhận được món chốt hộ."));
      setProxy(await response.json() as FoodProxy);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xác nhận được món chốt hộ.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <LoadingState label="Đang chuẩn bị món cho riêng ông…" />;
  if (error && !dishes.length) return <ErrorState title="Chưa tải được món" retry={() => void load()}>{error}</ErrorState>;
  if (!dishes.length) return <p role="status">Chưa có món phù hợp với các điều kiện đã chọn.</p>;
  if (match) return <div className="food-vote-done" role="status"><strong>Trùng ý rồi!</strong><span>Hai đứa đều muốn ăn {match.name}.</span></div>;
  if (proxy.exhausted) return <div className="food-vote-done" role="status"><strong>Chưa còn món an toàn để chốt hộ.</strong><span>Hãy chọn thêm nhóm món hoặc tạo một danh sách mới. Điều kiện dị ứng vẫn được giữ nguyên.</span></div>;
  if (proxy.proxy) return <div className="food-vote-done" role="status">
    <strong>{proxy.ready ? `Hai đứa đã cùng chốt ${proxy.proxy.name}.` : `Chốt hộ: ${proxy.proxy.name}`}</strong>
    {proxy.ready ? <span>Đã có xác nhận từ cả hai.</span> : proxy.confirmedByMe
      ? <span>Đã ghi nhận. Đang chờ người kia xác nhận.</span>
      : <><span>Món này được chọn từ các lựa chọn không ai từ chối.</span><button type="button" disabled={pending} onClick={() => void confirmProxy()}>Đồng ý chốt hộ</button></>}
    {error && <span role="alert">{error}</span>}
  </div>;
  if (!dish) return <div className="food-vote-done" role="status"><strong>Đã lưu kín lựa chọn của ông.</strong><span>Kết quả chỉ mở khi cả hai hoàn tất.</span></div>;

  return (
    <section className="food-voting" aria-labelledby="food-vote-title" aria-busy={pending}>
      <p className="eyebrow">Món {votes.length + 1}/{dishes.length}</p>
      <div className="food-vote-card">
        <h2 id="food-vote-title">{dish.name}</h2>
        <p>Lựa chọn này là riêng tư. Người kia sẽ không thấy câu trả lời của ông.</p>
      </div>
      <div className="food-vote-actions">
        <button type="button" disabled={pending} onClick={() => void vote("want")}>Muốn ăn</button>
        <button type="button" className="secondary-button" disabled={pending} onClick={() => void vote("no")}>Không</button>
        <button type="button" className="secondary-button" disabled={pending} onClick={() => void vote("skip")}>Bỏ qua</button>
      </div>
      <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error}</div>
    </section>
  );
}

export function FoodSessionSetup({ user }: { user: User }) {
  const [foodStyle, setFoodStyle] = useState<FoodConditions["foodStyle"]>("full_meal");
  const [category, setCategory] = useState("any");
  const [session, setSession] = useState<FoodSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const categories = useMemo(() => {
    const available = new Set(foodCatalog.dishes.filter((dish) => dish.foodStyle === foodStyle).flatMap((dish) => dish.categories));
    return foodCatalog.categories.filter((item) => available.has(item.id));
  }, [foodStyle]);

  async function loadSession() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/sessions", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Không tải được phiên chọn món.");
      setSession(foodSessionFrom(await response.json()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được phiên chọn món.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
    const synced = (event: Event) => {
      const status = (event as CustomEvent<OfflineQueueEventDetail>).detail.status;
      if (status === "sent" || status === "conflict") void loadSession();
    };
    window.addEventListener("our:offline-queue", synced);
    return () => window.removeEventListener("our:offline-queue", synced);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    setError("");
    try {
      await queueSessionCommand("/api/sessions", {
        feature: "food_vote",
        conditions: {
          foodStyle,
          meal: form.get("meal"),
          category,
          allergens: form.getAll("allergens"),
          exclusions: form.getAll("exclusions"),
        },
      });
      setMessage("Đã gửi thiết lập để người kia xem và xác nhận.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể lưu thiết lập.");
    } finally {
      setPending(false);
    }
  }

  async function act(action: "join" | "decline" | "cancel") {
    if (!session) return;
    setPending(true);
    setMessage("");
    setError("");
    try {
      await queueSessionCommand(`/api/sessions/${session.id}/${action}`, { expectedVersion: session.version });
      setMessage(action === "join" ? "Đã xác nhận thiết lập." : action === "decline" ? "Đã từ chối thiết lập." : "Đã đóng thiết lập cũ.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể cập nhật phiên.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <LoadingState label="Đang tải thiết lập món ăn…" />;
  if (error && !session) return <ErrorState title="Chưa mở được Hôm Nay Ăn Gì" retry={() => void loadSession()}>{error}</ErrorState>;

  if (session) {
    const ownsSession = session.createdByUserId === user.id;
    return (
      <section className="blind-bag-form food-setup" aria-labelledby="page-title">
        <p className="eyebrow">Hôm Nay Ăn Gì</p>
        <h1 id="page-title">{session.status === "active" ? "Hai đứa đã thống nhất" : ownsSession ? "Đang chờ người kia" : "Xem lại trước khi xác nhận"}</h1>
        <p>{session.status === "active" ? "Thiết lập đã được cả hai xác nhận và sẵn sàng cho bước chọn món." : ownsSession ? "Người kia sẽ thấy toàn bộ lựa chọn dưới đây trước khi đồng ý." : "Chỉ xác nhận khi mọi điều kiện đều ổn với ông."}</p>
        <SessionSummary session={session} />
        {session.status === "active" && <FoodVoting sessionId={session.id} />}
        {session.status === "pending" && <div className="food-actions">
          {ownsSession ? (
            <button type="button" disabled={pending} onClick={() => void act("cancel")}>Hủy để chọn lại</button>
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => void act("join")}>Xác nhận thiết lập</button>
              <button type="button" className="secondary-button" disabled={pending} onClick={() => void act("decline")}>Chưa đồng ý</button>
            </>
          )}
        </div>}
        <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
      </section>
    );
  }

  return (
    <section className="blind-bag-form food-setup" aria-labelledby="page-title">
      <p className="eyebrow">Hôm Nay Ăn Gì</p>
      <h1 id="page-title">Hôm nay mình muốn ăn kiểu nào?</h1>
      <p>Chọn trường phái trước, sau đó thêm vài điều kiện cần thiết. Không có bước chọn quán.</p>
      <form onSubmit={submit} aria-busy={pending}>
        <fieldset className="food-style-options">
          <legend>Trường phái</legend>
          {foodCatalog.foodStyles.map((style) => (
            <label key={style.id}>
              <input type="radio" name="foodStyle" value={style.id} checked={foodStyle === style.id} onChange={() => { setFoodStyle(style.id as FoodConditions["foodStyle"]); setCategory("any"); }} />
              <span aria-hidden="true">{style.id === "full_meal" ? "🍲" : "🍢"}</span>
              <strong>{style.label}</strong>
              <small>{style.id === "full_meal" ? "Cơm, món nước, lẩu và món chính" : "Món nhẹ, đồ chiên và tráng miệng"}</small>
            </label>
          ))}
        </fieldset>

        <label>Bữa ăn
          <select name="meal" defaultValue="any">
            {Object.entries(mealLabels).map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
        </label>

        <label>Danh mục
          <select name="category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="any">Bất kỳ trong {label(foodCatalog.foodStyles, foodStyle)}</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>

        <details className="food-filters">
          <summary>Dị ứng cần tránh</summary>
          <div>{foodCatalog.allergens.map((item) => <label key={item.id}><input type="checkbox" name="allergens" value={item.id} />{item.label}</label>)}</div>
        </details>
        <details className="food-filters">
          <summary>Món không muốn ăn</summary>
          <div>{foodCatalog.exclusions.map((item) => <label key={item.id}><input type="checkbox" name="exclusions" value={item.id} />{item.label}</label>)}</div>
        </details>

        <div className="settings-feedback" role={error ? "alert" : "status"} aria-live="polite">{error || message}</div>
        <button type="submit" disabled={pending}>{pending ? "Đang gửi…" : "Gửi người kia xác nhận"}</button>
      </form>
    </section>
  );
}
