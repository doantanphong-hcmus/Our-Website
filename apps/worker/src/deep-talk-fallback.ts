import fallback from "../../../content/deep-talk-fallback.v1.json";
import { shuffleDeepTalkDeck } from "./deep-talk-shuffle";
import { validateDeepTalkDeck, type DeepTalkDeck } from "./deep-talk-validator";

export function getDeepTalkFallback(seed: number): DeepTalkDeck {
  return shuffleDeepTalkDeck(validateDeepTalkDeck(structuredClone(fallback), []), seed);
}
