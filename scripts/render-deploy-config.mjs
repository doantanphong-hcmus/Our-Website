import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const environment = process.env.DEPLOY_ENV;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.D1_DATABASE_ID;
const workerName = process.env.WORKER_NAME;

if (!['preview', 'production'].includes(environment)) throw new Error("DEPLOY_ENV must be preview or production");
if (!/^[a-f0-9]{32}$/i.test(accountId ?? "")) throw new Error("CLOUDFLARE_ACCOUNT_ID is missing or invalid");
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId ?? "")) throw new Error("D1_DATABASE_ID is missing or invalid");
if (!/^[a-z][a-z0-9-]{2,62}$/.test(workerName ?? "")) throw new Error("WORKER_NAME is missing or invalid");

const source = JSON.parse(await readFile(path.join(root, "apps/worker/wrangler.jsonc"), "utf8"));
const config = {
  ...source,
  $schema: "./node_modules/wrangler/config-schema.json",
  name: workerName,
  account_id: accountId,
  main: "apps/worker/src/realtime-spike.ts",
  workers_dev: true,
  preview_urls: false,
  secrets: { required: ["AUTH_PEPPER"] },
  d1_databases: source.d1_databases.map((database) => ({
    ...database,
    database_id: databaseId,
    migrations_dir: "apps/worker/migrations",
  })),
  assets: {
    directory: "apps/web/dist",
    not_found_handling: "single-page-application",
    run_worker_first: ["/api/*", "/ws", "/health"],
  },
};

await writeFile(path.join(root, ".wrangler-deploy.json"), `${JSON.stringify(config, null, 2)}\n`);
console.log(`Rendered ${environment} config for ${workerName}`);
