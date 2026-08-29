# P0.7: Durable Object realtime spike

- Date: 2026-08-29
- Status: Complete; local Durable Object acceptance passed
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

In another terminal, run the dependency-free acceptance client:

```sh
npm run spike:realtime:check
```

The check uses two independent WHATWG WebSocket clients to exercise the same
wire API used by browsers. Playwright browser-context coverage is deferred to
the P1.14 E2E harness rather than adding it only for this spike.

## Acceptance record

| Check | Required | Result |
|---|---:|---|
| Client-to-client broadcast | < 2,000 ms | 5 ms |
| Two concurrent increments | Final value/version = 3/3 | Passed in 20 ms |
| Duplicate command | Version remains 3 | Passed |
| Disconnect + offline update + reconnect | Snapshot value/version = 4/4 | Passed |
| Reconnect snapshot | < 2,000 ms | 8 ms |

P0.7 passes its feasibility gate. The local result is far below the two-second
target and proves ordering/recovery behavior, but it is not an Internet latency
measurement. P1.10 and P1.14 must repeat this against preview using two real
browser contexts and network controls.

## References

- WebSocket Hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Object rules: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Wrangler Durable Object configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
