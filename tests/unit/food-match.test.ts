import { describe, expect, it } from "vitest";
import { matchFromPool, proxyCandidates } from "../../apps/worker/src/sessions";

describe("food match", () => {
  it("uses canonical pool order and retains every other mutual choice", () => {
    expect(matchFromPool(["first", "second", "third"], ["third", "first", "second"]))
      .toEqual({ dishId: "first", alternatives: ["second", "third"] });
    expect(matchFromPool(["first"], [])).toBeNull();
  });

  it("keeps union wants except anything either user rejected", () => {
    const votes = [
      { dishId: "safe", decision: "want" as const },
      { dishId: "vetoed", decision: "want" as const },
      { dishId: "vetoed", decision: "no" as const },
      { dishId: "ignored", decision: "skip" as const },
    ];
    expect(proxyCandidates(["safe", "vetoed", "ignored", "outside"], votes)).toEqual(["safe"]);
    expect(proxyCandidates(["ignored"], [{ dishId: "ignored", decision: "skip" }])).toEqual([]);
  });
});
