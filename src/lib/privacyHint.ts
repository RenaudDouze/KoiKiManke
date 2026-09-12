// Repris à l'identique partout où des données sont saisies/enregistrées
// (ajout d'article, catégories, suggestions, partage, bas de la liste) :
// items, catégories et historique font tous partie du même ListState,
// chiffré ou non en bloc selon .private (voir worker/listRoom.ts) — le
// message doit donc être cohérent partout, pas seulement là où le mode
// privé est activé.
export function privacyHint(isPrivate: boolean | undefined): string {
  return isPrivate
    ? "Mode privé activé : les données sont chiffrées sur le serveur. Toute personne avec le code peut malgré tout voir et modifier la liste normalement."
    : "Les données ne sont ni chiffrées ni protégées : n'y mets rien de privé ou de sensible.";
}
