import deepTalkSpec from "../../../content/deep-talk.v1.json";
import { DeepTalkValidationError, validateDeepTalkDeck, type DeepTalkCard, type DeepTalkDeck } from "./deep-talk-validator";

export const deepTalkModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface DeepTalkAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export type DeepTalkAiInput = {
  level: "gentle" | "understand" | "deep" | "mixed";
  allowedSensitiveTopics: string[];
  seed: number;
  avoidQuestions?: string[];
};

export class DeepTalkAiError extends Error {
  constructor(public readonly code: "invalid_input" | "timeout" | "provider" | "malformed_output", message: string) {
    super(message);
  }
}

const levels = {
  gentle: "nhẹ nhàng", understand: "muốn hiểu nhau hơn", deep: "thành thật sâu sắc", mixed: "trộn cân bằng các mức độ",
};
const sensitiveLabels = new Map(deepTalkSpec.sensitiveTopics.map((topic) => [topic.id, topic.label]));
const responseSchema = (cardCount: number) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    cards: { type: "array", minItems: cardCount, maxItems: cardCount, items: deepTalkSpec.cardSchema },
  },
  required: ["cards"],
});

function prompt(input: DeepTalkAiInput, missingGroups?: Record<string, number>, positiveNeeded = 0): string {
  const allowed = input.allowedSensitiveTopics.map((id) => sensitiveLabels.get(id));
  const blocked = deepTalkSpec.sensitiveTopics.filter(({ id }) => !input.allowedSensitiveTopics.includes(id)).map(({ label }) => label);
  const count = missingGroups ? Object.values(missingGroups).reduce((sum, value) => sum + value, 0) : deepTalkSpec.deck.cardCount;
  const task = missingGroups
    ? `Tạo đúng ${count} lá bổ sung. Số lá còn thiếu theo nhóm: ${Object.entries(missingGroups).map(([id, value]) => `${id}=${value}`).join(", ")}. Ít nhất ${positiveNeeded} lá bổ sung phải positive=true và severity khác heavy.`
    : "Tạo đúng 20 lá; mỗi nhóm mo_long, ky_uc, thau_hieu, chan_that, tuong_lai có đúng 4 lá.";
  return `${task} Viết bằng tiếng Việt tự nhiên cho một cặp đôi, mức độ ${levels[input.level]}. Dùng đa dạng form trong schema.
Chủ đề nhạy cảm được phép: ${allowed.length ? allowed.join(", ") : "không có"}.
Tuyệt đối không dùng chủ đề: ${blocked.join(", ")}.
Mỗi lá phải khai báo đúng group, form, sensitivityTopics, severity, positive và question. Chỉ gắn sensitivityTopics đã được phép.
Câu hỏi không phán xét, chẩn đoán, trị liệu, ép trả lời, ép chứng minh tình yêu, khơi ghen, quảng cáo hay yêu cầu bí mật nguy hiểm.
Không lặp hoặc chỉ đổi vài từ từ các câu cần tránh: ${input.avoidQuestions?.length ? input.avoidQuestions.join(" | ") : "không có"}.
${missingGroups ? "" : "Hai lá cuối phải positive=true và hướng tới biết ơn hoặc hành động tích cực."} Chỉ trả về JSON đúng schema.`;
}

function parse(output: unknown): unknown {
  const response = output && typeof output === "object" && "response" in output
    ? (output as { response?: unknown }).response : output;
  if (response && typeof response === "object") return response;
  if (typeof response !== "string") throw new DeepTalkAiError("malformed_output", "Workers AI không trả về nội dung JSON.");
  try {
    const unwrapped = response.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? response;
    const parsed: unknown = JSON.parse(unwrapped);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new DeepTalkAiError("malformed_output", "Workers AI trả về JSON không hợp lệ.");
  }
}

function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeepTalkAiError("timeout", "Workers AI quá thời gian phản hồi.")), milliseconds);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

function validInput(input: DeepTalkAiInput, timeoutMs: number): boolean {
  return Object.hasOwn(levels, input.level) && Number.isInteger(input.seed) && input.seed >= 0 && input.seed <= 0xffffffff
    && new Set(input.allowedSensitiveTopics).size === input.allowedSensitiveTopics.length
    && input.allowedSensitiveTopics.every((id) => sensitiveLabels.has(id))
    && (!input.avoidQuestions || (input.avoidQuestions.length <= 140
      && input.avoidQuestions.every((question) => typeof question === "string" && [...question].length <= deepTalkSpec.questionLength.max)))
    && Number.isFinite(timeoutMs) && timeoutMs >= 1;
}

async function generate<T>(ai: DeepTalkAiBinding, input: DeepTalkAiInput, schema: object, userPrompt: string,
  accept: (output: unknown) => T, timeoutMs: number): Promise<T> {
  if (!validInput(input, timeoutMs)) throw new DeepTalkAiError("invalid_input", "Tham số tạo bộ Deep Talk không hợp lệ.");
  const request = {
    messages: [
      { role: "system", content: "Tuân thủ chính xác JSON schema và chính sách an toàn. Không thêm giải thích." },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_schema", json_schema: schema },
    max_tokens: 8192,
    seed: input.seed,
  };
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1) break;
    try {
      return accept(parse(await withTimeout(ai.run(deepTalkModel, request), remaining)));
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof DeepTalkAiError) throw lastError;
  throw new DeepTalkAiError("provider", lastError instanceof Error ? lastError.message : "Workers AI không phản hồi.");
}

export async function generateDeepTalkDeck(ai: DeepTalkAiBinding, input: DeepTalkAiInput, timeoutMs = 30_000): Promise<DeepTalkDeck> {
  return generate(ai, input, responseSchema(deepTalkSpec.deck.cardCount), prompt(input),
    (output) => validateDeepTalkDeck(output, input.allowedSensitiveTopics), timeoutMs);
}

export async function generateDeepTalkSupplement(ai: DeepTalkAiBinding, input: DeepTalkAiInput,
  acceptedCards: DeepTalkCard[], timeoutMs = 30_000): Promise<DeepTalkCard[]> {
  const missingGroups = Object.fromEntries(deepTalkSpec.groups.map(({ id }) =>
    [id, deepTalkSpec.deck.cardsPerGroup - acceptedCards.filter((card) => card.group === id).length]));
  const missing = Object.values(missingGroups).reduce((sum, value) => sum + value, 0);
  if (missing < 0 || missing > deepTalkSpec.deck.cardCount || Object.values(missingGroups).some((count) => count < 0)) {
    throw new DeepTalkAiError("invalid_input", "Danh sách lá đã giữ không hợp lệ.");
  }
  if (!missing) return [];
  const positiveNeeded = Math.max(0, deepTalkSpec.deck.positiveEndingCards
    - acceptedCards.filter((card) => card.positive && card.severity !== "heavy").length);
  return generate(ai, input, responseSchema(missing), prompt(input, missingGroups, positiveNeeded), (output) => {
    if (!output || typeof output !== "object" || Array.isArray(output) || !("cards" in output) || !Array.isArray(output.cards)
      || output.cards.length !== missing) throw new DeepTalkValidationError([`Cần đúng ${missing} lá bổ sung`]);
    const combined = validateDeepTalkDeck({ cards: [...acceptedCards, ...output.cards] }, input.allowedSensitiveTopics);
    return combined.cards.slice(acceptedCards.length);
  }, timeoutMs);
}
