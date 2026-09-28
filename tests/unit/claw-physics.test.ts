import { describe, expect, it } from "vitest";
import { aimAt, ClawPhysics, runClawReplay } from "../../packages/claw-physics/src/index";

describe("claw physics spike", () => {
  it("replays the same fixed-step attempt deterministically", () => {
    const controls = aimAt(148);
    expect(runClawReplay(20260927, controls)).toEqual(runClawReplay(20260927, controls));
  });

  it("exposes a render snapshot without leaking engine internals", () => {
    const game = new ClawPhysics(42);
    const snapshot = game.snapshot();
    expect(snapshot.claw).toEqual({ x: 180, y: 70, close: 0 });
    expect(snapshot.plushes).toHaveLength(6);
  });

  it("uses aim, mass and grip instead of a random victory roll", () => {
    const targets = Array.from({ length: 24 }, (_, index) => 112 + index * 10);
    const results = targets.map((target) => runClawReplay(20260927, aimAt(target)));
    expect(results.some(({ outcome }) => outcome === "won")).toBe(true);
    expect(results.some(({ outcome }) => outcome === "missed")).toBe(true);
    const winningTarget = targets[results.findIndex(({ outcome }) => outcome === "won")];
    expect(runClawReplay(20260927, aimAt(winningTarget), { gripStrength: 0.15 }).outcome).toBe("missed");
  });

  it("keeps terminal and geometry invariants across 20 deterministic rounds", () => {
    for (let index = 0; index < 20; index++) {
      const seed = 9000 + index;
      const controls = aimAt(112 + (index * 37) % 228);
      const result = runClawReplay(seed, controls);
      expect(result).toEqual(runClawReplay(seed, controls));
      expect(["won", "missed"]).toContain(result.outcome);
      expect(result.steps).toBeLessThanOrEqual(900);
      expect(result.capturedPlushId === null).toBe(result.outcome !== "won");
      expect(new Set(result.finalPlushes.map(({ id }) => id)).size).toBe(6);
      expect(result.finalPlushes.every(({ x, y, angle }) => [x, y, angle].every(Number.isFinite))).toBe(true);
    }
  });

  it("clamps aim and abandons an attempt that never drops", () => {
    const game = new ClawPhysics(7);
    for (let step = 0; step < 100; step++) game.step({ move: -1 });
    expect(game.snapshot().claw.x).toBe(112);
    for (let step = 0; step < 200; step++) game.step({ move: 1 });
    expect(game.snapshot().claw.x).toBe(340);
    while (game.phase !== "abandoned") game.step();
    expect(game.result()).toMatchObject({ outcome: "abandoned", capturedPlushId: null, steps: 900 });
  });

  it("keeps the headless replay cheap enough for a Worker spike", () => {
    const started = performance.now();
    for (let index = 0; index < 20; index++) runClawReplay(index + 1, aimAt(150 + index * 5));
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(2_500);
  });
});
