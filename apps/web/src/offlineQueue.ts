export type OfflineQueueStatus = "queued" | "retrying" | "sent" | "conflict" | "failed" | "idle";

export interface OfflineQueueEventDetail {
  status: OfflineQueueStatus;
  commandId?: string;
  response?: unknown;
}

interface StoredCommand {
  id: string;
  userId: string;
  path: string;
  body: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  blocked?: boolean;
}

const eventName = "our:offline-queue";
const databaseName = "our-website-offline";
const storeName = "commands";
const sessionPath = /^\/api\/sessions(?:\/[0-9a-f-]{36}\/(?:join|decline|cancel|complete|food-result))?$/i;
let activeUserId: string | null = null;
let databasePromise: Promise<IDBDatabase> | null = null;
let running = false;
let retryTimer: number | undefined;

function database(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function allCommands(): Promise<StoredCommand[]> {
  return requestResult((await database()).transaction(storeName).objectStore(storeName).getAll());
}

async function put(command: StoredCommand): Promise<void> {
  const transaction = (await database()).transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(command);
  await transactionDone(transaction);
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function remove(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const transaction = (await database()).transaction(storeName, "readwrite");
  for (const id of ids) transaction.objectStore(storeName).delete(id);
  await transactionDone(transaction);
}

function emit(detail: OfflineQueueEventDetail): void {
  window.dispatchEvent(new CustomEvent<OfflineQueueEventDetail>(eventName, { detail }));
}

async function blockRemaining(userId: string): Promise<void> {
  for (const command of await allCommands()) {
    if (command.userId === userId) await put({ ...command, blocked: true });
  }
}

function schedule(delay: number): void {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void flushOfflineCommands(), delay);
}

export async function flushOfflineCommands(): Promise<void> {
  if (running || !activeUserId) return;
  running = true;
  try {
    const userId = activeUserId;
    const commands = (await allCommands())
      .filter((command) => command.userId === userId)
      .sort((left, right) => left.createdAt - right.createdAt);
    if (!commands.length) return;
    if (commands.some((command) => command.blocked)) return emit({ status: "conflict" });
    if (!navigator.onLine) return emit({ status: "queued", commandId: commands[0].id });

    for (const command of commands) {
      if (activeUserId !== userId) return;
      const wait = command.nextAttemptAt - Date.now();
      if (wait > 0) return schedule(wait);
      let response: Response;
      try {
        response = await fetch(command.path, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command.body),
        });
      } catch {
        const delay = Math.min(60_000, 1_000 * 2 ** command.attempts);
        await put({ ...command, attempts: command.attempts + 1, nextAttemptAt: Date.now() + delay });
        emit({ status: "retrying", commandId: command.id });
        return schedule(delay);
      }

      const payload: unknown = await response.clone().json().catch(() => null);
      if (response.ok) {
        await remove([command.id]);
        emit({ status: "sent", commandId: command.id, response: payload });
        continue;
      }
      if (response.status === 409) {
        await remove([command.id]);
        await blockRemaining(userId);
        emit({ status: "conflict", commandId: command.id, response: payload });
        return;
      }
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(60_000, retryAfter * 1_000)
          : Math.min(60_000, 1_000 * 2 ** command.attempts);
        await put({ ...command, attempts: command.attempts + 1, nextAttemptAt: Date.now() + delay });
        emit({ status: "retrying", commandId: command.id, response: payload });
        return schedule(delay);
      }
      await remove([command.id]);
      await blockRemaining(userId);
      emit({ status: "failed", commandId: command.id, response: payload });
      return;
    }
  } finally {
    running = false;
  }
}

export async function queueSessionCommand(path: string, input: Record<string, unknown>): Promise<{ id: string; idempotencyKey: string }> {
  if (!activeUserId) throw new Error("Cần đăng nhập trước khi lưu thao tác.");
  if (!sessionPath.test(path)) throw new Error("Chỉ lệnh phiên mới được lưu offline.");
  const id = crypto.randomUUID();
  const suppliedKey = input.idempotencyKey;
  const idempotencyKey = typeof suppliedKey === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(suppliedKey) ? suppliedKey : id;
  const body = JSON.parse(JSON.stringify({ ...input, idempotencyKey })) as Record<string, unknown>;
  if (new TextEncoder().encode(JSON.stringify(body)).length > 4096) throw new Error("Thao tác quá lớn để lưu offline.");
  if ((await allCommands()).filter((command) => command.userId === activeUserId).length >= 100) {
    throw new Error("Có quá nhiều thao tác đang chờ đồng bộ.");
  }
  await put({ id, userId: activeUserId, path, body, attempts: 0, nextAttemptAt: 0, createdAt: performance.timeOrigin + performance.now() });
  emit({ status: "queued", commandId: id });
  void flushOfflineCommands();
  return { id, idempotencyKey };
}

export function startOfflineQueue(userId: string): void {
  activeUserId = userId;
  void flushOfflineCommands();
}

export function stopOfflineQueue(): void {
  activeUserId = null;
  window.clearTimeout(retryTimer);
}

export async function discardOfflineCommands(): Promise<void> {
  if (!activeUserId) return;
  await remove((await allCommands()).filter((command) => command.userId === activeUserId).map((command) => command.id));
  emit({ status: "idle" });
}

export async function offlineCommandCount(): Promise<number> {
  return (await allCommands()).filter((command) => command.userId === activeUserId).length;
}

window.addEventListener("online", () => void flushOfflineCommands());
