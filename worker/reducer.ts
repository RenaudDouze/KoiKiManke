// Pure state-mutation logic for a shopping list, extracted out of the
// Durable Object class (listRoom.ts) so it can be unit-tested without any
// Workers runtime (storage, WebSockets, ctx...).

import type { ListState, ClientMessage, Item, Category } from "../shared/types";
import { parseFreeText } from "../shared/quantity";

export const MAX_HISTORY = 300;

export function historyKey(name: string): string {
  return name.trim().toLowerCase();
}

export function nextOrder(list: { order: number }[]): number {
  return list.length === 0 ? 0 : Math.max(...list.map((x) => x.order)) + 1;
}

export function touchHistory(state: ListState, label: string, categoryId: string | null, now: number = Date.now()): void {
  const key = historyKey(label);
  if (!key) return;
  const existing = state.history.find((h) => h.key === key);
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

/** Mutates `state` in place to apply one client message. */
export function applyMessage(state: ListState, msg: ClientMessage, now: number = Date.now()): void {
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
        order: nextOrder(state.items),
        createdAt: now,
        updatedAt: now,
      };
      state.items.push(item);
      touchHistory(state, name, msg.categoryId, now);
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
      const category: Category = { id: msg.id, name, order: nextOrder(state.categories) };
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
            const newCategory: Category = { ...category, order: nextOrder(state.categories) };
            state.categories.push(newCategory);
            existingCategoryNames.set(newCategory.name.toLowerCase(), newCategory.id);
            categoryIdMap.set(category.id, newCategory.id);
          }
        }
        const existingItemKeys = new Set(state.items.map((i) => historyKey(i.name)));
        for (const item of msg.data.items) {
          if (existingItemKeys.has(historyKey(item.name))) continue;
          const mappedCategory = item.categoryId ? (categoryIdMap.get(item.categoryId) ?? null) : null;
          state.items.push({
            ...item,
            categoryId: mappedCategory,
            order: nextOrder(state.items),
          });
        }
        for (const entry of msg.data.history) {
          touchHistory(state, entry.label, entry.categoryId, now);
        }
      }
      return;
    }

    case "restoreItems": {
      const existingIds = new Set(state.items.map((i) => i.id));
      for (const item of msg.items) {
        if (!existingIds.has(item.id)) state.items.push(item);
      }
      return;
    }

    case "restoreCategory": {
      if (!state.categories.some((c) => c.id === msg.category.id)) {
        state.categories.push(msg.category);
      }
      const restoredIds = new Set(msg.itemIds);
      for (const item of state.items) {
        // Only reclaims items still uncategorized: if the user manually
        // reassigned one elsewhere during the undo window, that choice wins.
        if (restoredIds.has(item.id) && item.categoryId === null) item.categoryId = msg.category.id;
      }
      return;
    }
  }
}
