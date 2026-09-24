/** Comparateur alphanumérique (accents et casse ignorés, nombres comparés
 * numériquement) utilisé pour trier catégories et suggestions — toujours
 * dans cet ordre, jamais un ordre manuel. */
export function alnumCompare(a: string, b: string): number {
  return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
}

/** Aplatit une chaîne pour une recherche insensible aux accents (« café »
 * trouvé en tapant « cafe » et inversement) : décompose les caractères
 * accentués en lettre de base + diacritique (NFD), puis retire les
 * diacritiques. Complète alnumCompare ci-dessus (déjà insensible aux accents
 * via `sensitivity: "base"` pour le tri) pour que recherche et tri se
 * comportent de façon cohérente vis-à-vis des accents. */
export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
