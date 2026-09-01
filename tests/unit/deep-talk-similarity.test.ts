import { describe, expect, it } from "vitest";
import { fingerprintDeepTalkQuestion, removeRepeatedDeepTalkCards } from "../../apps/worker/src/deep-talk-similarity";
import type { DeepTalkCard, DeepTalkDeck } from "../../apps/worker/src/deep-talk-validator";
import safeDeck from "../../content/deep-talk-fallback.v1.json";

const card = (question: string, overrides: Partial<DeepTalkCard> = {}): DeepTalkCard => ({
  ...safeDeck.cards[0], question, ...overrides,
});
const deck = (...cards: DeepTalkCard[]): DeepTalkDeck => ({ cards });

describe("Deep Talk similarity", () => {
  it("creates a stable Vietnamese fingerprint", () => {
    expect(fingerprintDeepTalkQuestion("  Điều Đáng Nhớ?! ")).toBe("dieu dang nho");
  });

  it("removes exact, obvious paraphrase and in-deck repeats", () => {
    const exact = card("Điều đáng nhớ nào khiến bạn vui gần đây?");
    const paraphrase = card("Gần đây, điều nhỏ bé nào người kia làm khiến bạn mỉm cười?");
    const fresh = card("Nếu được chọn một nơi mới, hai bạn muốn cùng khám phá nơi nào?");
    const result = removeRepeatedDeepTalkCards(
      deck(exact, paraphrase, fresh, { ...fresh }),
      deck(card("Điều đáng nhớ nào khiến bạn vui gần đây!"), safeDeck.cards[0]),
    );
    expect(result.cards).toEqual([fresh]);
    expect(result.rejected.map(({ reason }) => reason)).toEqual(["exact", "similar", "exact"]);
  });

  it("compares only the current and five most recent decks", () => {
    const target = card("Bạn muốn cùng nhau tạo kỷ niệm mới nào vào cuối tuần?");
    const empty = deck();
    expect(removeRepeatedDeepTalkCards(deck(target), null, [empty, empty, empty, empty, deck(target)]).rejected).toHaveLength(1);
    expect(removeRepeatedDeepTalkCards(deck(target), null, [empty, empty, empty, empty, empty, deck(target)]).cards).toEqual([target]);
  });
});
