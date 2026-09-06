/** Comparateur alphanumérique (accents et casse ignorés, nombres comparés
 * numériquement) utilisé pour trier catégories et suggestions — toujours
 * dans cet ordre, jamais un ordre manuel. */
export function alnumCompare(a: string, b: string): number {
  return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
}
