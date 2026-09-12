import { DurableObject } from "cloudflare:workers";
import type { ListState, ClientMessage, ServerMessage } from "../shared/types";
import { applyMessage } from "./reducer";
import { sanitizeParticipantName } from "./presence";
import { encryptJson, decryptJson, type EncryptedPayload } from "./crypto";

interface ConnectionAttachment {
  name: string;
}

interface Env {
  LIST_ROOM: DurableObjectNamespace<ListRoom>;
}

const STORAGE_KEY = "state";

/** Every list is stored encrypted (see worker/crypto.ts) — everything but the
 * `encrypted` marker itself is opaque ciphertext. The plain-ListState variant
 * only still matters for reading lists persisted before encryption became
 * unconditional: the next write to one of those re-persists it encrypted,
 * so this is a one-way, lazy migration with no explicit step needed. */
type StoredRecord = ListState | ({ encrypted: true } & EncryptedPayload);

export class ListRoom extends DurableObject<Env> {
  private listState: ListState | null = null;
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const raw = (await this.ctx.storage.get<StoredRecord>(STORAGE_KEY)) ?? null;
    if (raw && "encrypted" in raw) {
      // The code is never in the encrypted payload itself (chicken-and-egg) —
      // it's the Durable Object's own name, since every instance is looked
      // up via idFromName(code) (see worker/index.ts).
      const code = this.ctx.id.name!;
      this.listState = await decryptJson<ListState>(code, raw);
    } else {
      this.listState = raw;
    }
    this.loaded = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();

    // Routing is based on method/headers rather than pathname: the worker
    // forwards the original client request unchanged for WebSocket upgrades
    // (needed for the upgrade handshake to work), so this DO never sees a
    // predictable path.
    if (request.headers.get("Upgrade") === "websocket") {
      if (!this.listState) return new Response("not found", { status: 404 });
      const name = sanitizeParticipantName(new URL(request.url).searchParams.get("name"));
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ name } satisfies ConnectionAttachment);
      server.send(JSON.stringify({ type: "state", state: this.listState } satisfies ServerMessage));
      this.broadcastPresence();
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
          categories: [],
          history: [],
          createdAt: now,
          updatedAt: now,
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
    this.broadcastPresence(ws);
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

  /** Broadcasts the list of currently-connected participant names. `excluding`
   * defensively drops a socket that's in the middle of closing — the runtime
   * usually already excludes it from getWebSockets() by the time
   * webSocketClose runs, but this guards against relying on that ordering. */
  private broadcastPresence(excluding?: WebSocket): void {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== excluding);
    const names = sockets.map((ws) => (ws.deserializeAttachment() as ConnectionAttachment | null)?.name ?? "Invité");
    const payload = JSON.stringify({ type: "presence", names } satisfies ServerMessage);
    for (const ws of sockets) {
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
    const payload = await encryptJson(this.listState.code, this.listState);
    await this.ctx.storage.put<StoredRecord>(STORAGE_KEY, { encrypted: true, ...payload });
  }
}
