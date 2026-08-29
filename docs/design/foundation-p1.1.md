# P1.1 — Design foundation

- Status: Closed
- Date: 2026-08-29
- Source: Requirement sections 15, 17 and 18

## Decisions

- Use the native system sans-serif stack; decorative type is deferred to real
  headings only and is not required for readable body copy.
- Use a warm cream/rose/sage palette in light mode and a navy-purple canvas in
  dark mode. `user-one`, `user-two`, and `shared` are semantic roles, so final
  personal colors can change without rewriting components.
- Use a four-pixel spacing base, 44-pixel minimum controls, fluid title size,
  rounded surfaces and restrained elevation.
- Respect the OS theme by default while allowing explicit `data-theme` user
  preference. Respect OS reduced motion and explicit `data-motion="reduced"`.
- Keep swipe optional: future gesture interactions must retain labeled button
  alternatives. Color roles must also retain text, icon or shape labels.
- Use system safe-area insets through `.safe-area` for notched phones.

## Contrast evidence

All primary text roles exceed WCAG AA 4.5:1 against their canvas:

| Pair | Light | Dark |
|---|---:|---:|
| Body text | 13.85:1 | 16.66:1 |
| Muted text | 5.72:1 | 10.34:1 |
| User one on soft surface | 4.90:1 | 6.35:1 |
| User two on soft surface | 4.67:1 | 6.46:1 |
| Shared on soft surface | 5.19:1 | 5.39:1 |

## Deliverables

- `apps/web/src/styles.css`: production tokens and accessibility-safe base CSS.
- `apps/web/design-foundation.html`: dependency-free light/dark specimen at the
  360-pixel mobile baseline.

React/Vite scaffolding and reusable UI components remain P1.3 work. P1.1 adds
no dependency and makes no final character-art decision from P1.2.
