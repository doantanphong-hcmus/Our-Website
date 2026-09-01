import deepTalkSpec from "../../../content/deep-talk.v1.json";
import type { DeepTalkCard, DeepTalkDeck } from "./deep-talk-validator";

export class DeepTalkShuffleError extends Error {}

const endingCard = (card: DeepTalkCard) => card.positive && card.severity !== "heavy";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function followsRhythm(card: DeepTalkCard, position: number, ordered: DeepTalkCard[]): boolean {
  if (position < 3 && card.severity !== "light") return false;
  if (position < 6 && card.severity === "heavy") return false;
  if (position >= deepTalkSpec.deck.cardCount - 2 && !endingCard(card)) return false;
  if (card.severity === "heavy" && ordered.at(-1)?.severity === "heavy") return false;
  if (ordered.length >= 3 && ordered.slice(-3).every((previous) => previous.form === card.form)) return false;
  if (ordered.length >= 2 && ordered.slice(-2).every((previous) => previous.group === card.group)) return false;
  return true;
}

export function shuffleDeepTalkDeck(deck: DeepTalkDeck, seed: number): DeepTalkDeck {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || deck.cards.length !== deepTalkSpec.deck.cardCount
    || deck.cards.filter((card) => card.severity === "light").length < 3
    || deck.cards.filter(endingCard).length < 2) {
    throw new DeepTalkShuffleError("Không thể trộn bộ Deep Talk với seed hoặc phân bố lá hiện tại.");
  }
  const random = seededRandom(seed);
  const pool = deck.cards.map((card, index) => ({ card, index, rank: random() })).sort((left, right) => left.rank - right.rank);
  const ordered: DeepTalkCard[] = [];
  const used = new Set<number>();

  // ponytail: bounded backtracking is enough for the fixed 20-card deck; replace only if deck size becomes configurable.
  function place(position: number): boolean {
    if (position === pool.length) return true;
    for (const candidate of pool) {
      if (used.has(candidate.index) || !followsRhythm(candidate.card, position, ordered)) continue;
      const endingsNeeded = position < pool.length - 2 ? 2 : position === pool.length - 2 ? 1 : 0;
      const endingsLeft = pool.filter((item) => item.index !== candidate.index && !used.has(item.index) && endingCard(item.card)).length;
      if (endingsLeft < endingsNeeded) continue;
      used.add(candidate.index);
      ordered.push(candidate.card);
      if (place(position + 1)) return true;
      ordered.pop();
      used.delete(candidate.index);
    }
    return false;
  }

  if (!place(0)) throw new DeepTalkShuffleError("Không tìm được thứ tự Deep Talk thỏa nhịp an toàn.");
  return { cards: ordered };
}
