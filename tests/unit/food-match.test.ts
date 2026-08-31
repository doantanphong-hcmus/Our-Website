import { describe, expect, it } from "vitest";
import { matchFromPool } from "../../apps/worker/src/sessions";

describe("food match", () => {
  it("uses canonical pool order and retains every other mutual choice", () => {
    expect(matchFromPool(["first", "second", "third"], ["third", "first", "second"]))
      .toEqual({ dishId: "first", alternatives: ["second", "third"] });
    expect(matchFromPool(["first"], [])).toBeNull();
  });
});
