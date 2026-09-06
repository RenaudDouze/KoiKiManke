import { describe, it, expect } from "vitest";
import { DEFAULT_CATEGORY_NAMES, buildDefaultCategories, seedMissingDefaultCategories } from "./defaultCategories";
import type { ListState } from "./types";

describe("buildDefaultCategories", () => {
  it("crée une catégorie par nom par défaut, avec un id fourni, un ordre croissant et isDefault=true", () => {
    let n = 0;
    const categories = buildDefaultCategories(() => `id-${n++}`);
    expect(categories).toHaveLength(DEFAULT_CATEGORY_NAMES.length);
    categories.forEach((c, i) => {
      expect(c).toEqual({ id: `id-${i}`, name: DEFAULT_CATEGORY_NAMES[i], order: i, isDefault: true });
    });
  });

  it("décale l'ordre des catégories via startOrder", () => {
    const categories = buildDefaultCategories(() => "id", 5);
    expect(categories.map((c) => c.order)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});

function makeState(categories: ListState["categories"], defaultCategoriesSeeded?: boolean): ListState {
  return {
    code: "abc",
    name: "Liste",
    items: [],
    categories,
    history: [],
    createdAt: 0,
    updatedAt: 0,
    defaultCategoriesSeeded,
  };
}

describe("seedMissingDefaultCategories", () => {
  it("ajoute les rayons par défaut à la suite des catégories existantes d'une liste jamais migrée", () => {
    let n = 0;
    const state = makeState([{ id: "custom", name: "Bricolage", order: 2 }]);
    seedMissingDefaultCategories(state, () => `id-${n++}`);
    expect(state.defaultCategoriesSeeded).toBe(true);
    expect(state.categories).toHaveLength(1 + DEFAULT_CATEGORY_NAMES.length);
    expect(state.categories[0]).toEqual({ id: "custom", name: "Bricolage", order: 2 });
    expect(state.categories[1]).toEqual({ id: "id-0", name: DEFAULT_CATEGORY_NAMES[0], order: 3, isDefault: true });
  });

  it("part de l'ordre 0 si la liste n'avait encore aucune catégorie", () => {
    let n = 0;
    const state = makeState([]);
    seedMissingDefaultCategories(state, () => `id-${n++}`);
    expect(state.categories[0].order).toBe(0);
  });

  it("ne fait rien si la liste a déjà été migrée, même si les rayons ont depuis été supprimés", () => {
    const state = makeState([{ id: "custom", name: "Bricolage", order: 0 }], true);
    seedMissingDefaultCategories(state, () => "should-not-be-called");
    expect(state.categories).toHaveLength(1);
    expect(state.defaultCategoriesSeeded).toBe(true);
  });
});
