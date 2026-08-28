# P0.6: Workers AI Deep Talk spike

- Date: 2026-08-28
- Status: Validator ready; three live generations await owner credentials
- Model: `@cf/meta/llama-3.1-8b-instruct-fast`

## Scope

The dependency-free spike requests three Vietnamese Deep Talk decks through
Workers AI JSON Mode. Each deck must contain exactly 40 cards and exactly eight
cards in each of the five required groups.

The spike measures:

- schema/JSON consistency;
- structural and obvious safety-filter pass rate;
- exact normalized repetition across all three decks;
- response time and provider token usage;
- naturalness and variety through manual review.

It intentionally does not implement production retry, similarity scoring,
controlled shuffle, persistence, or gameplay. Those belong to P4.

## Zero-cost decision

Workers AI on Workers Free currently includes 10,000 neurons per day. Further
operations fail after that allocation; using more requires Workers Paid. Keep
the account on Workers Free and never route through prepaid/third-party AI.

The selected model is active, multilingual, supports JSON Mode, and is not on
Cloudflare's current list of models requiring a paid billing method. JSON Mode
can still fail its schema, so application validation remains mandatory.

Production keeps the product limit of three new decks per pair per day. Store
successful decks and never regenerate them on resume. If generation or
validation fails, offer the reviewed fallback deck instead of switching to a
paid model.

## Run

The self-test makes no network request:

```sh
node scripts/spike-workers-ai.mjs --self-test
```

For the live run, create an owner-controlled Workers AI REST API token with
Workers AI Read and Edit only. Set the two values in the current PowerShell
process; never paste a token into chat, a command argument, or a committed file:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '<owner account id>'
$token = Read-Host 'Workers AI API token' -AsSecureString
$env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $token).Password
try { node scripts/spike-workers-ai.mjs }
finally {
  Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
  Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  $token.Dispose()
}
```

The command performs exactly three sequential inference calls and prints the
decks plus a machine-readable summary. Compare the Workers AI dashboard neuron
counter immediately before and after the run because the REST response may
report tokens without the exact neuron total.

## Acceptance record

| Check | Required | Result |
|---|---:|---|
| Decks generated | 3 | Pending live credentials |
| Valid JSON/schema | 3/3 | Pending |
| Cards per deck | 40 | Enforced by schema + validator |
| Cards per group | 8 | Enforced by validator |
| Obvious forbidden content | 0 | Enforced by validator; manual review pending |
| Exact cross-deck repeats | 0 | Measured by script; pending |
| Vietnamese naturalness | Owner review | Pending |
| Latency | Recorded per deck | Pending |
| Neuron delta | Below 10,000/day | Pending dashboard measurement |

P0.6 is complete only after the three live outputs pass automated validation
and owner content review. Do not infer content safety from valid JSON alone.

## References

- Workers AI pricing and Free behavior: https://developers.cloudflare.com/workers-ai/platform/pricing/
- JSON Mode and supported models: https://developers.cloudflare.com/workers-ai/features/json-mode/
- REST API token and account setup: https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- Selected model: https://developers.cloudflare.com/ai/models/%40cf/meta/llama-3.1-8b-instruct-fast/
