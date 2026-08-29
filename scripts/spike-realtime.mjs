import assert from "node:assert/strict";

const baseUrl = process.env.REALTIME_SPIKE_URL ?? "http://127.0.0.1:8787";
const timeoutMs = 2_000;

class Client {
  constructor(name, room) {
    this.name = name;
    this.events = [];
    this.waiters = [];
    const url = new URL("/ws", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("room", room);
    url.searchParams.set("client", name);
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", ({ data }) => {
      const event = JSON.parse(String(data));
      this.events.push(event);
      for (const waiter of this.waiters.splice(0)) {
        if (waiter.predicate(event)) waiter.resolve(event);
        else this.waiters.push(waiter);
      }
    });
  }

  async open() {
    await Promise.race([
      new Promise((resolve, reject) => {
        this.socket.addEventListener("open", resolve, { once: true });
        this.socket.addEventListener("error", () => reject(new Error(`${this.name}: connection failed`)), { once: true });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${this.name}: connection timeout`)), timeoutMs)),
    ]);
    return this.waitFor((event) => event.type === "state" && event.snapshot);
  }

  waitFor(predicate) {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== done);
        reject(new Error(`${this.name}: state timeout`));
      }, timeoutMs);
      const done = (event) => {
        clearTimeout(timer);
        resolve(event);
      };
      this.waiters.push({ predicate, resolve: done });
    });
  }

  send(id) {
    this.socket.send(JSON.stringify({ type: "increment", id }));
  }

  close() {
    const closed = new Promise((resolve) => this.socket.addEventListener("close", resolve, { once: true }));
    this.socket.close(1000, "done");
    return closed;
  }
}

const elapsed = (start) => Math.round(performance.now() - start);
const underTarget = (value) => assert.ok(value < timeoutMs, `${value}ms exceeds ${timeoutMs}ms target`);

async function main() {
  const health = await fetch(new URL("/health", baseUrl)).catch(() => null);
  assert.equal(health?.ok, true, `Start the spike server first: npm run spike:realtime:server`);

  const room = `p07-${Date.now()}`;
  const first = new Client("first", room);
  const second = new Client("second", room);
  await Promise.all([first.open(), second.open()]);

  let started = performance.now();
  const broadcast = second.waitFor((event) => event.state?.version === 1);
  first.send("first-1");
  await broadcast;
  const broadcastMs = elapsed(started);
  underTarget(broadcastMs);

  started = performance.now();
  const firstConcurrent = first.waitFor((event) => event.state?.version === 3);
  const secondConcurrent = second.waitFor((event) => event.state?.version === 3);
  first.send("first-2");
  second.send("second-1");
  const [firstState, secondState] = await Promise.all([firstConcurrent, secondConcurrent]);
  const concurrentMs = elapsed(started);
  underTarget(concurrentMs);
  assert.deepEqual(firstState.state, secondState.state);
  assert.equal(firstState.state.value, 3);

  const duplicate = first.waitFor((event) => event.duplicate === true);
  first.send("first-2");
  assert.equal((await duplicate).state.version, 3);

  await second.close();
  const offlineUpdate = first.waitFor((event) => event.state?.version === 4);
  first.send("first-3");
  await offlineUpdate;

  started = performance.now();
  const reconnected = new Client("second-reconnected", room);
  const snapshot = await reconnected.open();
  const reconnectMs = elapsed(started);
  underTarget(reconnectMs);
  assert.equal(snapshot.state.version, 4);
  assert.equal(snapshot.state.value, 4);

  await Promise.all([first.close(), reconnected.close()]);
  console.log(JSON.stringify({
    targetMs: timeoutMs,
    broadcastMs,
    concurrentMs,
    reconnectMs,
    finalState: snapshot.state,
    checks: ["broadcast", "concurrent ordering", "idempotency", "reconnect snapshot"],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
