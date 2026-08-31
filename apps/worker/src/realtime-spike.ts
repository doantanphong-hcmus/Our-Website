import { DurableObject } from "cloudflare:workers";
import { authenticatedUser, handleAuth } from "./auth";
import { handleSessions, sessionSnapshot } from "./sessions";

interface Env {
  REALTIME_ROOM: DurableObjectNamespace<RealtimeRoom>;
  DB: D1Database;
  AUTH_PEPPER: string;
}

function unauthorized(): Response {
  return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, {
    status: 401, headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname.startsWith("/api/auth/")) {
      try {
        const revokesSockets = request.method === "POST"
          && ["/api/auth/logout", "/api/auth/change-password"].includes(url.pathname);
        const auth = revokesSockets ? await authenticatedUser(request, env) : null;
        const response = await handleAuth(request, env) ?? new Response("Not found", { status: 404 });
        if (auth && response.ok) {
          await env.REALTIME_ROOM.getByName(auth.user.couple_space_id).fetch(new Request("https://internal/revoke", {
            method: "POST", headers: { "X-User-Id": auth.user.id },
          }));
        }
        return response;
      } catch {
        return Response.json({ error: "Không thể xử lý yêu cầu lúc này." }, { status: 500 });
      }
    }

    const isSessions = url.pathname === "/api/sessions" || url.pathname.startsWith("/api/sessions/");
    const isSocket = url.pathname === "/ws";
    if (isSessions || isSocket) {
      try {
        if (isSocket && request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return new Response("Expected WebSocket upgrade", { status: 426 });
        }
        const auth = await authenticatedUser(request, env);
        if (!auth) return unauthorized();
        if (isSessions && request.method === "GET") return handleSessions(request, env);
        return env.REALTIME_ROOM.getByName(auth.user.couple_space_id).fetch(request);
      } catch {
        return Response.json({ error: "Không thể xử lý yêu cầu lúc này." }, { status: 500 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export class RealtimeRoom extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => {});
    return result;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/internal/revoke") {
      const userId = request.headers.get("X-User-Id");
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as { userId?: string } | null;
        if (attachment?.userId !== userId) continue;
        try {
          socket.close(4401, "Session expired");
        } catch { /* disconnected socket */ }
      }
      return new Response(null, { status: 204 });
    }
    if (path === "/ws") {
      const auth = await authenticatedUser(request, this.env);
      if (!auth) return unauthorized();
      return this.serialize(() => this.connect(request, auth.user.id, auth.user.couple_space_id, auth.tokenHash));
    }
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    return this.serialize(() => this.command(request));
  }

  private async connect(request: Request, userId: string, spaceId: string, tokenHash: string): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, tokenHash });
    const lastEvent = Number(new URL(request.url).searchParams.get("lastEvent") ?? 0);
    const snapshot = await sessionSnapshot(this.env, spaceId);
    server.send(JSON.stringify({
      type: "session.snapshot",
      ...snapshot,
      reconciled: !Number.isSafeInteger(lastEvent) || lastEvent < 0 || lastEvent !== snapshot.eventVersion,
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async command(request: Request): Promise<Response> {
    const response = await handleSessions(request, this.env);
    if (!response.ok) return response;
    const payload = await response.clone().json<{ session?: unknown; duplicate?: boolean }>();
    if (!payload.session || payload.duplicate) return response;
    const auth = await authenticatedUser(request, this.env);
    if (!auth) return response;
    const latest = await this.env.DB.prepare(`SELECT coalesce(max(rowid), 0) AS version
      FROM activity_session_events WHERE couple_space_id = ?`)
      .bind(auth.user.couple_space_id).first<{ version: number }>();
    const eventVersion = Number(latest?.version ?? 0);
    const event = JSON.stringify({ type: "session.updated", eventVersion, session: payload.session });
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return response;
    const now = Math.floor(Date.now() / 1000);
    const validity = await this.env.DB.batch(sockets.map((socket) => {
      const attachment = socket.deserializeAttachment() as { tokenHash?: string } | null;
      return this.env.DB.prepare(`SELECT 1 FROM auth_sessions WHERE token_hash = ?
        AND revoked_at IS NULL AND expires_at > ? AND idle_expires_at > ?`)
        .bind(attachment?.tokenHash ?? "", now, now);
    }));
    for (let index = 0; index < sockets.length; index++) {
      try {
        if (validity[index].results.length) sockets[index].send(event);
        else sockets[index].close(4401, "Session expired");
      } catch { /* disconnected socket */ }
    }
    return response;
  }

  webSocketMessage(socket: WebSocket): void {
    socket.send(JSON.stringify({ type: "error", error: "Commands must use the authenticated REST API." }));
  }
}
