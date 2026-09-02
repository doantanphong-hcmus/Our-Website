import { describe, expect, it, vi } from "vitest";
import { DeepTalkAiError, deepTalkModel, generateDeepTalkDeck } from "../../apps/worker/src/deep-talk-ai";
import safeDeck from "../../content/deep-talk-fallback.v1.json";

describe("Deep Talk AI adapter", () => {
  it("requests structured output without forwarding private fields", async () => {
    const questions = safeDeck.cards.map(({ question }) => question);
    const perspectives = { self: questions.slice(0, 8), partner: questions.slice(8, 14), couple: questions.slice(14) };
    const ai = { run: vi.fn().mockResolvedValue({ response: `\`\`\`json\n${JSON.stringify(perspectives)}\n\`\`\`` }) };
    const result = await generateDeepTalkDeck(ai, {
      level: "deep", allowedSensitiveTopics: ["gia_dinh"], seed: 42,
      username: "phong", answers: ["private answer"],
    } as never);
    expect(result.cards.map(({ question }) => question)).toEqual(questions);
    expect(new Set(result.cards.map(({ form }) => form)).size).toBe(10);
    expect(result.cards.slice(14).some(({ group }) => group === "ky_uc")).toBe(false);
    expect(ai.run).toHaveBeenCalledTimes(1);
    const [model, request] = ai.run.mock.calls[0];
    expect(model).toBe(deepTalkModel);
    expect(request.seed).toBe(42);
    expect(request.response_format.type).toBe("json_schema");
    expect(request.response_format.json_schema.properties.self).toMatchObject({ minItems: 8, maxItems: 8 });
    expect(request.response_format.json_schema.properties.partner).toMatchObject({ minItems: 6, maxItems: 6 });
    expect(request.response_format.json_schema.properties.couple).toMatchObject({ minItems: 6, maxItems: 6 });
    expect(JSON.stringify(request.response_format)).not.toContain("uniqueItems");
    const sent = JSON.stringify(request);
    expect(sent).toContain("Gia đình");
    expect(sent).toContain("Người yêu cũ");
    expect(sent).toContain("couple=[mo_long, thau_hieu, chan_that, tuong_lai, tuong_lai, tuong_lai]");
    expect(sent).toContain("mo_long=dễ trả lời về hiện tại");
    expect(sent).toContain("Luân phiên phong cách");
    expect(sent).toContain("self=8, partner=6, couple=6");
    expect(sent).toContain("couple chỉ hỏi tương tác hiện tại");
    expect(sent).toContain("tuyệt đối không hỏi kỷ niệm");
    expect(sent).not.toContain('"username":"phong"');
    expect(sent).not.toContain("private answer");
  });

  it("retries one provider failure with the same seed", async () => {
    const questions = safeDeck.cards.map(({ question }) => question);
    const perspectives = { self: questions.slice(0, 8), partner: questions.slice(8, 14), couple: questions.slice(14) };
    const ai = { run: vi.fn()
      .mockRejectedValueOnce(new Error("temporary quota edge"))
      .mockResolvedValueOnce({ response: perspectives }) };
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
