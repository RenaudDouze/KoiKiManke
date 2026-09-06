import type { Category } from "./types";

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
 * l'identifiant de chaque catégorie (ex: crypto.randomUUID côté worker). */
export function buildDefaultCategories(makeId: () => string): Category[] {
  return DEFAULT_CATEGORY_NAMES.map((name, order) => ({
    id: makeId(),
    name,
    order,
    isDefault: true,
  }));
}
