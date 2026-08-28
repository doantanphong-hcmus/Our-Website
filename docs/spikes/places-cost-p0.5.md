# P0.5: Places zero-cost guardrail

- Date: 2026-08-28
- Status: Complete
- Goal: keep Places usable without a billing account or accidental charges

## Decision

Do not enable Google Places or any provider that requires a billing account.
Do not collect, display, or rank by provider price level; hiding it is an
intentional product decision that preserves the Blind Bag surprise.

The first production candidate is Geoapify Places on its Free plan. It does
not require a credit card and currently includes 3,000 credits per day. A
Places response costs one credit per 20 returned places. The account and key
must be owner-controlled before production.

Photon remains a reproducible development spike only. Its public demo has no
production availability guarantee.

## Data contract

Provider data is normalized without inventing missing values:

| Field | Policy |
|---|---|
| Provider ID, name, type, address, coordinates | Required candidate data |
| Distance | Calculated by the server from coordinates |
| Opening hours | Optional; `null` means unknown, not closed |
| Rating and review count | Optional; `null` means unknown, not zero |
| Photo | Optional; owner-uploaded visit photos are the reliable fallback |
| Price level | Deliberately omitted |

Selection uses only known data. An unknown opening time must never become
"closed", and a missing rating must never reduce a candidate's score. Before
departure, the result asks the users to verify current opening information via
the external map link.

## Hard limits

The application reserves one shared D1 usage counter before every Places
request. Limits are for the whole two-account space:

| Limit | Value |
|---|---:|
| Requests per minute | 2 |
| Requests per day | 100 |
| Returned places per request | 20 |
| Automatic retries | 0 |

The daily limit is intentionally far below the provider's current free-plan
allowance. Provider errors still consume the application reservation so a
failure loop cannot create unbounded traffic.

## Fail-closed behavior

When the counter is exhausted or the provider is unavailable:

1. Do not call another paid provider.
2. Return `PLACE_PROVIDER_QUOTA_EXHAUSTED` or `PLACE_PROVIDER_UNAVAILABLE`.
3. Preserve the session settings.
4. Allow manual place/address entry and previously stored places.
5. Never weaken allergy, safety, or distance exclusions.

## Key and operations controls

- Store the Geoapify key only as a Cloudflare Worker secret.
- Restrict the key to the production origin/IP controls supported by the
  provider; never expose it in the web bundle or logs.
- Show the required OpenStreetMap/Geoapify attribution.
- Review free-plan allowance and terms before production and quarterly.
- If the free plan changes or requires billing, disable remote search and use
  stored/manual places until an approved zero-cost provider is available.

## Release checks

- [x] No Google Cloud project or billing account is required.
- [x] Price level is absent from the provider contract and ranking.
- [x] Missing fields remain nullable and do not become false facts.
- [x] App limits and fail-closed behavior are defined.
- [x] Manual/stored-place fallback is defined.
- [ ] Owner-controlled Geoapify account and restricted key exist.
- [ ] Live coverage is repeated in the real usage area.
- [ ] Attribution and current free-plan terms are checked before production.

The unchecked items are deployment prerequisites, not blockers for building
the provider-neutral backend contract.

## References

- Geoapify Places API and credit calculation: https://apidocs.geoapify.com/docs/places/
- Geoapify pricing and no-card Free plan: https://www.geoapify.com/pricing/
- Photon demo-server warning: https://github.com/komoot/photon
