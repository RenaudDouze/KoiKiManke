import type { ListState } from "../../shared/types";
import { apiUrl } from "./syncWorker";

export async function createList(name: string, isPrivate = false): Promise<ListState> {
  const res = await fetch(apiUrl("/api/lists"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, private: isPrivate }),
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
