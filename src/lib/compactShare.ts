// Lien/QR "aperçu compact" : encode un instantané figé de l'état d'une liste
// (nom, articles, catégories, historique — même forme que l'export JSON, voir
// ImportPayload dans importExport.ts) dans le paramètre d'URL `?import=`,
// compressé (lz-string) pour rester raisonnablement court même avec beaucoup
// d'articles (jusqu'à MAX_ITEMS_PER_LIST, voir worker/index.ts). Contrairement
// au code/QR de la liste elle-même (voir shareModal.ts), ouvrir ce lien ne
// rejoint pas le Durable Object en direct : tout se décode côté client, sans
// appel réseau, avant de repasser par le même flux d'import fusion/remplacement
// que pour un fichier JSON (voir src/views/list.ts) — le paramètre décodé n'est
// donc jamais appliqué directement à un état, et reste soumis à la même
// revalidation serveur (`sanitizeImportedItem`/`sanitizeImportedCategory` dans
// worker/reducer.ts) qu'un message WebSocket forgé à la main ou un fichier
// importé : il n'est pas plus digne de confiance que ces deux-là.
import * as LZString from "lz-string";
import type { ImportPayload } from "./importExport";

export const IMPORT_PARAM = "import";

export function encodeListToParam(data: ImportPayload): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(data));
}

/** Même niveau de validation que parseImportFile (importExport.ts) : juste la
 * forme de premier niveau (items/categories sont bien des tableaux). Le
 * contenu de chaque item/catégorie n'est pas revalidé ici — il l'est de toute
 * façon côté serveur au moment de l'`importState` qui suit (voir l'en-tête de
 * ce fichier), exactement comme pour un fichier JSON importé. */
function isImportPayload(value: unknown): value is Partial<ImportPayload> {
  // Stryker disable next-line ConditionalExpression, LogicalOperator:
  // équivalent — le seul appelant (decodeListFromParam) englobe cet appel
  // dans un try/catch : sans ce garde-fou, un `value` nullish ferait lever
  // `Array.isArray(v.items)` juste en dessous (accès de propriété sur
  // null/undefined), rattrapé par ce même try/catch avec le même résultat
  // final (`null`) ; et un `value` non-nullish mais non-objet (nombre,
  // chaîne, booléen) n'a simplement pas de propriété `items`/`categories`,
  // donc `Array.isArray(undefined)` retombe déjà sur `false` sans lui.
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.items) && Array.isArray(v.categories);
}

/** Décode un paramètre `?import=` compact. Retourne `null` si le paramètre
 * est absent, corrompu, mal compressé ou ne ressemble pas à un instantané de
 * liste — jamais d'exception, un lien mal formé (tronqué en le copiant, lien
 * d'une future version incompatible…) doit pouvoir être ignoré silencieusement
 * plutôt que planter la page qui l'a reçu. */
export function decodeListFromParam(param: string): ImportPayload | null {
  try {
    // decompressFromEncodedURIComponent() ne devrait jamais lever (conçue
    // pour retourner null sur une entrée invalide), mais un paramètre forgé
    // à la main n'est pas plus digne de confiance que ça — dans le même
    // try/catch que JSON.parse plutôt qu'en confiance aveugle.
    const json = LZString.decompressFromEncodedURIComponent(param);
    // Stryker disable next-line ConditionalExpression: équivalent — sans ce
    // garde-fou, un `json` vide (`""`) ferait échouer JSON.parse (chaîne
    // vide invalide) et un `json` nul ferait parser JSON.parse(null) comme
    // "null" (JSON.parse coerce son argument en chaîne), les deux rattrapés
    // soit par le catch ci-dessous, soit par isImportPayload(null) juste
    // après — même résultat final (`null`) dans tous les cas.
    if (!json) return null;
    const data: unknown = JSON.parse(json);
    if (!isImportPayload(data)) return null;
    return {
      name: typeof data.name === "string" ? data.name : "",
      items: data.items!,
      categories: data.categories!,
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch {
    return null;
  }
}

/** Construit une URL absolue portant `?import=<encoded>`, à partir d'une URL
 * de base déjà absolue (ex: `${location.origin}${appPath("/")}`) — toujours
 * via `URLSearchParams` plutôt qu'une simple concaténation de chaînes :
 * l'alphabet "URI safe" de lz-string inclut `+` et `$`, qui ne sont PAS sans
 * risque dans une chaîne de requête assemblée à la main (un `+` littéral y
 * est lu comme un espace encodé par `URLSearchParams`/tout formulaire — voir
 * la même ambiguïté historique des query strings `application/
 * x-www-form-urlencoded`). Utilisé aussi bien pour le lien/QR compact
 * (shareModal.ts) que pour reporter un paramètre déjà décodé dans l'URL
 * d'une liste nouvellement créée (src/views/home.ts). */
export function buildImportUrl(base: string, encoded: string): string {
  const url = new URL(base);
  url.searchParams.set(IMPORT_PARAM, encoded);
  return url.toString();
}

/** Lit et retire `?import=...` de l'URL donnée (voir src/main.ts) : un lien
 * compact n'est consommé qu'une fois, pour qu'un rafraîchissement de page ne
 * redéclenche pas la même invite d'import à chaque fois (mêmes précautions
 * que Quine, voir App.tsx). */
export function consumeImportParam(url: URL): string | null {
  const raw = url.searchParams.get(IMPORT_PARAM);
  // Pas de garde `if (raw !== null)` : supprimer une clé déjà absente est un
  // no-op sans effet observable (spec URLSearchParams), la garde serait un
  // mutant équivalent (jamais tuable par un test comportemental).
  url.searchParams.delete(IMPORT_PARAM);
  return raw;
}
