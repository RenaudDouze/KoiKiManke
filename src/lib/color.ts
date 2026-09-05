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
