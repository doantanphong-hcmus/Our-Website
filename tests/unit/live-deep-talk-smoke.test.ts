import { expect, test } from "vitest";
import { buildDeepTalkDeck } from "../../apps/worker/src/deep-talk-generation";

const liveTest = process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN ? test : test.skip;

liveTest("live Workers AI builds one production Deep Talk deck", async () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  expect(accountId, "CLOUDFLARE_ACCOUNT_ID is missing").toBeTruthy();
  expect(token, "CLOUDFLARE_API_TOKEN is missing").toBeTruthy();

  let calls = 0;
  const ai = { run: async (model: string, input: Record<string, unknown>) => {
    calls += 1;
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(185_000),
    });
    const payload = await response.json() as { result?: unknown; errors?: Array<{ message?: string }> };
    if (!response.ok) throw new Error(`Workers AI ${response.status}: ${payload.errors?.[0]?.message ?? "unknown error"}`);
    return payload.result;
  } };

  const started = performance.now();
  const deck = await buildDeepTalkDeck(ai, {
    level: "understand", allowedSensitiveTopics: [], seed: 2092026,
  });
  expect(deck.cards).toHaveLength(20);
  console.log(JSON.stringify({ outcome: "generated", latencyMs: Math.round(performance.now() - started), calls, cards: 20 }));
}, 190_000);
