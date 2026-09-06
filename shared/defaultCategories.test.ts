import { describe, it, expect } from "vitest";
import { DEFAULT_CATEGORY_NAMES, buildDefaultCategories } from "./defaultCategories";

describe("buildDefaultCategories", () => {
  it("crée une catégorie par nom par défaut, avec un id fourni, un ordre croissant et isDefault=true", () => {
    let n = 0;
    const categories = buildDefaultCategories(() => `id-${n++}`);
    expect(categories).toHaveLength(DEFAULT_CATEGORY_NAMES.length);
    categories.forEach((c, i) => {
      expect(c).toEqual({ id: `id-${i}`, name: DEFAULT_CATEGORY_NAMES[i], order: i, isDefault: true });
    });
  });
});
