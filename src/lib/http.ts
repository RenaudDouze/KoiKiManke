import type { ListState } from "../../shared/types";
import { apiUrl } from "./syncWorker";

/** Renvoie l'URL de la photo d'un article (voir worker/index.ts) — jamais
 * appelée avant d'avoir un photoId réel (uploadé via uploadItemPhoto ci-dessous
 * ou reçu dans l'état synchronisé), donc pas de gestion d'absence ici. */
export function photoUrl(code: string, photoId: string): string {
  return apiUrl(`/api/lists/${encodeURIComponent(code)}/photos/${encodeURIComponent(photoId)}`);
}

/** Upload la photo d'un article vers le bucket R2 dédié (jamais dans le
 * ListState lui-même, voir shared/photo.ts) et renvoie son id — à envoyer
 * ensuite dans un message `updateItem` (`photoId`) pour l'associer à
 * l'article (voir src/views/list.ts). */
export async function uploadItemPhoto(code: string, file: Blob): Promise<string> {
  const res = await fetch(apiUrl(`/api/lists/${encodeURIComponent(code)}/photos`), {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error("Impossible d'envoyer la photo.");
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function createList(name: string): Promise<ListState> {
  const res = await fetch(apiUrl("/api/lists"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Impossible de créer la liste.");
  return res.json();
}

export async function fetchListState(code: string): Promise<ListState | null> {
  const res = await fetch(apiUrl(`/api/lists/${encodeURIComponent(code)}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Erreur réseau.");
  return res.json();
}
