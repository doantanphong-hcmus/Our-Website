import { DurableObject } from "cloudflare:workers";
import { handleAuth } from "./auth";

interface RoomState {
  version: number;
  value: number;
  lastCommandId: string | null;
}

interface Env {
  REALTIME_ROOM: DurableObjectNamespace<RealtimeRoom>;
  DB: D1Database;
  AUTH_PEPPER: string;
}

const initialState: RoomState = { version: 0, value: 0, lastCommandId: null };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname.startsWith("/api/auth/")) {
      try {
        return await handleAuth(request, env) ?? new Response("Not found", { status: 404 });
      } catch {
        return Response.json({ error: "Không thể xử lý yêu cầu lúc này." }, { status: 500 });
      }
    }
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const room = url.searchParams.get("room");
    if (!room || !/^[a-z0-9-]{1,64}$/i.test(room)) {
      return new Response("Invalid room", { status: 400 });
    }
    return env.REALTIME_ROOM.getByName(room).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class RealtimeRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ client: new URL(request.url).searchParams.get("client") });
    const state = await this.ctx.storage.get<RoomState>("state") ?? initialState;
    server.send(JSON.stringify({ type: "state", state, snapshot: true }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      const command = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      if (command?.type !== "increment" || typeof command.id !== "string" || !command.id || command.id.length > 100) {
        throw new Error("Invalid command");
      }

      const result = await this.ctx.storage.transaction(async (storage) => {
        const state = await storage.get<RoomState>("state") ?? initialState;
        if (await storage.get(`command:${command.id}`)) return { state, duplicate: true };
        const next = { version: state.version + 1, value: state.value + 1, lastCommandId: command.id };
        await storage.put("state", next);
        await storage.put(`command:${command.id}`, true);
        return { state: next, duplicate: false };
      });

      const event = JSON.stringify({ type: "state", ...result });
      if (result.duplicate) return socket.send(event);
      for (const peer of this.ctx.getWebSockets()) {
        try { peer.send(event); } catch { /* disconnected peer */ }
      }
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Invalid command" }));
    }
  }
}
