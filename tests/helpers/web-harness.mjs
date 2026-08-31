import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import axe from "axe-core";

const root = path.resolve(import.meta.dirname, "../..");

export async function startWeb(port) {
  const server = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: path.join(root, "apps", "web"), stdio: "ignore", windowsHide: true,
  });
  server.unref();
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Vite exited with code ${server.exitCode}`);
    if ((await fetch(url).catch(() => null))?.ok) return {
      url,
      close() {
        server.kill("SIGTERM");
        if (server.exitCode === null && process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      },
    };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  server.kill();
  throw new Error("Vite did not start");
}

export const network = {
  delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  },
  offline(context, value) {
    return context.setOffline(value);
  },
  async fail(page, pattern) {
    const handler = (route) => route.abort("failed");
    await page.route(pattern, handler);
    return () => page.unroute(pattern, handler);
  },
};

export async function mockAuthenticated(page, user, latency = 0) {
  await page.route("**/api/auth/session", async (route) => {
    await network.delay(latency);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
  });
  await page.route("**/api/sessions", async (route) => {
    await network.delay(latency);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eventVersion: 0, sessions: [] }) });
  });
}

export async function assertA11y(page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => (await globalThis.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  })).violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })));
  assert.deepEqual(violations, []);
}
