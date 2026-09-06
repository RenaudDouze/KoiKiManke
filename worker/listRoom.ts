import { DurableObject } from "cloudflare:workers";
import type { ListState, ClientMessage, ServerMessage } from "../shared/types";
import { applyMessage } from "./reducer";
import { buildDefaultCategories, seedMissingDefaultCategories } from "../shared/defaultCategories";

interface Env {
  LIST_ROOM: DurableObjectNamespace<ListRoom>;
}

const STORAGE_KEY = "state";

export class ListRoom extends DurableObject<Env> {
  private listState: ListState | null = null;
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.listState = (await this.ctx.storage.get<ListState>(STORAGE_KEY)) ?? null;
    this.loaded = true;
    if (this.listState && !this.listState.defaultCategoriesSeeded) {
      seedMissingDefaultCategories(this.listState, () => crypto.randomUUID());
      await this.persist();
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();

    // Routing is based on method/headers rather than pathname: the worker
    // forwards the original client request unchanged for WebSocket upgrades
    // (needed for the upgrade handshake to work), so this DO never sees a
    // predictable path.
    if (request.headers.get("Upgrade") === "websocket") {
      if (!this.listState) return new Response("not found", { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "state", state: this.listState } satisfies ServerMessage));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST") {
      if (!this.listState) {
        const body = await request.json<{ code: string; name?: string }>();
        const now = Date.now();
        this.listState = {
          code: body.code,
          name: (body.name || "Liste de courses").trim() || "Liste de courses",
          items: [],
          categories: buildDefaultCategories(() => crypto.randomUUID()),
          history: [],
          createdAt: now,
          updatedAt: now,
          defaultCategoriesSeeded: true,
        };
        await this.persist();
      }
      return Response.json(this.listState);
    }

    if (!this.listState) return new Response("not found", { status: 404 });
    return Response.json(this.listState);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureLoaded();
    if (!this.listState || typeof message !== "string") return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    try {
      applyMessage(this.listState, msg);
      await this.persist();
      this.broadcast();
    } catch (err) {
      ws.send(
        JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Erreur inconnue" } satisfies ServerMessage),
      );
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  async webSocketError(_ws: WebSocket): Promise<void> {}

  private broadcast(): void {
    const payload = JSON.stringify({ type: "state", state: this.listState! } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // ignore dead sockets, hibernation API cleans them up
      }
    }
  }

  private async persist(): Promise<void> {
    if (!this.listState) return;
    this.listState.updatedAt = Date.now();
    await this.ctx.storage.put(STORAGE_KEY, this.listState);
  }
}
