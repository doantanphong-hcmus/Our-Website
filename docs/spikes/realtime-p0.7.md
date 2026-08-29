# P0.7: Durable Object realtime spike

- Date: 2026-08-29
- Status: Closed; protocol and two-browser-context acceptance passed
- Runtime: Wrangler 4.127.1 local mode
- Target: state reaches the other client in under 2 seconds

## Scope

This spike uses one SQLite-backed Durable Object per room and Cloudflare's
Hibernation WebSocket API. The Durable Object persists a tiny versioned counter,
serializes concurrent commands, rejects duplicate command IDs, broadcasts state
to connected clients, and sends the latest snapshot after reconnect.

It deliberately does not implement authentication, D1 business state, a domain
session machine, an offline browser queue, heartbeat/backoff, or production
deployment. Those belong to P1.9-P1.11; P0.7 only proves the platform behavior.

## Run

Start the local Cloudflare runtime:

```sh
npm run spike:realtime:server
```

In another terminal, run the fast protocol check and the two-context browser
acceptance:

```sh
npm run spike:realtime:check
npm run spike:realtime:browser
```

The browser check launches two isolated contexts in the system Microsoft Edge
through `playwright-core`; it does not download a bundled browser. Set
`PLAYWRIGHT_BROWSER_CHANNEL` to another installed Playwright channel when
needed. The full cross-browser/network matrix still belongs to P1.14.

## Acceptance record

| Check | Required | Result |
|---|---:|---|
| Client-to-client broadcast | < 2,000 ms | 5 ms |
| Two concurrent increments | Final value/version = 3/3 | Passed in 20 ms |
| Duplicate command | Version remains 3 | Passed |
| Disconnect + offline update + reconnect | Snapshot value/version = 4/4 | Passed |
| Reconnect snapshot | < 2,000 ms | 8 ms |
| Two real browser contexts | Broadcast/concurrency/reconnect pass | Passed twice in Edge |
| Browser broadcast | < 2,000 ms | 12 ms on final run |
| Browser concurrent increments | Final value/version = 3/3 in < 2,000 ms | Passed in 1,268 ms |
| Browser context reconnect | Snapshot value/version = 4/4 in < 2,000 ms | Passed in 153 ms |

P0.7 fully passes its local feasibility gate, including the two real browser
contexts named in the plan. The result proves ordering/recovery behavior but is
not an Internet latency measurement. P1.10 and P1.14 must repeat this against
preview with the full browser and network matrix.

## References

- WebSocket Hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Object rules: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Wrangler Durable Object configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
