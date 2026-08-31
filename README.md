# Our Website

Private, mobile-first website for two people.

## Status

Project bootstrap. Product requirements and the implementation plan live one
directory above this repository in `Requirement.md` and `Plan.md`.

## Requirements

- Node.js 24.16.0
- npm 11.13.0

## Setup

```sh
npm install
```

Applications will live in `apps/`; shared packages will live in `packages/`.

## Testing

```sh
npm test
```

Run one layer with `npm run test:unit`, `npm run test:integration`, or
`npm run test:e2e`. The E2E harness uses the installed Edge browser headlessly,
the shared Phong/Nhi fixtures, axe accessibility checks, and network controls.

## License

Private and proprietary. See `LICENSE`.
