# P1.15 — CI/CD runbook

## Pipeline

- `CI`: one Ubuntu job runs lockfile install, production build, unit/integration/E2E, dependency audit and a Wrangler deploy dry-run. Configure `CI / verify` as a required check for `main`.
- `Deploy Preview`: after a successful CI run on `main`, deploys the shared preview Worker, applies preview D1 migrations and runs an anonymous browser smoke test.
- `Deploy Production`: only a published GitHub Release whose tag starts with `v`; it repeats verification, waits on the `production` GitHub Environment, migrates, deploys and smoke-tests.

The preview is shared instead of per-PR because Cloudflare does not generate Preview URLs for Workers using Durable Objects. PRs still receive CI before merge; no Cloudflare secret is exposed to unmerged code.

## One-time GitHub setup

Create environments named `preview` and `production`. Add these values to each environment, using different resources and secret values:

| Kind | Name | Value |
|---|---|---|
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Owner Cloudflare account ID |
| Variable | `D1_DATABASE_ID` | D1 ID for this environment |
| Variable | `WORKER_NAME` | Recommended: `our-website-app-preview` / `our-website-app` |
| Variable | `DEPLOY_URL` | Full HTTPS `workers.dev` URL |
| Secret | `CLOUDFLARE_API_TOKEN` | Least-privilege token for Workers Scripts and D1 edit |
| Cloudflare Worker secret | `AUTH_PEPPER` | Random environment-specific value, at least 32 bytes |

For `production`:

1. Add the owner as required reviewer and prevent self-review.
2. Restrict deployment to tags matching `v*`.
3. Disable administrator bypass where the repository plan supports it.

Required reviewers on GitHub Free are available only for public repositories. Do not enable production without an equivalent manual owner approval if repository visibility or plan changes.

Protect `main`: require pull requests and the `CI / verify` status check. In GitHub billing, keep the Actions spending limit at `0`; these workflows upload no artifacts. After the first green Actions preview, disable the old P0.8 Cloudflare Builds integration so the same commit is not built twice.

## Cloudflare resources

Create two D1 databases and two Workers under the owner account. Add `AUTH_PEPPER` once to each Worker through the Cloudflare dashboard or owner-controlled Wrangler session; the deploy config declares it required and fails closed when it is missing. Do not run `secret put` on every release because that command deploys a Worker version immediately.

Never reuse a D1 ID, Worker name, `AUTH_PEPPER`, account password or future R2 bucket across preview and production. Do not enable a paid Workers plan.

Wrangler config is rendered ephemerally as `.wrangler-deploy.json`; it contains resource IDs and the required secret name, but never the `AUTH_PEPPER` value or API token.

## Migration and rollback

`wrangler d1 migrations apply --remote` runs before deploy. In CI, D1 skips the prompt and captures an automatic backup; a failed migration is rolled back by D1. Migrations already applied are immutable and all schema changes must remain backward-compatible with the previous Worker version.

If smoke fails:

1. Stop the release and inspect the deployment log without printing secrets.
2. Roll the Worker back to its previous version from Cloudflare Deployments.
3. Do not reverse SQL destructively; ship a reviewed forward migration when data shape needs correction.
4. Re-run the release and smoke test.

Production seeding and password setup are deliberately not automated. Use the documented owner-controlled reset process after initial migration.

## Local checks

```sh
npm run web:build
npm test
npm run cicd:check
```

`cicd:check` validates the environment config contract, secret boundary, static asset routing and Worker bundle without contacting Cloudflare.

Official references: [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply), [Workers static assets](https://developers.cloudflare.com/workers/wrangler/configuration/#assets), and [Workers Preview URL limitations](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/#limitations).
