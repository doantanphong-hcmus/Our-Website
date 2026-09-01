import deepTalkSpec from "../../../content/deep-talk.v1.json";
import { validateDeepTalkDeck, type DeepTalkDeck } from "./deep-talk-validator";

export const deepTalkModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface DeepTalkAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export type DeepTalkAiInput = {
  level: "gentle" | "understand" | "deep" | "mixed";
  allowedSensitiveTopics: string[];
  seed: number;
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
const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: { type: "array", minItems: deepTalkSpec.deck.cardCount, maxItems: deepTalkSpec.deck.cardCount, items: deepTalkSpec.cardSchema },
  },
  required: ["cards"],
};

function prompt(input: DeepTalkAiInput): string {
  const allowed = input.allowedSensitiveTopics.map((id) => sensitiveLabels.get(id));
  const blocked = deepTalkSpec.sensitiveTopics.filter(({ id }) => !input.allowedSensitiveTopics.includes(id)).map(({ label }) => label);
  return `Tạo đúng 20 lá Deep Talk bằng tiếng Việt tự nhiên cho một cặp đôi, mức độ ${levels[input.level]}.
Mỗi nhóm mo_long, ky_uc, thau_hieu, chan_that, tuong_lai có đúng 4 lá. Dùng đa dạng form trong schema.
Chủ đề nhạy cảm được phép: ${allowed.length ? allowed.join(", ") : "không có"}.
Tuyệt đối không dùng chủ đề: ${blocked.join(", ")}.
Mỗi lá phải khai báo đúng group, form, sensitivityTopics, severity, positive và question. Chỉ gắn sensitivityTopics đã được phép.
Câu hỏi không phán xét, chẩn đoán, trị liệu, ép trả lời, ép chứng minh tình yêu, khơi ghen, quảng cáo hay yêu cầu bí mật nguy hiểm.
Hai lá cuối phải positive=true và hướng tới biết ơn hoặc hành động tích cực. Chỉ trả về JSON đúng schema.`;
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

export async function generateDeepTalkDeck(ai: DeepTalkAiBinding, input: DeepTalkAiInput, timeoutMs = 30_000): Promise<DeepTalkDeck> {
  if (!Object.hasOwn(levels, input.level) || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff
    || new Set(input.allowedSensitiveTopics).size !== input.allowedSensitiveTopics.length
    || input.allowedSensitiveTopics.some((id) => !sensitiveLabels.has(id))
    || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new DeepTalkAiError("invalid_input", "Tham số tạo bộ Deep Talk không hợp lệ.");
  }
  const request = {
    messages: [
      { role: "system", content: "Tuân thủ chính xác JSON schema và chính sách an toàn. Không thêm giải thích." },
      { role: "user", content: prompt(input) },
    ],
    response_format: { type: "json_schema", json_schema: responseSchema },
    max_tokens: 8192,
    seed: input.seed,
  };
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1) break;
    try {
      return validateDeepTalkDeck(parse(await withTimeout(ai.run(deepTalkModel, request), remaining)), input.allowedSensitiveTopics);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof DeepTalkAiError) throw lastError;
  throw new DeepTalkAiError("provider", lastError instanceof Error ? lastError.message : "Workers AI không phản hồi.");
}
