import { describe, expect, it } from "vitest";
import { DeepTalkValidationError, validateDeepTalkDeck } from "../../apps/worker/src/deep-talk-validator";
import safeDeck from "../fixtures/deep-talk-safe-deck.json";

const changed = (change: (deck: any) => void) => {
  const deck = structuredClone(safeDeck);
  change(deck);
  return deck;
};

describe("Deep Talk deck validator", () => {
  it("accepts the reviewed 20-card Vietnamese deck", () => {
    expect(validateDeepTalkDeck(safeDeck)).toEqual(safeDeck);
  });

  it.each([
    ["exact count", changed((deck) => deck.cards.pop()), "Cần đúng 20 lá"],
    ["four per group", changed((deck) => { deck.cards[0].group = "ky_uc"; }), "Group mo_long cần 4 lá"],
    ["Vietnamese", changed((deck) => { deck.cards[0].question = "This question is written only in English"; }), "không nhận diện được là tiếng Việt"],
    ["length", changed((deck) => { deck.cards[0].question = "Bạn thấy gì?"; }), "độ dài question không hợp lệ"],
    ["forbidden pattern", changed((deck) => { deck.cards[0].question = "Bạn phải trả lời câu hỏi này ngay bây giờ."; }), "khớp mẫu cấm coercion"],
    ["blocked topic text", changed((deck) => { deck.cards[0].question = "Bạn nghĩ gì khi nhắc đến người yêu cũ?"; }), "chủ đề chưa được đồng thuận nguoi_yeu_cu"],
    ["blocked topic metadata", changed((deck) => { deck.cards[4].sensitivityTopics = ["gia_dinh"]; }), "chứa chủ đề chưa được đồng thuận"],
    ["form diversity", changed((deck) => deck.cards.forEach((card: any) => { card.form = "ke_chuyen"; })), "Cần ít nhất 5 form"],
    ["group severity", changed((deck) => { deck.cards[0].severity = "heavy"; }), "severity không phù hợp group"],
    ["strict fields", changed((deck) => { deck.cards[0].extra = true; }), "sai cấu trúc trường"],
  ])("rejects invalid %s", (_name, deck, issue) => {
    expect(() => validateDeepTalkDeck(deck)).toThrow(DeepTalkValidationError);
    expect(() => validateDeepTalkDeck(deck)).toThrow(issue as string);
  });
});
