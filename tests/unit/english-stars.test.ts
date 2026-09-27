import { describe, expect, it } from "vitest";
import catalog from "../../content/english-stars.v1.json";

describe("E1.1 English star rules", () => {
  it("keeps the customer-approved earning and reward table exact", () => {
    expect(catalog.approval.status).toBe("approved");
    expect(catalog.currency).toEqual({ id: "star", label: "Ngôi sao", symbol: "⭐" });
    expect(catalog.activities.map((item) => "points" in item ? item.points : [item.minimumPoints, item.maximumPoints]))
      .toEqual([10, 5, 10, 20, 25, 35, 50, [1, 100]]);
    expect(catalog.rewards.map((item) => item.cost)).toEqual([30, 35, 80, 100, 150, 230, 1200]);
  });

  it("uses unique stable IDs and positive values", () => {
    const ids = [...catalog.activities, ...catalog.rewards].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(catalog.rewards.every((item) => Number.isInteger(item.cost) && item.cost > 0)).toBe(true);
  });
});
