import type { Category, ListState } from "./types";

// Rayons proposés par défaut à la création d'une liste, inspirés de
// l'organisation classique des grandes surfaces — pour retrouver d'emblée
// une structure familière plutôt que de partir d'une liste de catégories
// vide. Une catégorie sans article reste masquée dans la liste (voir
// renderCategories dans src/views/list.ts), donc en proposer plusieurs par
// défaut n'encombre rien tant qu'elles ne servent pas.
export const DEFAULT_CATEGORY_NAMES: readonly string[] = [
  "Fruits & Légumes",
  "Boucherie & Poissonnerie",
  "Crèmerie",
  "Boulangerie & Pâtisserie",
  "Épicerie salée",
  "Épicerie sucrée",
  "Surgelés",
  "Boissons",
  "Hygiène & Beauté",
  "Entretien & Maison",
  "Bébé",
  "Animalerie",
];

/** Construit les rayons par défaut d'une nouvelle liste. `makeId` fournit
 * l'identifiant de chaque catégorie (ex: crypto.randomUUID côté worker).
 * `startOrder` décale leur `order` (utile pour les ajouter après des
 * catégories déjà existantes, voir seedMissingDefaultCategories). */
export function buildDefaultCategories(makeId: () => string, startOrder = 0): Category[] {
  return DEFAULT_CATEGORY_NAMES.map((name, i) => ({
    id: makeId(),
    name,
    order: startOrder + i,
    isDefault: true,
  }));
}

/** Migration pour les listes créées avant l'introduction des rayons par
 * défaut : les ajoute une seule fois, à la suite des catégories déjà
 * présentes. N'a aucun effet si la liste les a déjà (y compris si
 * l'utilisateur les a ensuite toutes supprimées). */
export function seedMissingDefaultCategories(state: ListState, makeId: () => string): void {
  if (state.defaultCategoriesSeeded) return;
  state.defaultCategoriesSeeded = true;
  const startOrder = state.categories.length === 0 ? 0 : Math.max(...state.categories.map((c) => c.order)) + 1;
  state.categories.push(...buildDefaultCategories(makeId, startOrder));
}
