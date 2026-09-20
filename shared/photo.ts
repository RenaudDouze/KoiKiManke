// Constantes partagées entre le Worker (validation à l'upload, voir
// worker/index.ts) et le client (pré-validation avant l'envoi, voir
// src/views/list.ts) pour la photo d'un article, stockée dans un bucket R2
// séparé de l'état de la liste (voir worker/photos.ts) — jamais en base64
// dans le ListState : l'état entier est rediffusé à chaque mutation (voir
// CLAUDE.md), une photo y gonflerait chaque diffusion WebSocket et le cache
// localStorage pour tous les appareils, même ceux qui ne la regardent jamais.

/** Généreux pour une photo de téléphone non compressée côté client (pas de
 * redimensionnement/recompression avant l'envoi dans cette première
 * version) : plafonne surtout un abus (script forgé à la main), pas l'usage
 * normal. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export function isAllowedPhotoType(contentType: string | null | undefined): boolean {
  // Stryker disable next-line ConditionalExpression: équivalent — includes()
  // n'utilise que l'égalité stricte contre des chaînes ; aucune valeur
  // non-chaîne ne peut jamais correspondre, avec ou sans ce garde-fou
  // typeof. Il ne fait que documenter l'intention (rejeter tout de suite un
  // type non-chaîne) plutôt que changer un résultat observable.
  return typeof contentType === "string" && (ALLOWED_PHOTO_TYPES as readonly string[]).includes(contentType);
}
