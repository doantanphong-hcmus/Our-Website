# P0.5: Places zero-cost guardrail

- Date: 2026-08-28
- Status: Complete
- Goal: keep Places usable without a billing account or accidental charges

## Decision

Do not enable Google Places or any provider that requires a billing account.
Do not collect, display, or rank by provider price level; hiding it is an
intentional product decision that preserves the Blind Bag surprise.

The production source is a small, owner-approved catalog stored with the app.
This keeps selection predictable, removes per-play lookup cost, and lets every
result meet the product requirement before it can be shown. Geoapify remains
an optional future discovery adapter and is disabled by default.

Photon remains a reproducible development spike only. Its public demo has no
production availability guarantee.

## Data contract

Provider data is normalized without inventing missing values:

| Field | Policy |
|---|---|
| Provider ID, name, type, address, coordinates | Required candidate data |
| Distance | Calculated by the server from coordinates |
| Opening hours | Optional; `null` means unknown, not closed |
| Description | Required, factual, and derived from source tags when available |
| Budget tier | Required estimate for two people; one of the three product tiers |
| Rating, reviews and photo | Optional and currently omitted to avoid provider cost |
| Source and verification date | Required for curated places |
| Price level | Deliberately omitted |

Only entries with `approved: true`, name, address, description, coordinates,
budget and source evidence pass the curated adapter. AI may make the wording
playful, but must not invent or alter facts. Users verify current opening,
price and suitability through the source link before departure.

Candidate selection only applies the two product filters: distance and budget.
It rejects incomplete/unapproved records and duplicate provider IDs. Opening
hours stay informational because the setup no longer asks for a visit time.

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

If optional remote discovery is enabled and unavailable:

1. Do not call another paid provider.
2. Return `PLACE_PROVIDER_QUOTA_EXHAUSTED` or `PLACE_PROVIDER_UNAVAILABLE`.
3. Preserve the session settings.
4. Continue serving the approved local catalog.
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
- [x] Approved local-catalog fallback is defined.
- [x] Production does not depend on a remote Places request.
- [x] Curated entries fail closed when photo/rating/review/source evidence is missing.
- [ ] Owner-approved place content has been entered and reviewed.
- [ ] If Geoapify is enabled later, attribution and current terms are rechecked.

The unchecked content item belongs to candidate onboarding, not the P2.4
adapter contract. No real-world rating or review is fabricated in fixtures.

## References

- Geoapify Places API and credit calculation: https://apidocs.geoapify.com/docs/places/
- Geoapify pricing and no-card Free plan: https://www.geoapify.com/pricing/
- Photon demo-server warning: https://github.com/komoot/photon
