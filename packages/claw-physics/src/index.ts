import Matter from "matter-js";

const { Bodies, Body, Composite, Constraint, Engine } = Matter;
const STEP_MS = 1000 / 60;
const WIDTH = 360;
const CLAW_START_X = 180;

export type ClawInput = { step: number; move?: -1 | 0 | 1; drop?: true };
export type ClawPhase = "aim" | "drop" | "close" | "lift" | "return" | "release" | "settle" | "won" | "missed" | "abandoned";
export type ClawResult = {
  outcome: "won" | "missed" | "abandoned";
  capturedPlushId: string | null;
  steps: number;
  finalPlushes: { id: string; x: number; y: number; angle: number }[];
};

type Plush = { id: string; body: Matter.Body; radius: number; grip: number };

function randomFrom(seed: number) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

export class ClawPhysics {
  readonly engine = Engine.create({ gravity: { x: 0, y: 1, scale: 0.001 } });
  readonly plushes: Plush[];
  phase: ClawPhase = "aim";
  stepNumber = 0;
  private phaseSteps = 0;
  private clawX = CLAW_START_X;
  private clawY = 70;
  private closeAmount = 0;
  private held: Plush | null = null;
  private releasedId: string | null = null;
  private grip: Matter.Constraint | null = null;
  private gripAlignment = 0;
  private readonly gripStrength: number;
  private readonly hub = Bodies.circle(CLAW_START_X, 70, 8, { isStatic: true, isSensor: true, label: "claw-hub" });
  private readonly leftProng = Bodies.rectangle(CLAW_START_X - 18, 96, 7, 48, { isStatic: true, angle: -0.35, label: "claw-left" });
  private readonly rightProng = Bodies.rectangle(CLAW_START_X + 18, 96, 7, 48, { isStatic: true, angle: 0.35, label: "claw-right" });

  constructor(seed: number, { gripStrength = 1 } = {}) {
    this.gripStrength = gripStrength;
    const random = randomFrom(seed);
    const definitions = [
      { id: "bear", radius: 23, density: 0.0010, grip: 0.78 },
      { id: "rabbit", radius: 19, density: 0.0008, grip: 0.58 },
      { id: "cat", radius: 21, density: 0.0010, grip: 0.68 },
      { id: "capybara", radius: 25, density: 0.0016, grip: 0.42 },
      { id: "dinosaur", radius: 24, density: 0.0015, grip: 0.52 },
      { id: "seal", radius: 20, density: 0.0008, grip: 0.82 },
    ];
    this.plushes = definitions.map((item, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const body = Bodies.circle(145 + column * 78 + (random() - 0.5) * 16,
        535 - row * 52 + (random() - 0.5) * 8, item.radius, {
          density: item.density, friction: 0.72, frictionStatic: 0.9, restitution: 0.08,
          angle: (random() - 0.5) * 0.45, label: `plush:${item.id}`,
        });
      return { id: item.id, body, radius: item.radius, grip: item.grip };
    });
    const boundaries = [
      Bodies.rectangle(-10, 320, 20, 640, { isStatic: true }),
      Bodies.rectangle(WIDTH + 10, 320, 20, 640, { isStatic: true }),
      Bodies.rectangle(225, 590, 270, 30, { isStatic: true, friction: 0.9 }),
      Bodies.rectangle(90, 565, 12, 150, { isStatic: true, friction: 0.8 }),
      Bodies.rectangle(43, 634, 86, 20, { isStatic: true }),
    ];
    Composite.add(this.engine.world, [...boundaries, ...this.plushes.map(({ body }) => body), this.hub, this.leftProng, this.rightProng]);
    for (let step = 0; step < 150; step++) Engine.update(this.engine, STEP_MS);
  }

  step(input?: Omit<ClawInput, "step">): ClawPhase {
    this.stepNumber++;
    this.phaseSteps++;
    if (this.phase === "aim") {
      this.clawX = Math.max(112, Math.min(340, this.clawX + (input?.move ?? 0) * 2.5));
      if (input?.drop) this.changePhase("drop");
    } else if (this.phase === "drop") {
      this.clawY += 3;
      if (this.clawY >= 480) this.changePhase("close");
    } else if (this.phase === "close") {
      this.closeAmount = Math.min(1, this.closeAmount + 0.08);
      if (this.phaseSteps >= 16) { this.attachClosest(); this.changePhase("lift"); }
    } else if (this.phase === "lift") {
      this.clawY -= 3;
      this.checkGrip();
      if (this.clawY <= 80) this.changePhase("return");
    } else if (this.phase === "return") {
      this.clawX = Math.max(30, this.clawX - 3);
      this.checkGrip();
      if (this.clawX <= 30 && (!this.grip || (this.held?.body.position.x ?? WIDTH) < 72 || this.phaseSteps >= 180)) {
        this.changePhase("release");
      }
    } else if (this.phase === "release") {
      if (this.grip && this.held) this.releasedId = this.held.id;
      this.detach();
      this.closeAmount = Math.max(0, this.closeAmount - 0.1);
      if (this.phaseSteps >= 12) this.changePhase("settle");
    } else if (this.phase === "settle" && this.phaseSteps >= 150) {
      const winner = this.plushes.find(({ id, body }) => id === this.releasedId && body.position.x < 84 && body.position.y > 580);
      this.changePhase(winner ? "won" : "missed");
      this.held = winner ?? null;
    }
    if (!this.isTerminal() && this.stepNumber >= 900) this.changePhase("abandoned");
    this.placeClaw();
    Engine.update(this.engine, STEP_MS);
    return this.phase;
  }

