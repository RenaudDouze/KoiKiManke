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

/** A category id only survives if it still names a real category — never
 * trust one carried over from history or an import, since its category may
 * since have been deleted (or, for an import, never existed in this list). */
export function validCategoryId(state: ListState, id: string | null): string | null {
  if (id === null) return null;
  return state.categories.some((c) => c.id === id) ? id : null;
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
    // Favoris exemptés de l'éviction : gardés quel que soit leur lastUsed,
    // même si ça dépasse MAX_HISTORY (cas limite acceptable — l'utilisateur
    // a explicitement demandé à les garder).
    const favorites = state.history.filter((h) => h.favorite);
    const rest = state.history.filter((h) => !h.favorite).sort((a, b) => b.lastUsed - a.lastUsed);
    const keptRest = rest.slice(0, Math.max(0, MAX_HISTORY - favorites.length));
    state.history = [...favorites, ...keptRest].sort((a, b) => b.lastUsed - a.lastUsed);
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
        categoryId: validCategoryId(state, msg.categoryId),
        checked: false,
        order: nextOrder(state.items),
        createdAt: now,
        updatedAt: now,
      };
      state.items.push(item);
      return;
    }

    case "updateItem": {
      const item = state.items.find((i) => i.id === msg.id);
      if (!item) return;
      if (msg.name !== undefined) item.name = msg.name;
      if (msg.quantity !== undefined) item.quantity = msg.quantity;
      if (msg.categoryId !== undefined) item.categoryId = validCategoryId(state, msg.categoryId);
      item.updatedAt = now;
      return;
    }

    case "toggleItem": {
      const item = state.items.find((i) => i.id === msg.id);
      if (!item) return;
      const wasChecked = item.checked;
      item.checked = msg.checked;
      item.updatedAt = now;
      // La suggestion (historique) ne se retient qu'à la coche, pas à
      // l'ajout : un article ajouté puis supprimé sans avoir servi ne doit
      // pas polluer les suggestions futures.
      if (msg.checked && !wasChecked) touchHistory(state, item.name, item.categoryId, now);
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
      for (const entry of state.history) {
        if (entry.categoryId === msg.id) entry.categoryId = null;
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

    case "setCategoryColor": {
      const category = state.categories.find((c) => c.id === msg.id);
      if (!category) return;
      if (msg.color === null) {
        delete category.color;
      } else if (Number.isInteger(msg.color) && msg.color >= 0 && msg.color < 360) {
        category.color = msg.color;
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
          const mappedCategoryId = entry.categoryId ? (categoryIdMap.get(entry.categoryId) ?? null) : null;
          touchHistory(state, entry.label, mappedCategoryId, now);
        }
      }
      return;
    }

    case "deleteHistoryEntry": {
      state.history = state.history.filter((h) => h.key !== msg.key);
      return;
    }

    case "updateHistoryEntry": {
      const entry = state.history.find((h) => h.key === msg.key);
      if (!entry) return;
      if (msg.categoryId !== undefined) entry.categoryId = validCategoryId(state, msg.categoryId);
      if (msg.label !== undefined) {
        const label = msg.label.trim();
        if (label) {
          const newKey = historyKey(label);
          if (newKey !== entry.key) {
            // Renaming into another entry's name merges them instead of
            // creating a duplicate key (e.g. correcting a typo into an
            // existing suggestion).
            const collision = state.history.find((h) => h.key === newKey);
            if (collision) {
              collision.useCount += entry.useCount;
              collision.lastUsed = Math.max(collision.lastUsed, entry.lastUsed);
              state.history = state.history.filter((h) => h !== entry);
              return;
            }
            entry.key = newKey;
          }
          entry.label = label;
        }
      }
      return;
    }

    case "toggleFavoriteHistoryEntry": {
      const entry = state.history.find((h) => h.key === msg.key);
      if (!entry) return;
      entry.favorite = !entry.favorite;
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

    case "restoreHistoryEntry": {
      if (!state.history.some((h) => h.key === msg.entry.key)) {
        state.history.push(msg.entry);
      }
      return;
    }
  }
}
