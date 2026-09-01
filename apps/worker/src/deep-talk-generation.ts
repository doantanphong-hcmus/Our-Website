import { generateDeepTalkDeck, generateDeepTalkSupplement, type DeepTalkAiBinding, type DeepTalkAiInput } from "./deep-talk-ai";
import { removeRepeatedDeepTalkCards } from "./deep-talk-similarity";
import { shuffleDeepTalkDeck } from "./deep-talk-shuffle";
import type { DeepTalkCard, DeepTalkDeck } from "./deep-talk-validator";

export class DeepTalkGenerationError extends Error {}

export async function buildDeepTalkDeck(ai: DeepTalkAiBinding, input: DeepTalkAiInput,
  currentDeck: DeepTalkDeck | null = null, recentDecks: DeepTalkDeck[] = []): Promise<DeepTalkDeck> {
  const history = [currentDeck, ...recentDecks.slice(0, 5)].filter((deck): deck is DeepTalkDeck => Boolean(deck));
  const historyQuestions = history.flatMap((deck) => deck.cards.map((card) => card.question));
  const initial = await generateDeepTalkDeck(ai, { ...input, avoidQuestions: historyQuestions });
  let cards = removeRepeatedDeepTalkCards(initial, currentDeck, recentDecks).cards;

  for (let attempt = 0; cards.length < 20 && attempt < 2; attempt++) {
    const supplement = await generateDeepTalkSupplement(ai, {
      ...input,
      seed: (input.seed + attempt + 1) >>> 0,
      avoidQuestions: [...historyQuestions, ...cards.map((card) => card.question)].slice(-140),
    }, cards);
    const references: DeepTalkDeck = { cards: [...(currentDeck?.cards ?? []), ...cards] };
    cards = [...cards, ...removeRepeatedDeepTalkCards({ cards: supplement }, references, recentDecks).cards];
  }
  if (cards.length !== 20) throw new DeepTalkGenerationError(`Chỉ tạo được ${cards.length}/20 lá không trùng.`);
  return shuffleDeepTalkDeck({ cards: cards as DeepTalkCard[] }, input.seed);
}
