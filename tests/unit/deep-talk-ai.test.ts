import { describe, expect, it, vi } from "vitest";
import { DeepTalkAiError, deepTalkModel, generateDeepTalkDeck } from "../../apps/worker/src/deep-talk-ai";
import safeDeck from "../../content/deep-talk-fallback.v1.json";

describe("Deep Talk AI adapter", () => {
  it("requests structured output without forwarding private fields", async () => {
    const questions = safeDeck.cards.map(({ question }) => question);
    const ai = { run: vi.fn().mockResolvedValue({ response: `\`\`\`json\n${JSON.stringify({ questions })}\n\`\`\`` }) };
    const result = await generateDeepTalkDeck(ai, {
      level: "deep", allowedSensitiveTopics: ["gia_dinh"], seed: 42,
      username: "phong", answers: ["private answer"],
    } as never);
    expect(result.cards.map(({ question }) => question)).toEqual(questions);
    expect(new Set(result.cards.map(({ form }) => form)).size).toBe(10);
    expect(ai.run).toHaveBeenCalledTimes(1);
    const [model, request] = ai.run.mock.calls[0];
    expect(model).toBe(deepTalkModel);
    expect(request.seed).toBe(42);
    expect(request.response_format.type).toBe("json_schema");
    expect(request.response_format.json_schema.properties.questions).toMatchObject({ minItems: 20, maxItems: 20 });
    expect(JSON.stringify(request.response_format)).not.toContain("uniqueItems");
    const sent = JSON.stringify(request);
    expect(sent).toContain("Gia đình");
    expect(sent).toContain("Người yêu cũ");
    expect(sent).toContain("mo_long, mo_long, mo_long, mo_long, ky_uc");
    expect(sent).toContain("mo_long=dễ trả lời về hiện tại");
    expect(sent).toContain("Luân phiên phong cách");
    expect(sent).not.toContain('"username":"phong"');
    expect(sent).not.toContain("private answer");
  });

  it("retries one provider failure with the same seed", async () => {
    const questions = safeDeck.cards.map(({ question }) => question);
    const ai = { run: vi.fn()
      .mockRejectedValueOnce(new Error("temporary quota edge"))
      .mockResolvedValueOnce({ response: { questions } }) };
    await expect(generateDeepTalkDeck(ai, { level: "gentle", allowedSensitiveTopics: [], seed: 7 })).resolves.toMatchObject({ cards: expect.any(Array) });
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(ai.run.mock.calls.map(([, request]) => request.seed)).toEqual([7, 7]);
  });

  it("enforces one total timeout", async () => {
    const ai = { run: vi.fn(() => new Promise(() => {})) };
    await expect(generateDeepTalkDeck(ai, { level: "mixed", allowedSensitiveTopics: [], seed: 1 }, 5))
      .rejects.toMatchObject<Partial<DeepTalkAiError>>({ code: "timeout" });
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown consent topics before calling AI", async () => {
    const ai = { run: vi.fn() };
    await expect(generateDeepTalkDeck(ai, { level: "gentle", allowedSensitiveTopics: ["not-approved"], seed: 1 }))
      .rejects.toMatchObject<Partial<DeepTalkAiError>>({ code: "invalid_input" });
    expect(ai.run).not.toHaveBeenCalled();
  });
});
