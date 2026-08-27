# ADR 0001: Platform architecture

- Status: Accepted
- Date: 2026-08-27

## Context

Our Website is a private, mobile-first web application for exactly two users.
It needs durable shared state, private media, server-side secrets, and updates
between two devices within about two seconds. Production must not run on a
personal computer or incur operating costs.

## Decision

Use one TypeScript monorepo with:

- React and Vite for the client in `apps/web`.
- A Cloudflare Worker for HTTP APIs and static production assets in
  `apps/worker`.
- Cloudflare D1 as the durable relational database and source of truth.
- One SQLite-backed Durable Object per couple space to order concurrent
  commands and broadcast WebSocket updates.
- A private Cloudflare R2 bucket for avatars, check-in photos, and comics;
  authenticated access goes through the Worker.
- Small shared packages only when client and server genuinely share contracts
  or domain rules.
- Server-side adapters for Places and AI providers so their keys and unopened
  content never reach the browser.

```text
React client -- HTTPS/WebSocket --> Worker
                                    |-- D1 (durable state)
                                    |-- Durable Object (ordering/realtime)
                                    |-- R2 (private media)
                                    `-- external provider adapters
```

D1 remains authoritative. Durable Objects coordinate commands and realtime
delivery but are not a second copy of business data.

Production uses Cloudflare's free subdomain until a custom domain is selected.
Every metered integration must have a hard quota and fail closed instead of
automatically moving to paid usage.

The specific Places provider, map tile source, Workers AI model, authentication
hash parameters, and UI libraries are deliberately not selected by this ADR.
They require their own feasibility work or implementation evidence.

## Consequences

### Positive

- No personal server, idle server, or paid baseline infrastructure is needed.
- TypeScript contracts can be shared without duplicating API shapes.
- D1 transactions and Durable Object serialization provide a simple path to
  idempotent two-device workflows.
- Private media and server-side provider calls keep sensitive data and keys out
  of the client.
- The static client remains small and does not need server-side rendering.

### Negative

- The application depends on Cloudflare runtime APIs and free-tier limits.
- Worker CPU, D1 storage, R2 storage, and provider quotas must be monitored.
- Local development needs Cloudflare-compatible emulation for integration
  tests.
- Realtime recovery must reconcile against D1 after reconnect; WebSocket events
  alone are not durable.

## Alternatives rejected

| Alternative | Reason |
|---|---|
| Static site only | Cannot safely implement authentication, private votes/media, server-only random results, or realtime state. |
| Single VPS or home server | Adds recurring cost, maintenance, and a personal-machine dependency. |
| Next.js/SSR | The product has no public SEO or server-rendering requirement; it adds runtime and framework surface without solving a current need. |
| Separate custom WebSocket server | Adds another deployment and operational cost; Durable Objects already provide per-space ordering and WebSockets. |
| Firebase/Supabase as the primary platform | Either would work, but splitting hosting, realtime, database, and media across more vendors adds configuration and quota failure modes. |
| Direct browser calls to Places or AI | Exposes keys or private/unopened content and prevents authoritative server-side decisions. |

## Revisit when

- A verified free-tier limit cannot support the two real users.
- D1 cannot provide a required transaction or query after measurement.
- Durable Object WebSocket recovery cannot meet the two-second target.
- Production requirements expand beyond one couple space or become commercial.

## References

- Product requirements: `../../../Requirement.md`
- Project plan: `../../../Plan.md`
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
