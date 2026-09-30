import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
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
type Completion = { attemptId: string; body: { expectedVersion: number; outcome: "won" | "missed";
  steps: number; capturedPlushId?: string; controlTrace: ClawInput[] } };
type ClawCache = { attempt: Attempt | null; credits: Credits | null; collection: Capture[]; rewardTable: RewardOption[] };

const STEP_MS = 1000 / 60;
const CACHE_KEY = "our:claw-state:v1";
const COMPLETION_KEY = "our:claw-completion:v1";
const plushStyle: Record<string, { color: string; ears: "round" | "long" | "small" }> = {
  bear: { color: "#c98c62", ears: "round" }, rabbit: { color: "#f4d8df", ears: "long" },
  cat: { color: "#e6b765", ears: "small" }, capybara: { color: "#ad7955", ears: "round" },
  dinosaur: { color: "#83b895", ears: "small" }, seal: { color: "#a9c7d9", ears: "round" },
};

function PlushIcon({ id }: { id: string }) {
  const style = plushStyle[id] ?? { color: "#c7a6cf", ears: "round" as const };
  return <span className={`claw-plush-icon claw-plush-icon--${style.ears}`} aria-hidden="true"
    style={{ "--plush-color": style.color } as CSSProperties} />;
}

async function call(path: string, method = "GET", body?: unknown): Promise<Payload> {
  const response = await fetch(path, { method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => null) as Payload | null;
  if (!response.ok) throw new Error(payload?.error ?? "Máy gắp đang bận, thử lại một chút nhé.");
  return payload ?? {};
}

function stored<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; } catch { return null; }
}

function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private browsing may block storage */ }
}

function forget(key: string) {
  try { localStorage.removeItem(key); } catch { /* private browsing may block storage */ }
}

async function completeWithReconciliation(completion: Completion) {
  try {
    return await call(`/api/claw/attempts/${completion.attemptId}/complete`, "POST", completion.body);
  } catch (firstError) {
    const active = await call("/api/claw/attempts/active").catch(() => null);
    const expectedVersion = active?.attempt?.id === completion.attemptId
      ? active.attempt.version : completion.body.expectedVersion;
    try {
      return await call(`/api/claw/attempts/${completion.attemptId}/complete`, "POST",
        { ...completion.body, expectedVersion });
    } catch { throw firstError; }
  }
}

function mergeCachedTrace(server: Attempt | null, cached: Attempt | null) {
  if (!server || !cached || server.id !== cached.id || server.status !== "playing"
    || cached.controlTrace.length <= server.controlTrace.length
    || JSON.stringify(cached.controlTrace.slice(0, server.controlTrace.length)) !== JSON.stringify(server.controlTrace)) return server;
  return { ...server, controlTrace: cached.controlTrace };
}

