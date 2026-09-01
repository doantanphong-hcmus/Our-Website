import { describe, expect, it } from "vitest";
import { getDeepTalkFallback } from "../../apps/worker/src/deep-talk-fallback";

describe("Deep Talk fallback", () => {
  it("returns a deterministic, safe and shuffled 20-card deck", () => {
    const first = getDeepTalkFallback(42);
    expect(first).toEqual(getDeepTalkFallback(42));
    expect(first.cards).toHaveLength(20);
    expect(first.cards.every(({ sensitivityTopics }) => sensitivityTopics.length === 0)).toBe(true);
    expect(first.cards.slice(0, 3).every(({ severity }) => severity === "light")).toBe(true);
    expect(first.cards.slice(-2).every(({ positive }) => positive)).toBe(true);
  });
});
