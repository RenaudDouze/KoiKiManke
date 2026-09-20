// Pure state-mutation logic for a shopping list, extracted out of the
// Durable Object class (listRoom.ts) so it can be unit-tested without any
// Workers runtime (storage, WebSockets, ctx...).

import type { ListState, ClientMessage, Item, Category, Priority } from "../shared/types";
import { parseFreeText } from "../shared/quantity";
import { historyKey } from "../shared/historyKey";
import { isSafePhotoId } from "./photos";

export const MAX_HISTORY = 300;

// Les types de ClientMessage/Item/Category ne sont vérifiés qu'à la
// compilation : rien ne garantit qu'un message reçu (JSON.parse d'une trame
// WebSocket, ou données d'un fichier importé) les respecte réellement à
// l'exécution — n'importe qui a le code de la liste peut en envoyer un
// fabriqué à la main. Les champs ci-dessous finissent dans un attribut HTML
// côté client sans échappement (data-id, data-priority, --cat-hue) : une
// valeur non validée y casserait l'attribut et permettrait d'injecter du
// HTML/JS arbitraire, exécuté chez tous les autres participants connectés.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME_LENGTH = 200;
const MAX_QUANTITY_LENGTH = 40;
const MAX_LIST_NAME_LENGTH = 100;

function safeId(id: unknown): string {
  return typeof id === "string" && SAFE_ID.test(id) ? id : crypto.randomUUID();
}

function isPriority(value: unknown): value is Priority {
  return value === 0 || value === 1 || value === 2;
}

function isValidHue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 360;
}

function safeString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/** Revalide un item importé (fichier JSON fourni par l'utilisateur, jamais
 * digne de confiance) sans changer sa forme pour les champs déjà valides —
 * seuls id/name/quantity/priority sont corrigés si besoin. */
function sanitizeImportedItem(item: Item): Item {
  const safe: Item = { ...item };
  if (!SAFE_ID.test(String(safe.id))) safe.id = crypto.randomUUID();
  safe.name = safeString(safe.name, MAX_NAME_LENGTH);
  safe.quantity = safeString(safe.quantity, MAX_QUANTITY_LENGTH);
  if (safe.priority !== undefined && !isPriority(safe.priority)) delete safe.priority;
  // Un photoId ne nomme un objet R2 réel que dans la liste qui l'a
  // uploadé (voir worker/photos.ts) : un fichier exporté/un lien compact
  // (potentiellement importé dans une tout autre liste, voir
  // src/lib/compactShare.ts) ne peut jamais en porter un valide pour sa
  // destination, donc toujours retiré plutôt que revalidé.
  delete safe.photoId;
  return safe;
}

function sanitizeImportedCategory(category: Category): Category {
  const safe: Category = { ...category };
  if (!SAFE_ID.test(String(safe.id))) safe.id = crypto.randomUUID();
  safe.name = safeString(safe.name, MAX_NAME_LENGTH);
  if (safe.color !== undefined && !isValidHue(safe.color)) delete safe.color;
  return safe;
}

export function nextOrder(list: { order: number }[]): number {
  // Boucle plutôt que Math.max(...list.map(...)) : évite d'allouer un
  // tableau intermédiaire et une pile d'arguments qui grandit avec la liste
  // (Math.max(...arr) plante au-delà de plusieurs dizaines de milliers
  // d'éléments selon le moteur).
  let max = -1;
  for (const x of list) if (x.order > max) max = x.order;
  return max + 1;
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
      if (name) state.name = name.slice(0, MAX_LIST_NAME_LENGTH);
      return;
    }

    case "addItem": {
      const { name, quantity } = parseFreeText(msg.rawText);
      if (!name) return;
      const item: Item = {
        id: safeId(msg.id),
        name: name.slice(0, MAX_NAME_LENGTH),
        quantity: quantity.slice(0, MAX_QUANTITY_LENGTH),
        categoryId: validCategoryId(state, msg.categoryId),
        checked: false,
        order: nextOrder(state.items),
        priority: 1,
        createdAt: now,
        updatedAt: now,
      };
      state.items.push(item);
      return;
    }

    case "updateItem": {
      const item = state.items.find((i) => i.id === msg.id);
      if (!item) return;
      if (msg.name !== undefined) item.name = safeString(msg.name, MAX_NAME_LENGTH);
      if (msg.quantity !== undefined) item.quantity = safeString(msg.quantity, MAX_QUANTITY_LENGTH);
      if (msg.categoryId !== undefined) item.categoryId = validCategoryId(state, msg.categoryId);
      if (msg.priority !== undefined && isPriority(msg.priority)) item.priority = msg.priority;
      if (msg.photoId !== undefined) {
        // null = retire la photo ; une chaîne invalide (message forgé à la
        // main) est ignorée plutôt que d'en inventer une nouvelle — un id
        // fabriqué ne correspondrait à aucun objet réel du bucket R2 (voir
        // worker/photos.ts), contrairement à safeId() ailleurs dans ce
        // fichier qui, lui, doit toujours produire un id d'ITEM valide.
        if (msg.photoId === null) delete item.photoId;
        else if (isSafePhotoId(msg.photoId)) item.photoId = msg.photoId;
      }
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
      const category: Category = { id: safeId(msg.id), name: name.slice(0, MAX_NAME_LENGTH), order: nextOrder(state.categories) };
      state.categories.push(category);
      return;
    }

    case "renameCategory": {
      const category = state.categories.find((c) => c.id === msg.id);
      if (!category) return;
      const name = msg.name.trim();
      if (name) category.name = name.slice(0, MAX_NAME_LENGTH);
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
      } else if (isValidHue(msg.color)) {
        category.color = msg.color;
      }
      return;
    }

    case "importState": {
      // Le fichier importé n'est jamais digne de confiance (fourni par
      // l'utilisateur, potentiellement partagé par quelqu'un d'autre) : ses
      // items/catégories passent par la même revalidation qu'un message
      // WebSocket forgé, avant d'être utilisés dans les deux modes ci-dessous.
      const items = msg.data.items.map(sanitizeImportedItem);
      const categories = msg.data.categories.map(sanitizeImportedCategory);
      if (msg.mode === "replace") {
        state.items = items;
        state.categories = categories;
        state.history = msg.data.history;
        if (msg.data.name) state.name = safeString(msg.data.name, MAX_LIST_NAME_LENGTH) || state.name;
      } else {
        const existingCategoryNames = new Map(state.categories.map((c) => [c.name.toLowerCase(), c.id]));
        const categoryIdMap = new Map<string, string | null>();
        for (const category of categories) {
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
        for (const item of items) {
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
