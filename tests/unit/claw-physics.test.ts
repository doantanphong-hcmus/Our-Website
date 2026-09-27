import { describe, expect, it } from "vitest";
import { aimAt, runClawReplay } from "../../packages/claw-physics/src/index";

describe("claw physics spike", () => {
  it("replays the same fixed-step attempt deterministically", () => {
    const controls = aimAt(148);
    expect(runClawReplay(20260927, controls)).toEqual(runClawReplay(20260927, controls));
  });

  it("uses aim, mass and grip instead of a random victory roll", () => {
    const targets = Array.from({ length: 24 }, (_, index) => 112 + index * 10);
    const results = targets.map((target) => runClawReplay(20260927, aimAt(target)));
    expect(results.some(({ outcome }) => outcome === "won")).toBe(true);
    expect(results.some(({ outcome }) => outcome === "missed")).toBe(true);
    const winningTarget = targets[results.findIndex(({ outcome }) => outcome === "won")];
    expect(runClawReplay(20260927, aimAt(winningTarget), { gripStrength: 0.15 }).outcome).toBe("missed");
  });

  it("keeps the headless replay cheap enough for a Worker spike", () => {
    const started = performance.now();
    for (let index = 0; index < 20; index++) runClawReplay(index + 1, aimAt(150 + index * 5));
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(2_500);
  });
});
