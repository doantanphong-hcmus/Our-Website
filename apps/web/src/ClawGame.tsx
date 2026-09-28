import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ClawPhysics, type ClawInput, type ClawSnapshot } from "@our-website/claw-physics";
import type { User } from "./user";

type Credits = { balance: number; packCost: number; attemptsPerPack: number; purchasedToday: number; maximumPacksPerDay: number };
type Attempt = {
  id: string; status: "ready" | "playing" | "won" | "missed" | "abandoned"; seed: number;
  controlTrace: ClawInput[]; capturedPlushId: string | null; resultSteps: number | null;
  version: number; expiresAt: number;
};
type Reward = { id: string; tableVersion: number; tierId: string; label: string; stars: number; createdAt: number };
type Capture = { instanceId: string; attemptId: string; plushId: string; plushLabel: string; capturedAt: number; reward: Reward };
type RewardOption = { id: string; label: string; chancePercent: number; stars: number };
type Payload = { error?: string; credits?: Credits; attempt?: Attempt; capture?: Capture;
  collection?: Capture[]; rewardTable?: RewardOption[] };

const STEP_MS = 1000 / 60;
const plushStyle: Record<string, { color: string; ears: "round" | "long" | "small" }> = {
  bear: { color: "#c98c62", ears: "round" }, rabbit: { color: "#f4d8df", ears: "long" },
  cat: { color: "#e6b765", ears: "small" }, capybara: { color: "#ad7955", ears: "round" },
  dinosaur: { color: "#83b895", ears: "small" }, seal: { color: "#a9c7d9", ears: "round" },
};
const plushEmoji: Record<string, string> = {
  bear: "🧸", rabbit: "🐰", cat: "🐱", capybara: "🦫", dinosaur: "🦕", seal: "🦭",
};

