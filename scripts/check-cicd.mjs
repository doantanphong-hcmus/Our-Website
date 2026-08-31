import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".wrangler-deploy.json");
const env = {
  ...process.env,
  DEPLOY_ENV: "preview",
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
  WORKER_NAME: "our-website-preview",
  AUTH_PEPPER: "must-not-enter-rendered-config",
};

try {
  const rendered = spawnSync(process.execPath, [path.join(root, "scripts/render-deploy-config.mjs")], { cwd: root, env, encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  const config = JSON.parse(await readFile(output, "utf8"));
  assert.equal(config.name, env.WORKER_NAME);
  assert.equal(config.d1_databases[0].database_id, env.D1_DATABASE_ID);
  assert.equal(config.assets.not_found_handling, "single-page-application");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*", "/ws", "/health"]);
  assert.deepEqual(config.secrets.required, ["AUTH_PEPPER"]);
  assert.equal(JSON.stringify(config).includes(env.AUTH_PEPPER), false, "Secret values must not enter deploy config");

  const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  const dryRun = spawnSync(process.execPath, [wrangler, "deploy", "--dry-run", "--config", output], { cwd: root, encoding: "utf8" });
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);

  for (const workflow of ["ci.yml", "preview.yml", "production.yml"]) {
    const text = await readFile(path.join(root, ".github/workflows", workflow), "utf8");
    assert.match(text, /permissions:\s*\n\s*contents: read/);
    assert.doesNotMatch(text, /pull_request_target/);
  }
  console.log("P1.15 CI/CD: environment config, static assets, secret boundary and Worker dry-run = OK");
} finally {
  await rm(output, { force: true });
}
