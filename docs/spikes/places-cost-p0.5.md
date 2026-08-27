# P0.5: Google Places zero-cost guardrail

- Date: 2026-08-27
- Status: Cost model verified; live call requires an owner-controlled API key
- Goal: rich place data with a hard operating-cost ceiling of 0 VND

## Decision

Use Google Places Nearby Search (New) as the primary source for Blind Bag and
restaurant candidates. One Enterprise request returns up to 20 candidates with
the required searchable fields. Do not make a Place Details call for every
candidate.

Request only this field mask:

```text
places.id,places.displayName,places.primaryType,places.types,
places.formattedAddress,places.location,places.businessStatus,places.photos,
places.currentOpeningHours,places.rating,places.userRatingCount,places.priceLevel
```

`photos` returns photo resource names in the search response. Fetch the image
only for a result actually shown to the users. Do not request reviews or any
Enterprise + Atmosphere field.

Geoapify may later provide address/opening-hours fallback when Google is
unavailable, but it must not fabricate rating, review count, photo, or price.

## Verified free caps

Google's global pricing documentation dated 2026-08-25 states:

| SKU category | Monthly free usage per SKU |
|---|---:|
| Essentials | 10,000 requests |
| Pro | 5,000 requests |
| Enterprise | 1,000 requests |

The selected `currentOpeningHours`, `rating`, `userRatingCount`, and
`priceLevel` fields make the search a Nearby Search Enterprise request. Google
bills a request at the highest field SKU requested, so splitting those fields
into repeated detail calls would add calls without helping this two-user app.

## Hard application limits

Use a D1 counter before each external call. The production limit is lower than
80% of each current free cap:

| Method/SKU | Daily hard limit | Monthly hard limit | Current free cap |
|---|---:|---:|---:|
| Nearby Search Enterprise | 20 | 600 | 1,000/month |
| Text Search Enterprise | 5 | 150 | 1,000/month |
| Place Details Enterprise | 5 | 150 | 1,000/month |
| Place Details Photos | 20 | 600 | 1,000/month |

These are shared limits for the entire two-account space, not per user. A
failed provider response does not retry automatically. Any future retry must
still consume the application counter before it sends a request.

Cloud Console quotas provide a second, independent brake:

| API method | Maximum requests/minute |
|---|---:|
| Nearby Search | 2 |
| Text Search | 2 |
| Place Details | 5 |
| Place Photos | 5 |

Budget alerts at 50%, 80%, and 95% are informational only. They are not a
spending cap and cannot replace the application and API quotas.

## Fail-closed behavior

Before calling Google, the server checks the daily and monthly counter in the
same D1 operation that reserves one request. When a limit is reached:

1. Do not call Google and do not switch to a paid provider.
2. Return a stable `PLACE_PROVIDER_QUOTA_EXHAUSTED` error.
3. Keep the user's session settings so they can retry later.
4. Offer manual address input or a provider fallback only for fields it truly
   supplies.
5. Never silently drop allergy, safety, distance, or opening-hours rules.

## Key controls

- Store `GOOGLE_MAPS_API_KEY` only as a Cloudflare Worker secret.
- Restrict the key to Places API (New); do not use one key for browser maps.
- Cloudflare Workers do not have one stable outbound IP, so the primary
  protection is server-only storage, API restriction, rate limits, and hard
  usage counters.
- Do not log the key, request headers, or full provider payloads.
- Do not create a billing account or key in a technician-owned account.

## Reproducible spike

The script makes exactly one billable Nearby Search request and has no runtime
dependency:

```sh
node scripts/spike-google-places.mjs --self-test
node scripts/spike-google-places.mjs
```

On PowerShell, set the environment variable for the current process instead of
placing the key on the command line. The live run remains pending until the
project owner supplies an API key with the quotas above already applied.

## Release checks

- [x] No wildcard field mask.
- [x] No reviews/Atmosphere fields.
- [x] One search request per spike execution.
- [x] Monthly application limits remain below current free caps.
- [x] Missing key fails before any network call.
- [ ] Owner-controlled Google Cloud project and API key exist.
- [ ] Cloud Console per-minute quotas are applied.
- [ ] Live 30-place field coverage is measured in the real usage area.
- [ ] Pricing and free caps are rechecked before production.

P0.5 verifies the zero-cost design. The three unchecked provider-account items
are deployment controls and must be completed before Google is enabled in
production; they do not justify committing a secret or creating an account in
the technician's name.

## References

- Pricing categories and free caps: https://developers.google.com/maps/billing-and-pricing/pricing-categories
- Current core pricing list: https://developers.google.com/maps/billing-and-pricing/pricing
- Nearby Search fields/SKUs: https://developers.google.com/maps/documentation/places/web-service/nearby-search
- Places usage and billing: https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- Cost controls and hard quotas: https://developers.google.com/maps/billing-and-pricing/manage-costs
