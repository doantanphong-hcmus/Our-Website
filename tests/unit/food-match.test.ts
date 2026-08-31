import { describe, expect, it } from "vitest";
import foodCatalog from "../../content/food.v1.json";
import { foodCandidates, matchFromPool, proxyCandidates } from "../../apps/worker/src/sessions";

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
    expect(proxyCandidates(["one", "two"], [
      { dishId: "one", decision: "want" }, { dishId: "one", decision: "no" },
      { dishId: "two", decision: "want" }, { dishId: "two", decision: "no" },
    ])).toEqual([]);
  });

  it("never offers a proxy outside the selected style or safety filters", () => {
    for (const foodStyle of foodCatalog.foodStyles.map(({ id }) => id)) {
      for (const category of ["any", ...foodCatalog.categories.map(({ id }) => id)]) {
        for (const allergen of [null, ...foodCatalog.allergens.map(({ id }) => id)]) {
          for (const exclusion of [null, ...foodCatalog.exclusions.map(({ id }) => id)]) {
            const conditions = {
              foodStyle, category,
              allergens: allergen ? [allergen] : [],
              exclusions: exclusion ? [exclusion] : [],
            };
            const pool = foodCandidates(conditions);
            const proxy = proxyCandidates(pool.map(({ id }) => id), pool.map(({ id }) => ({ dishId: id, decision: "want" as const })));
            for (const id of proxy) {
              const dish = foodCatalog.dishes.find((item) => item.id === id)!;
              expect(dish.foodStyle).toBe(foodStyle);
              if (category !== "any") expect(dish.categories).toContain(category);
              expect(dish.possibleAllergens).not.toContain(allergen);
              expect(dish.exclusionTags).not.toContain(exclusion);
            }
          }
        }
      }
    }
  });
});
