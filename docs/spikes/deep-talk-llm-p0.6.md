# P0.6: Workers AI Deep Talk spike

- Date: 2026-08-28
- Status: Complete; provider feasible with mandatory local deduplication
- Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Tier: Cloudflare Workers AI Free

## Superseded provider experiments

The owner-supplied Claude proxy accepted requests but did not preserve
structured output reliably: one attempt returned only a thinking block, one
omitted a required `question`, and one wrapped JSON in a Markdown fence.
Gemini 3.7 Flash then returned `503 high demand` for all three pre-inference
requests. Neither provider produced an accepted deck.

The validator strips at most one JSON code fence for defensive compatibility
and never repairs or invents missing card data.

## Scope

The dependency-free spike requests three Vietnamese Deep Talk decks through
the Workers AI REST API. Each deck must contain exactly 20 cards and exactly
four cards in each of the five required groups.

The spike measures:

- schema/JSON consistency;
- structural and obvious safety-filter pass rate;
- exact normalized repetition across all three decks;
- response time and provider token usage when returned;
- naturalness and variety through manual review.

It intentionally does not implement production retry, similarity scoring,
controlled shuffle, persistence, or gameplay. Those belong to P4.

## Provider decision

Use the active `@cf/meta/llama-3.3-70b-instruct-fp8-fast` model. A live 8B
trial produced 0/3 valid decks and repeated 47/60 questions. The 70B trial
reduced exact repeats to 3/60 and produced materially better Vietnamese, so it
is the smallest model that met the content-quality bar. Cloudflare's older
Llama 3 and non-fast Llama 3.1 variants are deprecated. The selected model
supports JSON Mode, although Cloudflare explicitly does not guarantee that
every response will satisfy the requested schema; the local validator remains
mandatory.

Workers AI Free includes 10,000 neurons per day. Once exhausted, Free-plan
requests fail instead of becoming paid usage. Cloudflare states that Workers AI
Customer Content is not used to train models or improve its or third-party
services without explicit consent. Prompts still remain generic and contain no
names, answers, locations, or private history.

Production keeps the product limit of three new decks per pair per day. Store
successful decks and never regenerate them on resume. If generation or
validation fails, offer the reviewed fallback deck; never spend money or
switch providers automatically.

## Run

The self-test makes no network request:

```sh
node scripts/spike-deep-talk.mjs --self-test
```

Set credentials only in the current PowerShell process; never put real values
in `.env.example` or another committed file:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = Read-Host 'Cloudflare Account ID'
$token = Read-Host 'Cloudflare Workers AI token' -AsSecureString
$env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $token).Password
try { node scripts/spike-deep-talk.mjs }
finally {
  Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
  Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  $token.Dispose()
}
```

The command performs exactly three sequential inference calls and prints a
machine-readable summary with validation, latency, provider usage, and five
sample questions per deck.

## Acceptance record

| Check | Required | Result |
|---|---:|---|
| Decks generated | 3 | 3 |
| Valid JSON/schema | 3/3 | 3/3 |
| Cards per deck | 20 | 20/20/20 |
| Cards per group | 4 | 4 in every group |
| Obvious forbidden content | 0 | 0 automated findings |
| Exact cross-deck repeats | Measure and reject locally | 2/60; provider alone is insufficient |
| Vietnamese naturalness | Manual spot review | Usable, occasionally generic; 70B materially better than 8B |
| Latency | Recorded per deck | 10.6 s / 13.3 s / 23.3 s |
| Token usage | Recorded per deck | 643 / 1,080 / 1,484 total tokens |
| Neuron usage | Within Free allocation | 317.10 total neurons |

P0.6 passes the feasibility gate: all three live decks passed per-deck
validation and spot review. The two cross-deck repeats confirm Requirement
11.8: P4 must compare against recent decks, discard duplicates, request only
the missing questions, then validate again before persistence. Valid JSON alone
does not prove content safety.

## References

- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Workers AI JSON Mode: https://developers.cloudflare.com/workers-ai/features/json-mode/
- Workers AI data usage: https://developers.cloudflare.com/workers-ai/platform/data-usage/
- Llama 3.1 deprecations: https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/