  result(): ClawResult {
    if (this.phase !== "won" && this.phase !== "missed" && this.phase !== "abandoned") {
      throw new Error("Attempt has not finished");
    }
    const outcome = this.phase;
    return {
      outcome,
      capturedPlushId: outcome === "won" ? this.held?.id ?? null : null,
      steps: this.stepNumber,
      finalPlushes: this.plushes.map(({ id, body }) => ({ id,
        x: Number(body.position.x.toFixed(3)), y: Number(body.position.y.toFixed(3)), angle: Number(body.angle.toFixed(4)) })),
    };
  }

  private isTerminal() { return this.phase === "won" || this.phase === "missed" || this.phase === "abandoned"; }
  private changePhase(phase: ClawPhase) { this.phase = phase; this.phaseSteps = 0; }

  private placeClaw() {
    Body.setPosition(this.hub, { x: this.clawX, y: this.clawY });
    const spread = 18 - this.closeAmount * 9;
    const angle = 0.35 + this.closeAmount * 0.34;
    Body.setPosition(this.leftProng, { x: this.clawX - spread, y: this.clawY + 26 });
    Body.setAngle(this.leftProng, -angle);
    Body.setPosition(this.rightProng, { x: this.clawX + spread, y: this.clawY + 26 });
    Body.setAngle(this.rightProng, angle);
  }

  private attachClosest() {
    const gripPoint = { x: this.clawX, y: this.clawY + 30 };
    const candidates = this.plushes.map((plush) => ({ plush,
      distance: Math.hypot(plush.body.position.x - gripPoint.x, plush.body.position.y - gripPoint.y) }))
      .filter(({ plush, distance }) => distance <= plush.radius + 40)
      .sort((left, right) => left.distance - right.distance);
    if (!candidates.length) return;
    this.held = candidates[0].plush;
    this.gripAlignment = Math.max(0, 1 - candidates[0].distance / (this.held.radius + 40)) * this.held.grip;
    this.grip = Constraint.create({ bodyA: this.hub, pointA: { x: 0, y: 25 }, bodyB: this.held.body,
      length: this.held.radius * 0.45, stiffness: 0.92, damping: 0.24, label: "claw-grip" });
    Composite.add(this.engine.world, this.grip);
  }

  private checkGrip() {
    if (!this.grip || !this.held) return;
    const targetX = this.clawX;
    const targetY = this.clawY + 25;
    const tension = Math.max(0, Math.hypot(this.held.body.position.x - targetX, this.held.body.position.y - targetY) - this.held.radius * 0.45);
    const load = this.held.body.mass * (1 + Math.abs(this.held.body.angularVelocity) * 12) + tension * 0.018;
    if (load > this.gripStrength * this.gripAlignment * 100) this.detach();
  }

  private detach() {
    if (this.grip) Composite.remove(this.engine.world, this.grip);
    this.grip = null;
  }
}

export function runClawReplay(seed: number, inputs: ClawInput[], options?: { gripStrength?: number }): ClawResult {
  const game = new ClawPhysics(seed, options);
  const byStep = new Map(inputs.map(({ step, ...input }) => [step, input]));
  let move: -1 | 0 | 1 = 0;
  while (!["won", "missed", "abandoned"].includes(game.phase)) {
    const input = byStep.get(game.stepNumber + 1);
    if (input?.move !== undefined) move = input.move;
    game.step({ move, ...(input?.drop ? { drop: true } : {}) });
  }
  return game.result();
}

export function aimAt(targetX: number): ClawInput[] {
  const direction: -1 | 1 = targetX < CLAW_START_X ? -1 : 1;
  const steps = Math.round(Math.abs(targetX - CLAW_START_X) / 2.5);
  return [{ step: 1, move: direction }, { step: steps + 1, move: 0, drop: true }];
}
