import type { DeepTalkCard, DeepTalkDeck } from "./deep-talk-validator";

export type DeepTalkRepeat = {
  card: DeepTalkCard;
  reason: "exact" | "similar";
  fingerprint: string;
  matchedQuestion: string;
};

export const fingerprintDeepTalkQuestion = (question: string): string => question
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("vi")
  .replace(/đ/g, "d")
  .replace(/[^a-z0-9\s]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const stopWords = new Set("ai ban minh hai nguoi dieu khi nao gi mot cung duoc hay neu o la va cua cho ve co se da roi hon trong voi tu den".split(" "));
const words = (question: string) => new Set(fingerprintDeepTalkQuestion(question).split(" ").filter((word) => word.length > 1 && !stopWords.has(word)));
const trigrams = (question: string) => {
  const text = `  ${fingerprintDeepTalkQuestion(question)}  `;
  return new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, index) => text.slice(index, index + 3)));
};
const dice = (left: Set<string>, right: Set<string>) => {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared++;
  return (2 * shared) / (left.size + right.size);
};

function clearlySimilar(left: DeepTalkCard, right: DeepTalkCard): boolean {
  const sameIntent = left.group === right.group && left.form === right.form;
  const wordScore = dice(words(left.question), words(right.question));
  const phraseScore = dice(trigrams(left.question), trigrams(right.question));
  // ponytail: lexical heuristic; move to embeddings only if sampled review shows material misses.
  return wordScore >= (sameIntent ? 0.55 : 0.72) || phraseScore >= (sameIntent ? 0.72 : 0.86);
}

export function removeRepeatedDeepTalkCards(
  deck: DeepTalkDeck,
  currentDeck: DeepTalkDeck | null = null,
  recentDecks: DeepTalkDeck[] = [],
): { cards: DeepTalkCard[]; rejected: DeepTalkRepeat[] } {
  const references = [currentDeck, ...recentDecks.slice(0, 5)].filter((item): item is DeepTalkDeck => Boolean(item))
    .flatMap((item) => item.cards);
  const cards: DeepTalkCard[] = [];
  const rejected: DeepTalkRepeat[] = [];

  for (const card of deck.cards) {
    const fingerprint = fingerprintDeepTalkQuestion(card.question);
    const exact = [...references, ...cards].find((previous) => fingerprintDeepTalkQuestion(previous.question) === fingerprint);
    const similar = exact ?? [...references, ...cards].find((previous) => clearlySimilar(card, previous));
    if (similar) rejected.push({ card, reason: exact ? "exact" : "similar", fingerprint, matchedQuestion: similar.question });
    else cards.push(card);
  }
  return { cards, rejected };
}
