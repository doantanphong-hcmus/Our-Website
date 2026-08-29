import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.REALTIME_SPIKE_URL ?? "http://127.0.0.1:8787";
const timeoutMs = 2_000;
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "msedge";

const socketUrl = (room, client) => {
  const url = new URL("/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("room", room);
  url.searchParams.set("client", client);
  return url.href;
};

async function connect(context, room, client) {
  const page = await context.newPage();
  const snapshot = await page.evaluate(({ url, timeout }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket snapshot timeout")), timeout);
    const socket = new WebSocket(url);
    globalThis.realtimeSpike = { socket, events: [] };
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
    socket.addEventListener("message", ({ data }) => {
      const event = JSON.parse(data);
      globalThis.realtimeSpike.events.push(event);
      if (event.type === "state" && event.snapshot) {
        clearTimeout(timer);
        resolve(event);
      }
    });
  }), { url: socketUrl(room, client), timeout: timeoutMs });
  return { page, snapshot };
}

async function send(page, id) {
  await page.evaluate((commandId) => {
    globalThis.realtimeSpike.socket.send(JSON.stringify({ type: "increment", id: commandId }));
  }, id);
}

async function waitFor(page, expected) {
  await page.waitForFunction(({ version, duplicate }) => globalThis.realtimeSpike.events.some((event) =>
    event.type === "state"
      && (version === undefined || event.state?.version === version)
      && (duplicate === undefined || event.duplicate === duplicate)), expected, { timeout: timeoutMs });
  return page.evaluate(({ version, duplicate }) => [...globalThis.realtimeSpike.events].reverse().find((event) =>
    event.type === "state"
      && (version === undefined || event.state?.version === version)
      && (duplicate === undefined || event.duplicate === duplicate)), expected);
}

const elapsed = (start) => Math.round(performance.now() - start);
const underTarget = (value) => assert.ok(value < timeoutMs, `${value}ms exceeds ${timeoutMs}ms target`);

async function main() {
  const health = await fetch(new URL("/health", baseUrl)).catch(() => null);
  assert.equal(health?.ok, true, "Start the spike server first: npm run spike:realtime:server");

  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
  });
  const room = `p07-browser-${Date.now()}`;
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();

  try {
    const first = await connect(firstContext, room, "first-browser");
    const second = await connect(secondContext, room, "second-browser");
    assert.equal(first.snapshot.state.version, 0);
    assert.equal(second.snapshot.state.version, 0);

    let started = performance.now();
    const broadcast = waitFor(second.page, { version: 1 });
    await send(first.page, "browser-first-1");
    await broadcast;
    const broadcastMs = elapsed(started);
    underTarget(broadcastMs);

    started = performance.now();
    const firstConcurrent = waitFor(first.page, { version: 3 });
    const secondConcurrent = waitFor(second.page, { version: 3 });
    await Promise.all([
      send(first.page, "browser-first-2"),
      send(second.page, "browser-second-1"),
    ]);
    const [firstState, secondState] = await Promise.all([firstConcurrent, secondConcurrent]);
    const concurrentMs = elapsed(started);
    underTarget(concurrentMs);
    assert.deepEqual(firstState.state, secondState.state);
    assert.equal(firstState.state.value, 3);

    const duplicate = waitFor(first.page, { duplicate: true });
    await send(first.page, "browser-first-2");
    assert.equal((await duplicate).state.version, 3);

    await secondContext.close();
    const offlineUpdate = waitFor(first.page, { version: 4 });
    await send(first.page, "browser-first-3");
    await offlineUpdate;

    started = performance.now();
    const reconnectedContext = await browser.newContext();
    const reconnected = await connect(reconnectedContext, room, "second-browser-reconnected");
    const reconnectMs = elapsed(started);
    underTarget(reconnectMs);
    assert.equal(reconnected.snapshot.state.version, 4);
    assert.equal(reconnected.snapshot.state.value, 4);
    await reconnectedContext.close();

    console.log(JSON.stringify({
      browser: browser.browserType().name(),
      browserChannel,
      contexts: 2,
      targetMs: timeoutMs,
      broadcastMs,
      concurrentMs,
      reconnectMs,
      finalState: reconnected.snapshot.state,
      checks: ["browser broadcast", "concurrent ordering", "idempotency", "context reconnect snapshot"],
    }, null, 2));
  } finally {
    await firstContext.close().catch(() => {});
    await secondContext.close().catch(() => {});
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
