// Identifiants d'objets photo dans le bucket R2 dédié (voir wrangler.json,
// worker/index.ts, worker/listRoom.ts) — jamais l'image elle-même (voir
// shared/photo.ts pour pourquoi elle vit hors du ListState).

/** Même forme que SAFE_ID dans worker/reducer.ts (alphanumérique + -/_,
 * jusqu'à 64 caractères) : généré par crypto.randomUUID() côté serveur à
 * l'upload, jamais par le client, mais revalidé partout où il finit dans un
 * chemin d'URL ou un attribut HTML (défense en profondeur, même principe que
 * SAFE_ID). */
const PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafePhotoId(value: unknown): value is string {
  return typeof value === "string" && PHOTO_ID_PATTERN.test(value);
}

export function generatePhotoId(): string {
  return crypto.randomUUID();
}

/** Clé d'objet R2, préfixée par le code de la liste : garde les photos de
 * chaque liste regroupées (utile pour un futur nettoyage par préfixe) et
 * empêche un photoId valide d'une liste de résoudre vers l'objet d'une autre
 * liste portant le même id (collision théorique seulement, uuid v4). */
export function photoObjectKey(code: string, photoId: string): string {
  return `${code}/${photoId}`;
}
