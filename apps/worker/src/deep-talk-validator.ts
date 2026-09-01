import deepTalkSpec from "../../../content/deep-talk.v1.json";

export type DeepTalkCard = {
  group: string;
  form: string;
  sensitivityTopics: string[];
  severity: string;
  positive: boolean;
  question: string;
};

export type DeepTalkDeck = { cards: DeepTalkCard[] };

export class DeepTalkValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Bộ Deep Talk không hợp lệ: ${issues.join("; ")}`);
  }
}

const requiredKeys = [...deepTalkSpec.cardSchema.required].sort();
const groupById = new Map(deepTalkSpec.groups.map((group) => [group.id, group]));
const formIds = new Set(deepTalkSpec.forms.map(({ id }) => id));
const severityIds = new Set(deepTalkSpec.severities.map(({ id }) => id));
const sensitiveById = new Map(deepTalkSpec.sensitiveTopics.map((topic) => [topic.id, topic]));
const forbidden = deepTalkSpec.forbiddenPatterns.flatMap((rule) =>
  rule.patterns.map((pattern) => [rule.id, new RegExp(pattern, "iu")] as const));
const vietnameseWord = /(?:^|\s)(?:bạn|mình|hai|người|điều|khi|nào|gì|một|cùng|được|muốn|cảm|thấy|hãy|nếu)(?=\s|[,.?!:]|$)/iu;

const normalized = (value: string) => value.normalize("NFC").toLocaleLowerCase("vi");

export function validateDeepTalkDeck(output: unknown, allowedSensitiveTopics: string[] = []): DeepTalkDeck {
  const issues: string[] = [];
  const allowed = new Set(allowedSensitiveTopics);
  if (allowed.size !== allowedSensitiveTopics.length || allowedSensitiveTopics.some((id) => !sensitiveById.has(id))) {
    throw new DeepTalkValidationError(["Danh sách chủ đề được phép không hợp lệ"]);
  }
  if (!output || typeof output !== "object" || Array.isArray(output)
    || Object.keys(output).length !== 1 || !("cards" in output) || !Array.isArray(output.cards)) {
    throw new DeepTalkValidationError(["Kết quả phải là object chỉ chứa mảng cards"]);
  }

  const cards = output.cards as unknown[];
  if (cards.length !== deepTalkSpec.deck.cardCount) issues.push(`Cần đúng ${deepTalkSpec.deck.cardCount} lá, nhận ${cards.length}`);
  const groupCounts = new Map<string, number>();
  const usedForms = new Set<string>();

  cards.forEach((raw, index) => {
    const path = `Lá ${index + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return issues.push(`${path}: phải là object`);
    const card = raw as Record<string, unknown>;
    if (JSON.stringify(Object.keys(card).sort()) !== JSON.stringify(requiredKeys)) issues.push(`${path}: sai cấu trúc trường`);
    const group = typeof card.group === "string" ? groupById.get(card.group) : undefined;
    if (!group) issues.push(`${path}: group không hợp lệ`);
    else groupCounts.set(group.id, (groupCounts.get(group.id) ?? 0) + 1);
    if (typeof card.form !== "string" || !formIds.has(card.form)) issues.push(`${path}: form không hợp lệ`);
    else usedForms.add(card.form);
    if (typeof card.severity !== "string" || !severityIds.has(card.severity)) issues.push(`${path}: severity không hợp lệ`);
    else if (group && !group.allowedSeverities.includes(card.severity as never)) issues.push(`${path}: severity không phù hợp group`);
    if (typeof card.positive !== "boolean") issues.push(`${path}: positive phải là boolean`);

    const topics = Array.isArray(card.sensitivityTopics) ? card.sensitivityTopics : null;
    if (!topics || topics.some((id) => typeof id !== "string" || !sensitiveById.has(id))) issues.push(`${path}: sensitivityTopics không hợp lệ`);
    else {
      if (new Set(topics).size !== topics.length) issues.push(`${path}: sensitivityTopics bị trùng`);
      if (topics.some((id) => !allowed.has(id as string))) issues.push(`${path}: chứa chủ đề chưa được đồng thuận`);
      if (group && !group.allowsSensitiveTopics && topics.length) issues.push(`${path}: group không cho phép chủ đề nhạy cảm`);
    }

    if (typeof card.question !== "string") return issues.push(`${path}: question phải là chuỗi`);
    const length = [...card.question].length;
    if (length < deepTalkSpec.questionLength.min || length > deepTalkSpec.questionLength.max) issues.push(`${path}: độ dài question không hợp lệ`);
    if (!vietnameseWord.test(card.question)) issues.push(`${path}: question không nhận diện được là tiếng Việt`);
    for (const [id, pattern] of forbidden) if (pattern.test(card.question)) issues.push(`${path}: khớp mẫu cấm ${id}`);
    const question = normalized(card.question);
    for (const [id, topic] of sensitiveById) {
      if (!allowed.has(id) && question.includes(normalized(topic.label))) issues.push(`${path}: nhắc chủ đề chưa được đồng thuận ${id}`);
    }
  });

  for (const group of deepTalkSpec.groups) {
    const count = groupCounts.get(group.id) ?? 0;
    if (count !== deepTalkSpec.deck.cardsPerGroup) issues.push(`Group ${group.id} cần ${deepTalkSpec.deck.cardsPerGroup} lá, nhận ${count}`);
  }
  if (usedForms.size < deepTalkSpec.deck.minimumDistinctForms) {
    issues.push(`Cần ít nhất ${deepTalkSpec.deck.minimumDistinctForms} form khác nhau, nhận ${usedForms.size}`);
  }
  if (issues.length) throw new DeepTalkValidationError(issues);
  return output as DeepTalkDeck;
}
