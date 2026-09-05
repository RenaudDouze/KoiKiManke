import { describe, it, expect } from "vitest";
import { applyMessage, touchHistory, nextOrder, historyKey, MAX_HISTORY } from "./reducer";
import type { ListState } from "../shared/types";

function makeState(overrides: Partial<ListState> = {}): ListState {
  return {
    code: "ABCDEF",
    name: "Liste de courses",
    items: [],
    categories: [],
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const NOW = 1_700_000_000_000;

describe("historyKey", () => {
  it("met en minuscule et retire les espaces de bord", () => {
    expect(historyKey("  Lait  ")).toBe("lait");
  });
});

describe("nextOrder", () => {
  it("vaut 0 pour une liste vide", () => {
    expect(nextOrder([])).toBe(0);
  });
  it("vaut max(order) + 1 sinon", () => {
    expect(nextOrder([{ order: 0 }, { order: 5 }, { order: 2 }])).toBe(6);
  });
});

describe("touchHistory", () => {
  it("ignore une étiquette vide", () => {
    const state = makeState();
    touchHistory(state, "   ", null, NOW);
    expect(state.history).toEqual([]);
  });

  it("crée une nouvelle entrée pour un nom inédit", () => {
    const state = makeState();
    touchHistory(state, "Lait", "cat-1", NOW);
    expect(state.history).toEqual([{ key: "lait", label: "Lait", categoryId: "cat-1", useCount: 1, lastUsed: NOW }]);
  });

  it("incrémente et met à jour une entrée existante (même casse différente)", () => {
    const state = makeState({
      history: [{ key: "lait", label: "Lait", categoryId: "cat-1", useCount: 3, lastUsed: NOW - 1000 }],
    });
    touchHistory(state, "LAIT", "cat-2", NOW);
    expect(state.history).toEqual([{ key: "lait", label: "LAIT", categoryId: "cat-2", useCount: 4, lastUsed: NOW }]);
  });

  it("conserve l'ancienne catégorie si la nouvelle est null", () => {
    const state = makeState({
      history: [{ key: "lait", label: "Lait", categoryId: "cat-1", useCount: 1, lastUsed: NOW - 1000 }],
    });
    touchHistory(state, "Lait", null, NOW);
    expect(state.history[0].categoryId).toBe("cat-1");
  });

  it("tronque à MAX_HISTORY en gardant les plus récentes", () => {
    const history = Array.from({ length: MAX_HISTORY }, (_, i) => ({
      key: `item-${i}`,
      label: `item-${i}`,
      categoryId: null,
      useCount: 1,
      lastUsed: i,
    }));
    const state = makeState({ history });
    touchHistory(state, "nouveau", null, NOW);
    expect(state.history.length).toBe(MAX_HISTORY);
    // La plus ancienne (lastUsed: 0) a dû être évincée au profit de "nouveau".
    expect(state.history.some((h) => h.key === "item-0")).toBe(false);
    expect(state.history.some((h) => h.key === "nouveau")).toBe(true);
  });
});

describe("applyMessage", () => {
  it("sync ne modifie rien", () => {
    const state = makeState();
    const before = JSON.stringify(state);
    applyMessage(state, { type: "sync" }, NOW);
    expect(JSON.stringify(state)).toBe(before);
  });

  describe("renameList", () => {
    it("renomme avec un nom non vide (trim)", () => {
      const state = makeState();
      applyMessage(state, { type: "renameList", name: "  Courses du dimanche  " }, NOW);
      expect(state.name).toBe("Courses du dimanche");
    });
    it("ignore un nom blanc", () => {
      const state = makeState({ name: "Original" });
      applyMessage(state, { type: "renameList", name: "   " }, NOW);
      expect(state.name).toBe("Original");
    });
  });

  describe("addItem", () => {
    it("ajoute un article avec quantité extraite et alimente l'historique", () => {
      const state = makeState();
      applyMessage(state, { type: "addItem", id: "i1", rawText: "2 kg pommes", categoryId: "cat-1" }, NOW);
      expect(state.items).toEqual([
        {
          id: "i1",
          name: "pommes",
          quantity: "2 kg",
          categoryId: "cat-1",
          checked: false,
          order: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      expect(state.history).toEqual([{ key: "pommes", label: "pommes", categoryId: "cat-1", useCount: 1, lastUsed: NOW }]);
    });

    it("attribue des order croissants", () => {
      const state = makeState();
      applyMessage(state, { type: "addItem", id: "i1", rawText: "lait", categoryId: null }, NOW);
      applyMessage(state, { type: "addItem", id: "i2", rawText: "pain", categoryId: null }, NOW);
      expect(state.items.map((i) => i.order)).toEqual([0, 1]);
    });

    it("n'ajoute rien si le texte ne produit aucun nom (ex: quantité seule)", () => {
      const state = makeState();
      applyMessage(state, { type: "addItem", id: "i1", rawText: "3 kg", categoryId: null }, NOW);
      expect(state.items).toEqual([]);
      expect(state.history).toEqual([]);
    });
  });

  describe("updateItem", () => {
    function withItem(): ListState {
      return makeState({
        items: [{ id: "i1", name: "Lait", quantity: "1", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
      });
    }

    it("met à jour uniquement les champs fournis", () => {
      const state = withItem();
      applyMessage(state, { type: "updateItem", id: "i1", quantity: "2 L" }, NOW);
      expect(state.items[0]).toMatchObject({ name: "Lait", quantity: "2 L", categoryId: null, updatedAt: NOW });
    });

    it("met à jour le nom quand il est fourni", () => {
      const state = withItem();
      applyMessage(state, { type: "updateItem", id: "i1", name: "Lait demi-écrémé" }, NOW);
      expect(state.items[0].name).toBe("Lait demi-écrémé");
    });

    it("permet de vider quantity/categoryId explicitement", () => {
      const state = withItem();
      applyMessage(state, { type: "updateItem", id: "i1", quantity: "", categoryId: null }, NOW);
      expect(state.items[0].quantity).toBe("");
      expect(state.items[0].categoryId).toBeNull();
    });

    it("ignore un id inconnu", () => {
      const state = withItem();
      applyMessage(state, { type: "updateItem", id: "nope", name: "X" }, NOW);
      expect(state.items[0].name).toBe("Lait");
    });
  });

  describe("toggleItem", () => {
    it("coche et décoche", () => {
      const state = makeState({
        items: [{ id: "i1", name: "Lait", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
      });
      applyMessage(state, { type: "toggleItem", id: "i1", checked: true }, NOW);
      expect(state.items[0].checked).toBe(true);
      expect(state.items[0].updatedAt).toBe(NOW);
      applyMessage(state, { type: "toggleItem", id: "i1", checked: false }, NOW + 1);
      expect(state.items[0].checked).toBe(false);
    });

    it("ignore un id inconnu", () => {
      const state = makeState();
      applyMessage(state, { type: "toggleItem", id: "nope", checked: true }, NOW);
      expect(state.items).toEqual([]);
    });
  });

  describe("deleteItem / clearChecked", () => {
    it("deleteItem retire uniquement l'article visé", () => {
      const state = makeState({
        items: [
          { id: "i1", name: "A", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 },
          { id: "i2", name: "B", quantity: "", categoryId: null, checked: false, order: 1, createdAt: 0, updatedAt: 0 },
        ],
      });
      applyMessage(state, { type: "deleteItem", id: "i1" }, NOW);
      expect(state.items.map((i) => i.id)).toEqual(["i2"]);
    });

    it("clearChecked retire tous les articles cochés", () => {
      const state = makeState({
        items: [
          { id: "i1", name: "A", quantity: "", categoryId: null, checked: true, order: 0, createdAt: 0, updatedAt: 0 },
          { id: "i2", name: "B", quantity: "", categoryId: null, checked: false, order: 1, createdAt: 0, updatedAt: 0 },
          { id: "i3", name: "C", quantity: "", categoryId: null, checked: true, order: 2, createdAt: 0, updatedAt: 0 },
        ],
      });
      applyMessage(state, { type: "clearChecked" }, NOW);
      expect(state.items.map((i) => i.id)).toEqual(["i2"]);
    });
  });

  describe("reorderItems", () => {
    it("réassigne order selon la position dans orderedIds", () => {
      const state = makeState({
        items: [
          { id: "i1", name: "A", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 },
          { id: "i2", name: "B", quantity: "", categoryId: null, checked: false, order: 1, createdAt: 0, updatedAt: 0 },
        ],
      });
      applyMessage(state, { type: "reorderItems", orderedIds: ["i2", "i1"] }, NOW);
      expect(state.items.find((i) => i.id === "i1")!.order).toBe(1);
      expect(state.items.find((i) => i.id === "i2")!.order).toBe(0);
    });

    it("laisse inchangé un article absent de orderedIds", () => {
      const state = makeState({
        items: [{ id: "i1", name: "A", quantity: "", categoryId: null, checked: false, order: 7, createdAt: 0, updatedAt: 0 }],
      });
      applyMessage(state, { type: "reorderItems", orderedIds: [] }, NOW);
      expect(state.items[0].order).toBe(7);
    });
  });

  describe("catégories", () => {
    it("addCategory ajoute avec order croissant, ignore un nom blanc", () => {
      const state = makeState();
      applyMessage(state, { type: "addCategory", id: "c1", name: "Fruits" }, NOW);
      applyMessage(state, { type: "addCategory", id: "c2", name: "  " }, NOW);
      expect(state.categories).toEqual([{ id: "c1", name: "Fruits", order: 0 }]);
    });

    it("renameCategory renomme, ignore id inconnu et nom blanc", () => {
      const state = makeState({ categories: [{ id: "c1", name: "Fruits", order: 0 }] });
      applyMessage(state, { type: "renameCategory", id: "c1", name: "Légumes" }, NOW);
      expect(state.categories[0].name).toBe("Légumes");
      applyMessage(state, { type: "renameCategory", id: "c1", name: "  " }, NOW);
      expect(state.categories[0].name).toBe("Légumes");
      applyMessage(state, { type: "renameCategory", id: "nope", name: "X" }, NOW);
      expect(state.categories[0].name).toBe("Légumes");
    });

    it("deleteCategory retire la catégorie, déplace ses articles vers null, laisse les autres intacts", () => {
      const state = makeState({
        categories: [{ id: "c1", name: "Fruits", order: 0 }],
        items: [
          { id: "i1", name: "Pommes", quantity: "", categoryId: "c1", checked: false, order: 0, createdAt: 0, updatedAt: 0 },
          { id: "i2", name: "Lait", quantity: "", categoryId: null, checked: false, order: 1, createdAt: 0, updatedAt: 0 },
        ],
      });
      applyMessage(state, { type: "deleteCategory", id: "c1" }, NOW);
      expect(state.categories).toEqual([]);
      expect(state.items.find((i) => i.id === "i1")!.categoryId).toBeNull();
      expect(state.items.find((i) => i.id === "i2")!.categoryId).toBeNull();
    });

    it("reorderCategories réassigne order, laisse inchangée une catégorie absente de orderedIds", () => {
      const state = makeState({
        categories: [
          { id: "c1", name: "A", order: 0 },
          { id: "c2", name: "B", order: 1 },
          { id: "c3", name: "C", order: 9 },
        ],
      });
      applyMessage(state, { type: "reorderCategories", orderedIds: ["c2", "c1"] }, NOW);
      expect(state.categories.find((c) => c.id === "c1")!.order).toBe(1);
      expect(state.categories.find((c) => c.id === "c2")!.order).toBe(0);
      expect(state.categories.find((c) => c.id === "c3")!.order).toBe(9);
    });
  });

  describe("importState", () => {
    it("mode replace remplace intégralement items/categories/history et le nom si fourni", () => {
      const state = makeState({
        name: "Ancienne",
        items: [{ id: "old", name: "Old", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
        categories: [{ id: "oldc", name: "OldCat", order: 0 }],
        history: [{ key: "old", label: "Old", categoryId: null, useCount: 1, lastUsed: 0 }],
      });
      const data = {
        name: "Nouvelle",
        items: [{ id: "new", name: "New", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
        categories: [{ id: "newc", name: "NewCat", order: 0 }],
        history: [{ key: "new", label: "New", categoryId: null, useCount: 1, lastUsed: 0 }],
      };
      applyMessage(state, { type: "importState", mode: "replace", data }, NOW);
      expect(state.name).toBe("Nouvelle");
      expect(state.items).toEqual(data.items);
      expect(state.categories).toEqual(data.categories);
      expect(state.history).toEqual(data.history);
    });

    it("mode replace conserve le nom actuel si data.name est vide", () => {
      const state = makeState({ name: "Ancienne" });
      applyMessage(
        state,
        { type: "importState", mode: "replace", data: { name: "", items: [], categories: [], history: [] } },
        NOW,
      );
      expect(state.name).toBe("Ancienne");
    });

    it("mode merge fusionne les catégories par nom (insensible à la casse) sans dupliquer", () => {
      const state = makeState({ categories: [{ id: "existing", name: "Fruits", order: 0 }] });
      applyMessage(
        state,
        {
          type: "importState",
          mode: "merge",
          data: {
            name: "",
            items: [],
            categories: [
              { id: "imported-fruits", name: "fruits", order: 0 },
              { id: "imported-legumes", name: "Légumes", order: 1 },
            ],
            history: [],
          },
        },
        NOW,
      );
      // "fruits" (casse différente) fusionne avec l'existant, pas de doublon.
      expect(state.categories.filter((c) => c.name.toLowerCase() === "fruits")).toHaveLength(1);
      expect(state.categories.some((c) => c.name === "Légumes")).toBe(true);
      expect(state.categories).toHaveLength(2);
    });

    it("mode merge ajoute les articles nouveaux, ignore les doublons par nom, et remappe leur catégorie importée", () => {
      const state = makeState({
        items: [{ id: "existing", name: "Lait", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
      });
      applyMessage(
        state,
        {
          type: "importState",
          mode: "merge",
          data: {
            name: "",
            items: [
              { id: "dup", name: "lait", quantity: "1L", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 },
              {
                id: "new",
                name: "Pommes",
                quantity: "",
                categoryId: "imported-cat",
                checked: false,
                order: 0,
                createdAt: 0,
                updatedAt: 0,
              },
            ],
            categories: [{ id: "imported-cat", name: "Fruits", order: 0 }],
            history: [],
          },
        },
        NOW,
      );
      // "lait" existait déjà (même nom insensible à la casse) : pas de doublon.
      expect(state.items.filter((i) => i.name.toLowerCase() === "lait")).toHaveLength(1);
      const pommes = state.items.find((i) => i.name === "Pommes")!;
      expect(pommes).toBeDefined();
      // La catégorie importée "Fruits" a été créée dans l'état courant, et
      // l'article importé pointe vers son nouvel id (pas l'id d'origine).
      const fruitsCategory = state.categories.find((c) => c.name === "Fruits")!;
      expect(fruitsCategory).toBeDefined();
      expect(pommes.categoryId).toBe(fruitsCategory.id);
    });

    it("mode merge laisse categoryId à null si l'article importé n'en a pas, ou si la catégorie importée est introuvable", () => {
      const state = makeState();
      applyMessage(
        state,
        {
          type: "importState",
          mode: "merge",
          data: {
            name: "",
            items: [
              { id: "a", name: "Sans catégorie", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 },
              {
                id: "b",
                name: "Catégorie fantôme",
                quantity: "",
                categoryId: "n-existe-pas",
                checked: false,
                order: 0,
                createdAt: 0,
                updatedAt: 0,
              },
            ],
            categories: [],
            history: [],
          },
        },
        NOW,
      );
      expect(state.items.find((i) => i.name === "Sans catégorie")!.categoryId).toBeNull();
      expect(state.items.find((i) => i.name === "Catégorie fantôme")!.categoryId).toBeNull();
    });

    it("mode merge alimente aussi l'historique à partir de data.history", () => {
      const state = makeState();
      applyMessage(
        state,
        {
          type: "importState",
          mode: "merge",
          data: { name: "", items: [], categories: [], history: [{ key: "lait", label: "Lait", categoryId: null, useCount: 5, lastUsed: 0 }] },
        },
        NOW,
      );
      expect(state.history).toEqual([{ key: "lait", label: "Lait", categoryId: null, useCount: 1, lastUsed: NOW }]);
    });
  });

  describe("restoreItems (annulation d'une suppression)", () => {
    it("réinsère un article supprimé tel quel (id, order, checked d'origine)", () => {
      const state = makeState();
      const item = {
        id: "i1",
        name: "Lait",
        quantity: "2 L",
        categoryId: "cat-1",
        checked: true,
        order: 3,
        createdAt: 111,
        updatedAt: 222,
      };
      applyMessage(state, { type: "restoreItems", items: [item] }, NOW);
      expect(state.items).toEqual([item]);
    });

    it("réinsère plusieurs articles à la fois (annulation de « vider les cochés »)", () => {
      const state = makeState();
      const items = [
        { id: "i1", name: "A", quantity: "", categoryId: null, checked: true, order: 0, createdAt: 0, updatedAt: 0 },
        { id: "i2", name: "B", quantity: "", categoryId: null, checked: true, order: 1, createdAt: 0, updatedAt: 0 },
      ];
      applyMessage(state, { type: "restoreItems", items }, NOW);
      expect(state.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    });

    it("ignore un article dont l'id existe déjà (idempotent)", () => {
      const existing = { id: "i1", name: "Lait", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 };
      const state = makeState({ items: [existing] });
      applyMessage(state, { type: "restoreItems", items: [{ ...existing, name: "Autre nom" }] }, NOW);
      expect(state.items).toEqual([existing]);
    });
  });

  describe("restoreCategory (annulation d'une suppression de catégorie)", () => {
    it("recrée la catégorie et réassigne les articles encore sans catégorie", () => {
      const state = makeState({
        items: [{ id: "i1", name: "Pommes", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
      });
      const category = { id: "cat-1", name: "Fruits", order: 0 };
      applyMessage(state, { type: "restoreCategory", category, itemIds: ["i1"] }, NOW);
      expect(state.categories).toEqual([category]);
      expect(state.items[0].categoryId).toBe("cat-1");
    });

    it("ne recrée pas la catégorie si elle existe déjà (idempotent)", () => {
      const category = { id: "cat-1", name: "Fruits", order: 0 };
      const state = makeState({ categories: [category] });
      applyMessage(state, { type: "restoreCategory", category, itemIds: [] }, NOW);
      expect(state.categories).toEqual([category]);
    });

    it("ne reprend pas un article que l'utilisateur a réassigné entre-temps", () => {
      const state = makeState({
        items: [{ id: "i1", name: "Pommes", quantity: "", categoryId: "cat-2", checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
      });
      const category = { id: "cat-1", name: "Fruits", order: 0 };
      applyMessage(state, { type: "restoreCategory", category, itemIds: ["i1"] }, NOW);
      // L'article a été réassigné à "cat-2" pendant la fenêtre d'annulation :
      // la restauration ne doit pas l'arracher à ce nouveau choix.
      expect(state.items[0].categoryId).toBe("cat-2");
    });
  });
});
