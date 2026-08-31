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

## Historical check

The spike commands were retired by P1.10. Run `npm run realtime:check` for the
authenticated production protocol that replaced them. The full cross-browser
and network matrix still belongs to P1.14.

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

P0.7 fully passed its local feasibility gate. Its unauthenticated counter code
and commands were removed when P1.10 replaced them with the authenticated D1
session protocol; the acceptance record remains as historical evidence.

## References

- WebSocket Hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Object rules: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Wrangler Durable Object configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
