import { describe, expect, it } from "vitest";
import { DeepTalkShuffleError, shuffleDeepTalkDeck } from "../../apps/worker/src/deep-talk-shuffle";
import type { DeepTalkDeck } from "../../apps/worker/src/deep-talk-validator";
import safeDeck from "../../content/deep-talk-fallback.v1.json";

const questions = (deck: DeepTalkDeck) => deck.cards.map(({ question }) => question);

describe("Deep Talk controlled shuffle", () => {
  it("is reproducible by seed and changes across seeds", () => {
    expect(shuffleDeepTalkDeck(safeDeck, 42)).toEqual(shuffleDeepTalkDeck(safeDeck, 42));
    expect(questions(shuffleDeepTalkDeck(safeDeck, 42))).not.toEqual(questions(shuffleDeepTalkDeck(safeDeck, 43)));
  });

  it("preserves every card and rhythm invariants across 200 seeds", () => {
    const original = [...questions(safeDeck)].sort();
    for (let seed = 0; seed < 200; seed++) {
      const cards = shuffleDeepTalkDeck(safeDeck, seed).cards;
      expect([...cards.map(({ question }) => question)].sort()).toEqual(original);
      expect(cards.slice(0, 3).every(({ severity }) => severity === "light")).toBe(true);
      expect(cards.slice(0, 6).every(({ severity }) => severity !== "heavy")).toBe(true);
      expect(cards.slice(-2).every(({ positive, severity }) => positive && severity !== "heavy")).toBe(true);
      for (let index = 1; index < cards.length; index++) {
        expect(cards[index - 1].severity === "heavy" && cards[index].severity === "heavy").toBe(false);
      }
      for (let index = 3; index < cards.length; index++) {
        expect(cards.slice(index - 3, index + 1).every(({ form }) => form === cards[index].form)).toBe(false);
      }
      for (let index = 2; index < cards.length; index++) {
        expect(cards.slice(index - 2, index + 1).every(({ group }) => group === cards[index].group)).toBe(false);
      }
    }
  });

  it("rejects an invalid seed or deck without a positive ending", () => {
    expect(() => shuffleDeepTalkDeck(safeDeck, -1)).toThrow(DeepTalkShuffleError);
    const noEnding = structuredClone(safeDeck);
    noEnding.cards.forEach((card) => { card.positive = false; });
    expect(() => shuffleDeepTalkDeck(noEnding, 1)).toThrow(DeepTalkShuffleError);
  });
});