async function call(path: string, method = "GET", body?: unknown): Promise<Payload> {
  const response = await fetch(path, { method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => null) as Payload | null;
  if (!response.ok) throw new Error(payload?.error ?? "Máy gắp đang bận, thử lại một chút nhé.");
  return payload ?? {};
}

function drawPlush(context: CanvasRenderingContext2D, plush: ClawSnapshot["plushes"][number]) {
  const style = plushStyle[plush.id] ?? { color: "#c7a6cf", ears: "round" as const };
  context.save();
  context.translate(plush.x, plush.y);
  context.rotate(plush.angle);
  context.fillStyle = style.color;
  if (style.ears === "long") {
    context.beginPath(); context.ellipse(-9, -plush.radius, 6, 17, -0.18, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.ellipse(9, -plush.radius, 6, 17, 0.18, 0, Math.PI * 2); context.fill();
  } else {
    const ear = style.ears === "small" ? 6 : 9;
    context.beginPath(); context.arc(-plush.radius * .58, -plush.radius * .62, ear, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.arc(plush.radius * .58, -plush.radius * .62, ear, 0, Math.PI * 2); context.fill();
  }
  context.beginPath(); context.ellipse(0, 0, plush.radius, plush.radius * .92, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#2b2430";
  context.beginPath(); context.arc(-7, -3, 2.2, 0, Math.PI * 2); context.arc(7, -3, 2.2, 0, Math.PI * 2); context.fill();
  context.strokeStyle = "#2b2430"; context.lineWidth = 1.8; context.lineCap = "round";
  context.beginPath(); context.arc(0, 4, 5, .2, Math.PI - .2); context.stroke();
  context.restore();
}

function drawMachine(canvas: HTMLCanvasElement, snapshot: ClawSnapshot, reducedMotion: boolean) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== 360 * ratio || canvas.height !== 640 * ratio) {
    canvas.width = 360 * ratio; canvas.height = 640 * ratio;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, 360, 640);
  const shake = !reducedMotion && snapshot.phase === "close" ? Math.sin(snapshot.step * 1.7) * 2 : 0;
  context.save(); context.translate(shake, 0);
  const background = context.createLinearGradient(0, 0, 0, 640);
  background.addColorStop(0, "#342743"); background.addColorStop(.7, "#241b30"); background.addColorStop(1, "#17111f");
  context.fillStyle = background; context.fillRect(0, 0, 360, 640);
  context.fillStyle = "rgba(255,255,255,.06)"; context.fillRect(17, 20, 326, 535);
  context.strokeStyle = "#c6a6d6"; context.lineWidth = 4; context.strokeRect(17, 20, 326, 535);
  context.fillStyle = "#8e5ca2"; context.fillRect(22, 28, 316, 19);
  context.fillStyle = "#17111f"; context.fillRect(0, 580, 360, 60);
  context.fillStyle = "#60416e"; context.fillRect(95, 575, 265, 26);
  context.fillStyle = "#120e18"; context.fillRect(0, 555, 88, 85);
  context.strokeStyle = "#f0a3b5"; context.lineWidth = 3; context.strokeRect(5, 560, 78, 72);
  context.fillStyle = "#f7d7e0"; context.font = "700 12px system-ui"; context.fillText("MÁNG QUÀ", 11, 625);
  for (const plush of snapshot.plushes) drawPlush(context, plush);

  const { x, y, close } = snapshot.claw;
  context.strokeStyle = "#eadff0"; context.lineWidth = 3; context.beginPath(); context.moveTo(x, 47); context.lineTo(x, y); context.stroke();
  context.fillStyle = "#d4b5df"; context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.fill();
  const spread = 20 - close * 10;
  context.strokeStyle = "#d4b5df"; context.lineWidth = 7; context.lineCap = "round";
  context.beginPath(); context.moveTo(x - 3, y + 6); context.quadraticCurveTo(x - spread, y + 25, x - spread + close * 5, y + 52); context.stroke();
  context.beginPath(); context.moveTo(x + 3, y + 6); context.quadraticCurveTo(x + spread, y + 25, x + spread - close * 5, y + 52); context.stroke();
  context.restore();
}

const phaseText: Record<string, string> = {
  aim: "Canh vị trí rồi thả càng nhé", drop: "Càng đang hạ xuống…", close: "Kẹp thật chắc!",
  lift: "Đang nâng lên…", return: "Mang bé thú về máng…", release: "Thả quà nào!", settle: "Chờ một chút…",
};

export function ClawGame({ user }: { user: User }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [collection, setCollection] = useState<Capture[]>([]);
  const [rewardTable, setRewardTable] = useState<RewardOption[]>([]);
  const [latestCapture, setLatestCapture] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("aim");
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<ClawPhysics | null>(null);
  const controls = useRef<ClawInput[]>([]);
  const pendingControls = useRef(new Map<number, Omit<ClawInput, "step">>());
  const move = useRef<-1 | 0 | 1>(0);
  const scheduledMove = useRef<-1 | 0 | 1>(0);
  const dropped = useRef(false);
  const version = useRef(1);
  const syncQueue = useRef(Promise.resolve());
  const finishing = useRef(false);
  const createKey = useRef(crypto.randomUUID());
  const purchaseKey = useRef(crypto.randomUUID());

  async function load() {
    setLoading(true); setError("");
    try {
      const [active, owned] = await Promise.all([call("/api/claw/attempts/active"), call("/api/claw/collection")]);
      setAttempt(active.attempt ?? null); setCredits(active.credits ?? null);
      setCollection(owned.collection ?? []); setRewardTable(owned.rewardTable ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chưa mở được máy gắp."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function syncTrace(trace: ClawInput[]) {
    if (!attempt) return;
    const copy = structuredClone(trace);
    syncQueue.current = syncQueue.current.then(async () => {
      const payload = await call(`/api/claw/attempts/${attempt.id}/trace`, "POST", {
        expectedVersion: version.current, controlTrace: copy,
      });
      if (payload.attempt) { version.current = payload.attempt.version; setAttempt(payload.attempt); }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Chưa lưu được thao tác."));
  }

  function schedule(input: Omit<ClawInput, "step">) {
    const current = game.current;
    if (!current || dropped.current) return;
    const lastStep = controls.current.at(-1)?.step ?? 0;
    const step = Math.max(current.stepNumber + 1, lastStep + 1);
    if (input.move !== undefined) scheduledMove.current = input.move;
    if (input.drop) { input.move = 0; scheduledMove.current = 0; dropped.current = true; }
    const control = { step, ...input } as ClawInput;
    controls.current = [...controls.current, control];
    pendingControls.current.set(step, input);
    syncTrace(controls.current);
  }

  function steer(direction: -1 | 0 | 1) {
    if (direction === scheduledMove.current || dropped.current) return;
    schedule({ move: direction });
  }

  async function finish(result: ReturnType<ClawPhysics["result"]>) {
    if (!attempt) return;
    await syncQueue.current;
    try {
      const outcome = result.outcome === "won" ? "won" : "missed";
      const payload = await call(`/api/claw/attempts/${attempt.id}/complete`, "POST", {
        expectedVersion: version.current, outcome, steps: result.steps,
        capturedPlushId: outcome === "won" ? result.capturedPlushId : undefined,
        controlTrace: controls.current,
      });
      if (payload.attempt) setAttempt(payload.attempt);
      if (payload.capture) {
        setLatestCapture(payload.capture);
        setCollection((items) => [payload.capture!, ...items.filter(({ instanceId }) => instanceId !== payload.capture!.instanceId)]);
      }
      navigator.vibrate?.(outcome === "won" ? [35, 45, 70] : 25);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chưa ghi nhận được lượt chơi."); }
  }

  useEffect(() => {
    if (!attempt || attempt.status !== "playing" || !canvas.current) return;
    const machine = new ClawPhysics(attempt.seed);
    game.current = machine; controls.current = [...attempt.controlTrace]; version.current = attempt.version;
    pendingControls.current.clear(); move.current = 0; scheduledMove.current = 0;
    dropped.current = attempt.controlTrace.some(({ drop }) => drop); finishing.current = false;
    const replay = new Map(attempt.controlTrace.map(({ step, ...input }) => [step, input]));
    const lastSavedStep = attempt.controlTrace.at(-1)?.step ?? 0;
    while (machine.stepNumber < lastSavedStep) {
      const input = replay.get(machine.stepNumber + 1);
      if (input?.move !== undefined) move.current = input.move;
      machine.step({ move: move.current, ...(input?.drop ? { drop: true } : {}) });
    }
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    const animate = (now: number) => {
      accumulator += Math.min(100, now - previous); previous = now;
      while (accumulator >= STEP_MS && !["won", "missed", "abandoned"].includes(machine.phase)) {
        const input = pendingControls.current.get(machine.stepNumber + 1);
        if (input?.move !== undefined) move.current = input.move;
        machine.step({ move: move.current, ...(input?.drop ? { drop: true } : {}) });
        accumulator -= STEP_MS;
      }
      const snapshot = machine.snapshot();
      setPhase(snapshot.phase);
      drawMachine(canvas.current!, snapshot, user.preferences.reducedMotion);
      if (["won", "missed", "abandoned"].includes(machine.phase)) {
        if (!finishing.current) { finishing.current = true; void finish(machine.result()); }
        return;
      }
      frame = requestAnimationFrame(animate);
    };
    drawMachine(canvas.current, machine.snapshot(), user.preferences.reducedMotion);
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); game.current = null; };
  }, [attempt?.id, attempt?.status, user.preferences.reducedMotion]);

  async function createAttempt() {
    setPending(true); setError("");
    try {
      const payload = await call("/api/claw/attempts", "POST", { idempotencyKey: createKey.current });
      createKey.current = crypto.randomUUID();
      if (payload.attempt) setAttempt(payload.attempt);
      if (payload.credits) setCredits(payload.credits);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chưa tạo được lượt chơi."); }
    finally { setPending(false); }
  }

  async function start() {
    if (!attempt) return;
    setPending(true); setError("");
    try {
      const payload = await call(`/api/claw/attempts/${attempt.id}/start`, "POST", { expectedVersion: attempt.version });
      if (payload.attempt) setAttempt(payload.attempt);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chưa khởi động được máy."); }
    finally { setPending(false); }
  }

  async function buyPack() {
    setPending(true); setError("");
    try {
      const payload = await call("/api/claw/credits/purchase", "POST", { idempotencyKey: purchaseKey.current });
      purchaseKey.current = crypto.randomUUID();
      if (payload.credits) setCredits(payload.credits);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chưa mua được lượt chơi."); }
    finally { setPending(false); }
  }

  function keyboard(event: KeyboardEvent<HTMLElement>, pressed: boolean) {
    if (!["ArrowLeft", "ArrowRight", " "].includes(event.key)) return;
    event.preventDefault();
    if (event.key === " " && pressed) schedule({ drop: true });
    else if (event.key !== " ") steer(pressed ? (event.key === "ArrowLeft" ? -1 : 1) : 0);
  }

  const playing = attempt?.status === "playing";
  const canPlay = user.role === "girlfriend";
  return <section className="claw-game" aria-labelledby="page-title" onKeyDown={(event) => keyboard(event, true)} onKeyUp={(event) => keyboard(event, false)}>
    <header className="claw-game__header">
      <div><p className="eyebrow">Máy gắp của Nhi</p><h1 id="page-title">Gắp một bé về nhà</h1></div>
      <span className="claw-credit" aria-label={`${credits?.balance ?? 0} lượt gắp`}>🕹️ {credits?.balance ?? "…"}</span>
    </header>
    {loading ? <p className="claw-message" role="status">Đang bật đèn máy gắp…</p> : null}
    {!loading && playing ? <>
      <div className={`claw-machine claw-machine--${phase}`}>
        <canvas ref={canvas} role="img" aria-label="Máy gắp với sáu thú bông và máng quà bên trái" />
        <p className="claw-phase" aria-live="polite">{phaseText[phase] ?? "Đang kiểm tra kết quả…"}</p>
      </div>
      <div className="claw-controls" aria-label="Điều khiển máy gắp">
        <button type="button" disabled={!canPlay || dropped.current} aria-label="Di chuyển càng sang trái"
          onPointerDown={(event: PointerEvent<HTMLButtonElement>) => { event.currentTarget.setPointerCapture(event.pointerId); steer(-1); }}
          onPointerUp={() => steer(0)} onPointerCancel={() => steer(0)}>←</button>
        <button className="claw-drop" type="button" disabled={!canPlay || dropped.current} onClick={() => schedule({ drop: true })}>THẢ CÀNG</button>
        <button type="button" disabled={!canPlay || dropped.current} aria-label="Di chuyển càng sang phải"
          onPointerDown={(event: PointerEvent<HTMLButtonElement>) => { event.currentTarget.setPointerCapture(event.pointerId); steer(1); }}
          onPointerUp={() => steer(0)} onPointerCancel={() => steer(0)}>→</button>
      </div>
    </> : null}
    {!loading && attempt?.status === "ready" ? <div className="claw-lobby">
      <span aria-hidden="true">🧸</span><h2>Máy đã xếp thú xong</h2><p>Một lượt chỉ bắt đầu khi em bấm nút bên dưới.</p>
      {canPlay ? <button type="button" disabled={pending} onClick={() => void start()}>{pending ? "Đang khởi động…" : "Bắt đầu gắp"}</button>
        : <p>Đợi Nhi khởi động máy nhé.</p>}
    </div> : null}
    {!loading && attempt && ["won", "missed", "abandoned"].includes(attempt.status) ? <div className="claw-result">
      <span aria-hidden="true">{attempt.status === "won" ? "🎉🧸" : "🌙"}</span>
      <h2>{attempt.status === "won" ? "Gắp được rồi!" : "Suýt nữa là được rồi"}</h2>
      <p>{attempt.status === "won" ? "Bé thú đã rơi gọn vào máng quà." : "Càng bị tuột mất, mình thử một vị trí khác nhé."}</p>
      {latestCapture?.attemptId === attempt.id && <div className="claw-reward" role="status">
        <span aria-hidden="true">{plushEmoji[latestCapture.plushId] ?? "🧸"}</span>
        <strong>{latestCapture.plushLabel}</strong>
        <small>{latestCapture.reward.label} · +{latestCapture.reward.stars} ⭐</small>
      </div>}
      {canPlay && (credits?.balance
        ? <button type="button" disabled={pending} onClick={() => void createAttempt()}>Gắp lượt tiếp theo</button>
        : <button type="button" disabled={pending || (credits?.purchasedToday ?? 0) >= (credits?.maximumPacksPerDay ?? 0)} onClick={() => void buyPack()}>
          Mua {credits?.attemptsPerPack ?? 5} lượt · {credits?.packCost ?? 20} ⭐
        </button>)}
    </div> : null}
    {!loading && !attempt ? <div className="claw-lobby">
      <span aria-hidden="true">🕹️</span><h2>{canPlay ? "Sẵn sàng thử vận may bằng kỹ năng?" : "Máy đang chờ Nhi"}</h2>
      <p>{canPlay ? "Giữ nút để canh ngang, rồi thả càng đúng lúc." : "Khi Nhi chơi, ông có thể vào đây xem trạng thái."}</p>
      {canPlay && <div className="claw-lobby__actions">
        <button type="button" disabled={pending || !credits?.balance} onClick={() => void createAttempt()}>{credits?.balance ? "Dùng 1 lượt" : "Chưa có lượt"}</button>
        <button className="secondary-button" type="button" disabled={pending || (credits?.purchasedToday ?? 0) >= (credits?.maximumPacksPerDay ?? 0)} onClick={() => void buyPack()}>
          Mua {credits?.attemptsPerPack ?? 5} lượt · {credits?.packCost ?? 20} ⭐
        </button>
      </div>}
    </div> : null}
    {error && <p className="claw-error" role="alert">{error}</p>}
    {!loading && <section className="claw-collection" aria-labelledby="claw-collection-title">
      <div><p className="eyebrow">Tủ thú của Nhi</p><h2 id="claw-collection-title">Bộ sưu tập</h2></div>
      {collection.length ? <div className="claw-collection__grid">{collection.map((item) => <article key={item.instanceId}>
        <span aria-hidden="true">{plushEmoji[item.plushId] ?? "🧸"}</span>
        <strong>{item.plushLabel}</strong><small>Quà: +{item.reward.stars} ⭐</small>
      </article>)}</div> : <p className="claw-message">Bé thú đầu tiên vẫn đang chờ em gắp về.</p>}
      <details className="claw-odds"><summary>Quà có thể nhận</summary>
        <ul>{rewardTable.map((item) => <li key={item.id}><span>{item.label} · +{item.stars} ⭐</span><strong>{item.chancePercent}%</strong></li>)}</ul>
      </details>
    </section>}
  </section>;
}
