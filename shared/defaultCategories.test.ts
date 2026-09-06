import { describe, it, expect } from "vitest";
import { DEFAULT_CATEGORY_NAMES, buildDefaultCategories, seedMissingDefaultCategories } from "./defaultCategories";
import type { ListState } from "./types";

describe("buildDefaultCategories", () => {
  it("crée une catégorie par nom par défaut, avec un id fourni et isDefault=true", () => {
    let n = 0;
    const categories = buildDefaultCategories(() => `id-${n++}`);
    expect(categories).toHaveLength(DEFAULT_CATEGORY_NAMES.length);
    categories.forEach((c, i) => {
      expect(c).toEqual({ id: `id-${i}`, name: DEFAULT_CATEGORY_NAMES[i], isDefault: true });
    });
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
    const state = makeState([{ id: "custom", name: "Bricolage" }]);
    seedMissingDefaultCategories(state, () => `id-${n++}`);
    expect(state.defaultCategoriesSeeded).toBe(true);
    expect(state.categories).toHaveLength(1 + DEFAULT_CATEGORY_NAMES.length);
    expect(state.categories[0]).toEqual({ id: "custom", name: "Bricolage" });
    expect(state.categories[1]).toEqual({ id: "id-0", name: DEFAULT_CATEGORY_NAMES[0], isDefault: true });
  });

  it("ne fait rien si la liste a déjà été migrée, même si les rayons ont depuis été supprimés", () => {
    const state = makeState([{ id: "custom", name: "Bricolage" }], true);
    seedMissingDefaultCategories(state, () => "should-not-be-called");
    expect(state.categories).toHaveLength(1);
    expect(state.defaultCategoriesSeeded).toBe(true);
  });
});
