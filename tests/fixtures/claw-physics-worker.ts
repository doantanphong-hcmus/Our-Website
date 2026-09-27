import { aimAt, runClawReplay } from "../../packages/claw-physics/src/index";

export default {
  fetch() {
    const started = performance.now();
    const first = runClawReplay(20260927, aimAt(150));
    const second = runClawReplay(20260927, aimAt(150));
    return Response.json({ deterministic: JSON.stringify(first) === JSON.stringify(second),
      outcome: first.outcome, replayMilliseconds: Number(((performance.now() - started) / 2).toFixed(2)) });
  },
};