function drawPlush(context: CanvasRenderingContext2D, plush: ClawSnapshot["plushes"][number], scale = 1) {
  const style = plushStyle[plush.id] ?? { color: "#c7a6cf", ears: "round" as const };
  context.save();
  context.translate(plush.x, plush.y);
  context.rotate(plush.angle);
  context.scale(scale, scale);
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

function polygon(context: CanvasRenderingContext2D, points: [number, number][]) {
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath();
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
  context.fillStyle = "#463252"; context.fillRect(8, 8, 344, 52);
  context.fillStyle = "#fff1f5"; context.font = "800 15px system-ui"; context.textAlign = "center";
  context.fillText("MÁY GẮP CỦA NHI", 180, 38); context.textAlign = "start";
  const glass = context.createLinearGradient(0, 60, 360, 555);
  glass.addColorStop(0, "rgba(255,255,255,.13)"); glass.addColorStop(.45, "rgba(255,255,255,.035)"); glass.addColorStop(1, "rgba(124,83,143,.18)");
  context.fillStyle = glass; polygon(context, [[20, 60], [340, 60], [326, 555], [34, 555]]); context.fill();
  context.fillStyle = "rgba(10,7,14,.36)";
  polygon(context, [[20, 60], [53, 82], [53, 520], [34, 555]]); context.fill();
  polygon(context, [[340, 60], [307, 82], [307, 520], [326, 555]]); context.fill();
  context.fillStyle = "rgba(141,91,161,.28)";
  polygon(context, [[34, 555], [326, 555], [307, 492], [53, 492]]); context.fill();
  context.strokeStyle = "rgba(255,255,255,.08)"; context.lineWidth = 1;
  for (let depth = 0; depth < 4; depth++) {
    const inset = depth * 7;
    context.beginPath(); context.moveTo(38 + inset, 548 - depth * 15); context.lineTo(322 - inset, 548 - depth * 15); context.stroke();
  }
  context.strokeStyle = "#c6a6d6"; context.lineWidth = 4; context.strokeRect(17, 20, 326, 535);
  context.fillStyle = "#8e5ca2"; context.fillRect(22, 58, 316, 8);
  context.fillStyle = "#382943"; context.fillRect(88, 520, 250, 35);
  context.strokeStyle = "rgba(255,255,255,.1)"; context.lineWidth = 2;
  for (let x = 100; x < 338; x += 24) { context.beginPath(); context.moveTo(x, 520); context.lineTo(x - 12, 555); context.stroke(); }
  context.fillStyle = "#17111f"; context.fillRect(0, 580, 360, 60);
  context.fillStyle = "#60416e"; context.fillRect(95, 575, 265, 26);
  context.fillStyle = "#120e18"; context.fillRect(0, 555, 88, 85);
  context.strokeStyle = "#f0a3b5"; context.lineWidth = 3; context.strokeRect(5, 560, 78, 72);
  context.fillStyle = "#f7d7e0"; context.font = "700 12px system-ui"; context.fillText("MÁNG QUÀ", 11, 625);
  for (const plush of [...snapshot.plushes].sort((left, right) => left.z - right.z)) {
    const depthScale = .84 + (plush.z - 30) / 120 * .18;
    const projected = { ...plush, x: 180 + (plush.x - 180) * depthScale,
      y: plush.y + (plush.z - 90) * .28 };
    context.save();
    context.fillStyle = "rgba(9,6,12,.28)";
    context.beginPath(); context.ellipse(projected.x + 5, Math.min(558, projected.y + plush.radius * .8), plush.radius * .9, plush.radius * .28, 0, 0, Math.PI * 2); context.fill();
    context.restore();
    drawPlush(context, projected, depthScale);
  }

  const { x, y, z, close } = snapshot.claw;
  const clawScale = .84 + (z - 30) / 120 * .18;
  const clawX = 180 + (x - 180) * clawScale;
  const clawY = y + (z - 90) * .28;
  context.strokeStyle = "#eadff0"; context.lineWidth = 3; context.beginPath(); context.moveTo(clawX, 47); context.lineTo(clawX, clawY); context.stroke();
  context.fillStyle = "#d4b5df"; context.beginPath(); context.arc(clawX, clawY, 9 * clawScale, 0, Math.PI * 2); context.fill();
  const spread = 20 - close * 10;
  context.strokeStyle = "#d4b5df"; context.lineWidth = 7; context.lineCap = "round";
  context.beginPath(); context.moveTo(clawX - 3, clawY + 6); context.quadraticCurveTo(clawX - spread, clawY + 25, clawX - spread + close * 5, clawY + 52); context.stroke();
  context.beginPath(); context.moveTo(clawX + 3, clawY + 6); context.quadraticCurveTo(clawX + spread, clawY + 25, clawX + spread - close * 5, clawY + 52); context.stroke();
  context.strokeStyle = "rgba(255,255,255,.16)"; context.lineWidth = 2;
  context.beginPath(); context.moveTo(70, 72); context.lineTo(35, 430); context.stroke();
  context.beginPath(); context.moveTo(294, 72); context.lineTo(325, 350); context.stroke();
  context.restore();
}

function drawTopCamera(canvas: HTMLCanvasElement, snapshot: ClawSnapshot) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== 160 * ratio || canvas.height !== 108 * ratio) {
    canvas.width = 160 * ratio; canvas.height = 108 * ratio;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, 160, 108);
  const background = context.createLinearGradient(0, 0, 0, 108);
  background.addColorStop(0, "#201729"); background.addColorStop(1, "#0e0a13");
  context.fillStyle = background; context.fillRect(0, 0, 160, 108);
  context.strokeStyle = "rgba(255,255,255,.08)"; context.lineWidth = 1;
  for (let x = 16; x < 160; x += 24) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 108); context.stroke(); }
  for (let y = 15; y < 108; y += 20) { context.beginPath(); context.moveTo(0, y); context.lineTo(160, y); context.stroke(); }

  const projectX = (x: number) => 10 + Math.max(0, Math.min(1, (x - 90) / 270)) * 140;
  const projectZ = (z: number) => 12 + Math.max(0, Math.min(1, (z - 30) / 120)) * 84;
  for (const plush of snapshot.plushes) {
    const x = projectX(plush.x);
    const y = projectZ(plush.z);
    const style = plushStyle[plush.id] ?? { color: "#c7a6cf" };
    context.fillStyle = "rgba(0,0,0,.28)"; context.beginPath(); context.ellipse(x + 2, y + 3, 8, 5, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = style.color; context.beginPath(); context.arc(x, y, 7, 0, Math.PI * 2); context.fill();
    context.fillStyle = "rgba(255,255,255,.55)"; context.beginPath(); context.arc(x - 2, y - 2, 1.4, 0, Math.PI * 2); context.fill();
  }

  const targetX = projectX(snapshot.claw.x);
  const targetY = projectZ(snapshot.claw.z);
  context.strokeStyle = "#ff4f64"; context.lineWidth = 1.5;
  context.beginPath(); context.arc(targetX, targetY, 10, 0, Math.PI * 2); context.stroke();
  context.beginPath(); context.moveTo(targetX - 15, targetY); context.lineTo(targetX + 15, targetY); context.moveTo(targetX, targetY - 15); context.lineTo(targetX, targetY + 15); context.stroke();
  context.fillStyle = "#ff4058"; context.beginPath(); context.arc(targetX, targetY, 3.2, 0, Math.PI * 2); context.fill();
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
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const canvas = useRef<HTMLCanvasElement>(null);
  const topCanvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<ClawPhysics | null>(null);
  const controls = useRef<ClawInput[]>([]);
  const pendingControls = useRef(new Map<number, Omit<ClawInput, "step">>());
  const move = useRef({ x: 0, z: 0 });
  const scheduledMove = useRef({ x: 0, z: 0 });
  const dropped = useRef(false);
  const version = useRef(1);
  const syncQueue = useRef(Promise.resolve());
  const finishing = useRef(false);
  const createKey = useRef(crypto.randomUUID());
  const purchaseKey = useRef(crypto.randomUUID());
  const audio = useRef<AudioContext | null>(null);
  const [joystick, setJoystick] = useState({ x: 0, z: 0 });
  const [feedback, setFeedback] = useState(() => stored<boolean>("our:claw-feedback:v1") ?? true);

  function sound(kind: "start" | "drop" | "won" | "missed", force = false) {
    if (!feedback && !force) return;
    try {
      const context = audio.current ?? new AudioContext();
      audio.current = context;
      void context.resume();
      const notes = kind === "won" ? [523, 659, 784] : kind === "missed" ? [330, 247] : kind === "drop" ? [440, 330] : [392, 523];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const begins = context.currentTime + index * .09;
        oscillator.type = "sine"; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, begins); gain.gain.exponentialRampToValueAtTime(.08, begins + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, begins + .13);
        oscillator.connect(gain).connect(context.destination); oscillator.start(begins); oscillator.stop(begins + .14);
      });
    } catch { /* audio is optional */ }
  }

  async function load(showLoading = true) {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [active, owned] = await Promise.all([call("/api/claw/attempts/active"), call("/api/claw/collection")]);
      const cached = stored<ClawCache>(CACHE_KEY);
      setAttempt((current) => {
        if (!active.attempt) return current && ["won", "missed", "abandoned"].includes(current.status) ? current : null;
        if (current?.id === active.attempt.id && ["won", "missed", "abandoned"].includes(current.status)
          && ["ready", "playing"].includes(active.attempt.status)) return current;
        return mergeCachedTrace(active.attempt, cached?.attempt ?? current);
      });
      setCredits(active.credits ?? null);
      setCollection(owned.collection ?? []); setRewardTable(owned.rewardTable ?? []);
    } catch (reason) {
      const cached = stored<ClawCache>(CACHE_KEY);
      if (cached) {
        const timedOut = cached.attempt && ["ready", "playing"].includes(cached.attempt.status)
          && cached.attempt.expiresAt <= Math.floor(Date.now() / 1000);
        setAttempt(timedOut ? { ...cached.attempt!, status: "abandoned" } : cached.attempt);
        setCredits(cached.credits); setCollection(cached.collection); setRewardTable(cached.rewardTable);
        setError("Đang mất mạng · tiến trình đã được giữ trên máy này.");
      } else setError(reason instanceof Error ? reason.message : "Chưa mở được máy gắp.");
    } finally { setLoading(false); }
  }

  async function recover(showLoading = true) {
    const pendingCompletion = stored<Completion>(COMPLETION_KEY);
    if (pendingCompletion && navigator.onLine) {
      try {
        const payload = await completeWithReconciliation(pendingCompletion);
        forget(COMPLETION_KEY);
        if (payload.capture) setLatestCapture(payload.capture);
      } catch {
        const active = await call("/api/claw/attempts/active").catch(() => null);
        if (active?.attempt?.id === pendingCompletion.attemptId && active.attempt.status === "abandoned") forget(COMPLETION_KEY);
      }
    }
    await load(showLoading);
  }

  useEffect(() => {
    void recover();
    let stopped = false;
    let reconnect = 0;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (stopped || !navigator.onLine || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      const url = new URL("/ws", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.addEventListener("open", () => void recover(false));
      socket.addEventListener("message", ({ data }) => {
        try { if ((JSON.parse(String(data)) as { type?: string }).type === "claw.updated") void load(false); }
        catch { /* ignore malformed realtime messages */ }
      });
      socket.addEventListener("close", () => { if (!stopped) reconnect = window.setTimeout(connect, 1_000); });
    };
    const online = () => { void recover(false); connect(); };
    connect(); window.addEventListener("online", online);
    return () => { stopped = true; window.clearTimeout(reconnect); window.removeEventListener("online", online); socket?.close(); };
  }, []);

  useEffect(() => () => { void audio.current?.close(); }, []);

  useEffect(() => {
    if (!loading) store(CACHE_KEY, { attempt, credits, collection, rewardTable } satisfies ClawCache);
  }, [attempt, credits, collection, rewardTable, loading]);

  useEffect(() => {
    if (!attempt || !["ready", "playing"].includes(attempt.status)) return;
    const tick = () => {
      const value = Math.floor(Date.now() / 1000);
      setNow(value);
      if (value >= attempt.expiresAt) {
        setAttempt((current) => current?.id === attempt.id ? { ...current, status: "abandoned" } : current);
        if (navigator.onLine) void load(false);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [attempt?.id, attempt?.status, attempt?.expiresAt]);

  function syncTrace(trace: ClawInput[]) {
    if (!attempt) return;
    const copy = structuredClone(trace);
    syncQueue.current = syncQueue.current.then(async () => {
      const payload = await call(`/api/claw/attempts/${attempt.id}/trace`, "POST", {
        expectedVersion: version.current, controlTrace: copy,
      });
      if (payload.attempt) {
        const saved = payload.attempt;
        version.current = saved.version;
        setAttempt((current) => current?.id === saved.id && current.controlTrace.length > saved.controlTrace.length
          ? { ...saved, controlTrace: current.controlTrace } : saved);
      }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Chưa lưu được thao tác."));
  }

  function schedule(input: Omit<ClawInput, "step">) {
    const current = game.current;
    if (!current || dropped.current) return;
    const lastStep = controls.current.at(-1)?.step ?? 0;
    const step = Math.max(current.stepNumber + 1, lastStep + 1);
    if (input.move !== undefined) scheduledMove.current.x = input.move;
    if (input.moveX !== undefined) scheduledMove.current.x = input.moveX;
    if (input.moveZ !== undefined) scheduledMove.current.z = input.moveZ;
    if (input.drop) {
      input.moveX = 0; input.moveZ = 0; scheduledMove.current = { x: 0, z: 0 };
      setJoystick({ x: 0, z: 0 }); dropped.current = true; sound("drop");
    }
    const control = { step, ...input } as ClawInput;
    controls.current = [...controls.current, control];
    const attemptId = attempt?.id;
    setAttempt((saved) => saved && saved.id === attemptId ? { ...saved, controlTrace: controls.current } : saved);
    pendingControls.current.set(step, input);
    syncTrace(controls.current);
  }

  function steer(x: number, z: number) {
    if ((x === scheduledMove.current.x && z === scheduledMove.current.z) || dropped.current) return;
    schedule({ moveX: x, moveZ: z });
  }

  function moveJoystick(event: PointerEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - box.left - box.width / 2) / (box.width * .34);
    const rawZ = (event.clientY - box.top - box.height / 2) / (box.height * .34);
    const length = Math.max(1, Math.hypot(rawX, rawZ));
    const next = { x: Math.round(rawX / length * 4) / 4, z: Math.round(rawZ / length * 4) / 4 };
    setJoystick(next); steer(next.x, next.z);
  }

  function releaseJoystick() {
    setJoystick({ x: 0, z: 0 }); steer(0, 0);
  }

  async function finish(result: ReturnType<ClawPhysics["result"]>) {
    if (!attempt) return;
    await syncQueue.current;
    try {
      const outcome = result.outcome === "won" ? "won" : "missed";
      const body: Completion["body"] = {
        expectedVersion: version.current, outcome, steps: result.steps,
        capturedPlushId: outcome === "won" ? result.capturedPlushId ?? undefined : undefined,
        controlTrace: controls.current,
      };
      const completion = { attemptId: attempt.id, body } satisfies Completion;
      store(COMPLETION_KEY, completion);
      const payload = await completeWithReconciliation(completion);
      forget(COMPLETION_KEY);
      if (payload.attempt) { version.current = payload.attempt.version; setAttempt(payload.attempt); }
      if (payload.capture) {
        setLatestCapture(payload.capture);
        setCollection((items) => [payload.capture!, ...items.filter(({ instanceId }) => instanceId !== payload.capture!.instanceId)]);
      }
      sound(outcome);
      if (feedback && !user.preferences.reducedMotion) navigator.vibrate?.(outcome === "won" ? [35, 45, 70] : 25);
    } catch (reason) { setError(navigator.onLine
      ? (reason instanceof Error ? reason.message : "Chưa ghi nhận được lượt chơi.")
      : "Đã giữ kết quả trên máy · khi có mạng hệ thống sẽ tự gửi lại."); }
  }

  useEffect(() => {
    if (!attempt || attempt.status !== "playing" || !canvas.current || !topCanvas.current) return;
    const machine = new ClawPhysics(attempt.seed);
    game.current = machine; controls.current = [...attempt.controlTrace]; version.current = attempt.version;
    pendingControls.current.clear(); move.current = { x: 0, z: 0 }; scheduledMove.current = { x: 0, z: 0 };
    dropped.current = attempt.controlTrace.some(({ drop }) => drop); finishing.current = false;
    const replay = new Map(attempt.controlTrace.map(({ step, ...input }) => [step, input]));
    const lastSavedStep = attempt.controlTrace.at(-1)?.step ?? 0;
    while (machine.stepNumber < lastSavedStep) {
      const input = replay.get(machine.stepNumber + 1);
      if (input?.move !== undefined) move.current.x = input.move;
      if (input?.moveX !== undefined) move.current.x = input.moveX;
      if (input?.moveZ !== undefined) move.current.z = input.moveZ;
      machine.step({ moveX: move.current.x, moveZ: move.current.z, ...(input?.drop ? { drop: true } : {}) });
    }
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    const animate = (now: number) => {
      accumulator += Math.min(100, now - previous); previous = now;
      while (accumulator >= STEP_MS && !["won", "missed", "abandoned"].includes(machine.phase)) {
        const input = pendingControls.current.get(machine.stepNumber + 1);
        if (input?.move !== undefined) move.current.x = input.move;
        if (input?.moveX !== undefined) move.current.x = input.moveX;
        if (input?.moveZ !== undefined) move.current.z = input.moveZ;
        machine.step({ moveX: move.current.x, moveZ: move.current.z, ...(input?.drop ? { drop: true } : {}) });
        accumulator -= STEP_MS;
      }
      const snapshot = machine.snapshot();
      setPhase(snapshot.phase);
      drawMachine(canvas.current!, snapshot, user.preferences.reducedMotion);
      drawTopCamera(topCanvas.current!, snapshot);
      if (["won", "missed", "abandoned"].includes(machine.phase)) {
        if (!finishing.current) { finishing.current = true; void finish(machine.result()); }
        return;
      }
      frame = requestAnimationFrame(animate);
    };
    drawMachine(canvas.current, machine.snapshot(), user.preferences.reducedMotion);
    drawTopCamera(topCanvas.current, machine.snapshot());
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
    sound("start");
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
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) return;
    event.preventDefault();
    if (event.key === " " && pressed) schedule({ drop: true });
    else if (event.key !== " ") {
      const x = pressed && event.key === "ArrowLeft" ? -1 : pressed && event.key === "ArrowRight" ? 1 : 0;
      const z = pressed && event.key === "ArrowUp" ? -1 : pressed && event.key === "ArrowDown" ? 1 : 0;
      setJoystick({ x, z }); steer(x, z);
    }
  }

  const playing = attempt?.status === "playing";
  const canPlay = user.role === "girlfriend";
  const remaining = attempt && ["ready", "playing"].includes(attempt.status) ? Math.max(0, attempt.expiresAt - now) : null;
  return <section className="claw-game" aria-labelledby="page-title" onKeyDown={(event) => keyboard(event, true)} onKeyUp={(event) => keyboard(event, false)}>
    <header className="claw-game__header">
      <div><p className="eyebrow">Máy gắp của Nhi</p><h1 id="page-title">Gắp một bé về nhà</h1></div>
      <div className="claw-status">
        <button type="button" className="claw-feedback" aria-pressed={feedback}
          aria-label={`${feedback ? "Tắt" : "Bật"} âm thanh và rung`} onClick={() => {
            const enabled = !feedback; setFeedback(enabled); store("our:claw-feedback:v1", enabled);
            if (enabled) sound("start", true);
          }}>{feedback ? "🔊" : "🔇"}</button>
        <span className="claw-credit" aria-label={`${credits?.balance ?? 0} lượt gắp`}>🕹️ {credits?.balance ?? "…"}</span>
      </div>
    </header>
    {remaining !== null && <p className="claw-timeout" role="status">Lượt này còn {remaining} giây</p>}
    {loading ? <p className="claw-message" role="status">Đang bật đèn máy gắp…</p> : null}
    {!loading && playing ? <>
      <div className={`claw-machine claw-machine--${phase}`}>
        <canvas className="claw-machine__main" ref={canvas} role="img" aria-label="Góc nhìn chính từ bên ngoài máy gắp, với sáu thú bông và máng quà bên trái" />
        <span className="claw-machine__view-label" aria-hidden="true">GÓC NHÌN CHÍNH</span>
        <aside className="claw-camera" aria-label="Camera nóc máy gắp với tâm ngắm màu đỏ">
          <div className="claw-camera__status"><span aria-hidden="true" /> CAM NÓC</div>
          <canvas ref={topCanvas} role="img" aria-label="Góc nhìn từ camera trên nóc với tâm ngắm màu đỏ" />
        </aside>
        <p className="claw-phase" aria-live="polite">{phaseText[phase] ?? "Đang kiểm tra kết quả…"}</p>
      </div>
      <div className="claw-controls" aria-label="Điều khiển máy gắp">
        <button className="claw-joystick" type="button" disabled={!canPlay || dropped.current}
          aria-label="Cần điều khiển càng theo bốn hướng" style={{ "--stick-x": joystick.x, "--stick-z": joystick.z } as CSSProperties}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); moveJoystick(event); }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveJoystick(event); }}
          onPointerUp={releaseJoystick} onPointerCancel={releaseJoystick}>
          <span className="claw-joystick__gate" aria-hidden="true" />
          <span className="claw-joystick__stick" aria-hidden="true" />
        </button>
        <button className="claw-drop" type="button" disabled={!canPlay || dropped.current} onClick={() => schedule({ drop: true })}>
          <span aria-hidden="true">●</span><strong>HẠ CÀNG</strong>
        </button>
      </div>
    </> : null}
    {!loading && attempt?.status === "ready" ? <div className="claw-lobby">
      <PlushIcon id="bear" /><h2>Máy đã xếp thú xong</h2><p>Một lượt chỉ bắt đầu khi em bấm nút bên dưới.</p>
      {canPlay ? <button type="button" disabled={pending} onClick={() => void start()}>{pending ? "Đang khởi động…" : "Bắt đầu gắp"}</button>
        : <p>Đợi Nhi khởi động máy nhé.</p>}
    </div> : null}
    {!loading && attempt && ["won", "missed", "abandoned"].includes(attempt.status) ? <div className={`claw-result claw-result--${attempt.status}`}>
      {attempt.status === "won" ? <PlushIcon id={attempt.capturedPlushId ?? "bear"} />
        : <span aria-hidden="true">{attempt.status === "abandoned" ? "⏳" : "🌙"}</span>}
      <h2>{attempt.status === "won" ? "Gắp được rồi!" : attempt.status === "abandoned" ? "Lượt gắp đã hết thời gian" : "Suýt nữa là được rồi"}</h2>
      <p>{attempt.status === "won" ? "Bé thú đã rơi gọn vào máng quà." : attempt.status === "abandoned"
        ? "Lượt đang chơi đã được đóng an toàn. Mình bắt đầu lượt mới nhé." : "Càng bị tuột mất, mình thử một vị trí khác nhé."}</p>
      {latestCapture?.attemptId === attempt.id && <div className="claw-reward" role="status">
        <PlushIcon id={latestCapture.plushId} />
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
        <PlushIcon id={item.plushId} />
        <strong>{item.plushLabel}</strong><small>Quà: +{item.reward.stars} ⭐</small>
      </article>)}</div> : <p className="claw-message">Bé thú đầu tiên vẫn đang chờ em gắp về.</p>}
      <details className="claw-odds"><summary>Quà có thể nhận</summary>
        <ul>{rewardTable.map((item) => <li key={item.id}><span>{item.label} · +{item.stars} ⭐</span><strong>{item.chancePercent}%</strong></li>)}</ul>
      </details>
    </section>}
  </section>;
}
