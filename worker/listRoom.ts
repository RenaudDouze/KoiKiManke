import { DurableObject } from "cloudflare:workers";
import type {
  ListState,
  ClientMessage,
  ServerMessage,
  Item,
  Category,
} from "../shared/types";
import { parseFreeText } from "../shared/quantity";

interface Env {
  LIST_ROOM: DurableObjectNamespace<ListRoom>;
}

const STORAGE_KEY = "state";
const MAX_HISTORY = 300;

function historyKey(name: string): string {
  return name.trim().toLowerCase();
}

export class ListRoom extends DurableObject<Env> {
  private listState: ListState | null = null;
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.listState = (await this.ctx.storage.get<ListState>(STORAGE_KEY)) ?? null;
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
      this.applyMessage(msg);
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

  private touchHistory(label: string, categoryId: string | null): void {
    const state = this.listState!;
    const key = historyKey(label);
    if (!key) return;
    const existing = state.history.find((h) => h.key === key);
    const now = Date.now();
    if (existing) {
      existing.label = label;
      existing.categoryId = categoryId ?? existing.categoryId;
      existing.useCount += 1;
      existing.lastUsed = now;
    } else {
      state.history.push({ key, label, categoryId, useCount: 1, lastUsed: now });
    }
    if (state.history.length > MAX_HISTORY) {
      state.history.sort((a, b) => b.lastUsed - a.lastUsed);
      state.history.length = MAX_HISTORY;
    }
  }

  private nextOrder(list: { order: number }[]): number {
    return list.length === 0 ? 0 : Math.max(...list.map((x) => x.order)) + 1;
  }

  private applyMessage(msg: ClientMessage): void {
    const state = this.listState!;
    const now = Date.now();

    switch (msg.type) {
      case "sync":
        return;

      case "renameList": {
        const name = msg.name.trim();
        if (name) state.name = name;
        return;
      }

      case "addItem": {
        const { name, quantity } = parseFreeText(msg.rawText);
        if (!name) return;
        const item: Item = {
          id: msg.id,
          name,
          quantity,
          categoryId: msg.categoryId,
          checked: false,
          order: this.nextOrder(state.items),
          createdAt: now,
          updatedAt: now,
        };
        state.items.push(item);
        this.touchHistory(name, msg.categoryId);
        return;
      }

      case "updateItem": {
        const item = state.items.find((i) => i.id === msg.id);
        if (!item) return;
        if (msg.name !== undefined) item.name = msg.name;
        if (msg.quantity !== undefined) item.quantity = msg.quantity;
        if (msg.categoryId !== undefined) item.categoryId = msg.categoryId;
        item.updatedAt = now;
        return;
      }

      case "toggleItem": {
        const item = state.items.find((i) => i.id === msg.id);
        if (!item) return;
        item.checked = msg.checked;
        item.updatedAt = now;
        return;
      }

      case "deleteItem": {
        state.items = state.items.filter((i) => i.id !== msg.id);
        return;
      }

      case "clearChecked": {
        state.items = state.items.filter((i) => !i.checked);
        return;
      }

      case "reorderItems": {
        const order = new Map(msg.orderedIds.map((id, idx) => [id, idx]));
        for (const item of state.items) {
          const idx = order.get(item.id);
          if (idx !== undefined) item.order = idx;
        }
        return;
      }

      case "addCategory": {
        const name = msg.name.trim();
        if (!name) return;
        const category: Category = { id: msg.id, name, order: this.nextOrder(state.categories) };
        state.categories.push(category);
        return;
      }

      case "renameCategory": {
        const category = state.categories.find((c) => c.id === msg.id);
        if (!category) return;
        const name = msg.name.trim();
        if (name) category.name = name;
        return;
      }

      case "deleteCategory": {
        state.categories = state.categories.filter((c) => c.id !== msg.id);
        for (const item of state.items) {
          if (item.categoryId === msg.id) item.categoryId = null;
        }
        return;
      }

      case "reorderCategories": {
        const order = new Map(msg.orderedIds.map((id, idx) => [id, idx]));
        for (const category of state.categories) {
          const idx = order.get(category.id);
          if (idx !== undefined) category.order = idx;
        }
        return;
      }

      case "importState": {
        if (msg.mode === "replace") {
          state.items = msg.data.items;
          state.categories = msg.data.categories;
          state.history = msg.data.history;
          if (msg.data.name) state.name = msg.data.name;
        } else {
          const existingCategoryNames = new Map(state.categories.map((c) => [c.name.toLowerCase(), c.id]));
          const categoryIdMap = new Map<string, string | null>();
          for (const category of msg.data.categories) {
            const existingId = existingCategoryNames.get(category.name.toLowerCase());
            if (existingId) {
              categoryIdMap.set(category.id, existingId);
            } else {
              const newCategory: Category = { ...category, order: this.nextOrder(state.categories) };
              state.categories.push(newCategory);
              existingCategoryNames.set(newCategory.name.toLowerCase(), newCategory.id);
              categoryIdMap.set(category.id, newCategory.id);
            }
          }
          const existingItemKeys = new Set(state.items.map((i) => historyKey(i.name)));
          for (const item of msg.data.items) {
            if (existingItemKeys.has(historyKey(item.name))) continue;
            const mappedCategory = item.categoryId ? categoryIdMap.get(item.categoryId) ?? null : null;
            state.items.push({
              ...item,
              categoryId: mappedCategory,
              order: this.nextOrder(state.items),
            });
          }
          for (const entry of msg.data.history) {
            this.touchHistory(entry.label, entry.categoryId);
          }
        }
        return;
      }
    }
  }
}
