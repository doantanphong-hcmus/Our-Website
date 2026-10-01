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
    expect(snapshot.claw).toEqual({ x: 180, y: 70, z: 90, velocityX: 0, velocityZ: 0, close: 0 });
    expect(snapshot.plushes).toHaveLength(18);
    expect(new Set(snapshot.plushes.map(({ id }) => id)).size).toBe(6);
    expect(snapshot.plushes.every(({ z }) => Number.isFinite(z))).toBe(true);
  });

  it("uses aim, mass and grip instead of a random victory roll", () => {
    const targets = Array.from({ length: 24 }, (_, index) => 112 + index * 10);
    const results = targets.map((target) => runClawReplay(20260927, aimAt(target)));
    expect(results.some(({ outcome }) => outcome === "won")).toBe(true);
    expect(results.some(({ outcome }) => outcome === "missed")).toBe(true);
    const winningTarget = targets[results.findIndex(({ outcome }) => outcome === "won")];
    expect(runClawReplay(20260927, aimAt(winningTarget), { gripStrength: 0.15 }).outcome).toBe("missed");
  });

  it("lets precise four-prong aim lift large plushes without guaranteeing them", () => {
    const game = new ClawPhysics(20260927);
    const largeTargets = game.snapshot().plushes.filter(({ id }) => id === "capybara" || id === "dinosaur");
    const results = largeTargets.map(({ x, z }) => runClawReplay(20260927, aimAt(x, z)));
    expect(new Set(results.map(({ capturedPlushId }) => capturedPlushId))).toEqual(new Set([null, "capybara", "dinosaur"]));
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
      expect(result.finalPlushes).toHaveLength(18);
      expect(new Set(result.finalPlushes.map(({ id }) => id)).size).toBe(6);
      expect(result.finalPlushes.every(({ x, y, z, angle }) => [x, y, z, angle].every(Number.isFinite))).toBe(true);
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

  it("keeps moving briefly after the joystick returns to center", () => {
    const game = new ClawPhysics(7);
    for (let step = 0; step < 12; step++) game.step({ moveX: 1, moveZ: -1 });
    const released = game.snapshot().claw;
    game.step({ moveX: 0, moveZ: 0 });
    const coasting = game.snapshot().claw;
    expect(coasting.x).toBeGreaterThan(released.x);
    expect(coasting.z).toBeLessThan(released.z);
    expect(Math.abs(coasting.velocityX)).toBeLessThan(Math.abs(released.velocityX));
  });

  it("keeps a dense headless replay under 175ms per round", () => {
    const started = performance.now();
    for (let index = 0; index < 20; index++) runClawReplay(index + 1, aimAt(150 + index * 5));
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(3_500);
  });
});
