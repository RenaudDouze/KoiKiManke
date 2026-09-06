import type { Category } from "../../shared/types";

/** Deterministic hue (0-359) for a category id, used for a subtle per-category
 * accent (dot + left border) — same id always gets the same color, without
 * needing to store one explicitly. */
export function categoryHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** The hue actually used for a category: the user's manual choice
 * (Category.color) if set, otherwise the automatic one derived from its id. */
export function resolveCategoryHue(category: Category): number {
  return category.color ?? categoryHue(category.id);
}
