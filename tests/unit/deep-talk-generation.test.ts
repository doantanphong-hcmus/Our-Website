import { describe, expect, it, vi } from "vitest";
import { DeepTalkGenerationError, buildDeepTalkDeck } from "../../apps/worker/src/deep-talk-generation";
import type { DeepTalkCard } from "../../apps/worker/src/deep-talk-validator";
import safeDeck from "../../content/deep-talk-fallback.v1.json";

const replacement: DeepTalkCard = {
  ...safeDeck.cards[0],
  question: "Phẩm chất đáng quý nào của người kia làm bạn trân trọng nhất?",
};

describe("Deep Talk generation pipeline", () => {
  it("keeps novel cards and requests only the missing supplement", async () => {
    const ai = { run: vi.fn()
      .mockResolvedValueOnce({ response: safeDeck })
      .mockResolvedValueOnce({ response: { cards: [replacement] } }) };
    const result = await buildDeepTalkDeck(ai, {
      level: "understand", allowedSensitiveTopics: [], seed: 42,
    }, null, [{ cards: [safeDeck.cards[0]] }]);
    expect(result.cards).toHaveLength(20);
    expect(result.cards.map(({ question }) => question)).toContain(replacement.question);
    expect(ai.run).toHaveBeenCalledTimes(2);
    const supplementRequest = ai.run.mock.calls[1][1];
    expect(supplementRequest.response_format.json_schema.properties.cards).toMatchObject({ minItems: 1, maxItems: 1 });
    expect(supplementRequest.messages[1].content).toContain("đúng 1 lá bổ sung");
  });

  it("stops after two supplement rounds when every result repeats", async () => {
    const ai = { run: vi.fn().mockResolvedValue({ response: safeDeck }) };
    await expect(buildDeepTalkDeck(ai, {
      level: "gentle", allowedSensitiveTopics: [], seed: 7,
    }, null, [safeDeck])).rejects.toBeInstanceOf(DeepTalkGenerationError);
    expect(ai.run).toHaveBeenCalledTimes(3);
  });

  it("shares one deadline across the initial deck and supplements", async () => {
    vi.useFakeTimers();
    try {
      const ai = { run: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ response: safeDeck }), 6)))
        .mockImplementationOnce(() => new Promise(() => {})) };
      const result = buildDeepTalkDeck(ai, {
        level: "understand", allowedSensitiveTopics: [], seed: 42,
      }, null, [{ cards: [safeDeck.cards[0]] }], 10);
      const timedOut = expect(result).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      expect(ai.run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
