// Types shared between the worker (Durable Object) and the client app.

export interface Category {
  id: string;
  name: string;
  order: number;
  /** Hue (0-359) chosen by the user, from a curated palette (see
   * src/views/list.ts's colorPaletteHtml). Unset = automatic, deterministic
   * hue derived from the category id (see src/lib/color.ts). */
  color?: number;
}

export interface Item {
  id: string;
  /** Item name with any leading/trailing quantity already stripped out. */
  name: string;
  /** Free-form quantity label, e.g. "2", "500 g", "x3". Empty string = none. */
  quantity: string;
  categoryId: string | null;
  checked: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  /** Lowercased, trimmed item name used as a dedupe key. */
  key: string;
  /** Last display name used (keeps original casing). */
  label: string;
  categoryId: string | null;
  useCount: number;
  lastUsed: number;
  /** Exempts the entry from the MAX_HISTORY eviction (see worker/reducer.ts). */
  favorite?: boolean;
}

export interface ListState {
  code: string;
  name: string;
  items: Item[];
  categories: Category[];
  history: HistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

export type ClientMessage =
  | { type: "sync" }
  | { type: "renameList"; name: string }
  | { type: "addItem"; id: string; rawText: string; categoryId: string | null }
  | { type: "updateItem"; id: string; name?: string; quantity?: string; categoryId?: string | null }
  | { type: "toggleItem"; id: string; checked: boolean }
  | { type: "deleteItem"; id: string }
  | { type: "clearChecked" }
  | { type: "reorderItems"; orderedIds: string[] }
  | { type: "addCategory"; id: string; name: string }
  | { type: "renameCategory"; id: string; name: string }
  | { type: "deleteCategory"; id: string }
  | { type: "reorderCategories"; orderedIds: string[] }
  | { type: "setCategoryColor"; id: string; color: number | null }
  | { type: "importState"; mode: "merge" | "replace"; data: Pick<ListState, "items" | "categories" | "history" | "name"> }
  | { type: "deleteHistoryEntry"; key: string }
  | { type: "updateHistoryEntry"; key: string; label?: string; categoryId?: string | null }
  | { type: "toggleFavoriteHistoryEntry"; key: string }
  // Compensating actions for the client-side undo stack (see src/views/list.ts):
  // re-insert exactly what a previous deleteItem/clearChecked/deleteCategory/
  // deleteHistoryEntry removed, rather than re-deriving it (which would lose
  // the original id/order/checked/useCount/lastUsed state).
  | { type: "restoreItems"; items: Item[] }
  | { type: "restoreCategory"; category: Category; itemIds: string[] }
  | { type: "restoreHistoryEntry"; entry: HistoryEntry };

export type ServerMessage =
  | { type: "state"; state: ListState }
  /** Ephemeral, never persisted: the display names of every WebSocket
   * currently connected to this list (see worker/listRoom.ts). */
  | { type: "presence"; names: string[] }
  | { type: "error"; message: string };

export const UNCATEGORIZED = null;
