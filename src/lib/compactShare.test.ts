import { describe, expect, it } from "vitest";
import * as LZString from "lz-string";
import { buildImportUrl, consumeImportParam, decodeListFromParam, encodeListToParam, IMPORT_PARAM } from "./compactShare";
import type { ImportPayload } from "./importExport";
import type { Category, HistoryEntry, Item } from "../../shared/types";

function makeItem(overrides: Partial<Item> = {}): Item {
  return { id: "i1", name: "Pommes", quantity: "2 kg", categoryId: "c1", checked: false, order: 0, createdAt: 0, updatedAt: 0, ...overrides };
}
function makeCategory(overrides: Partial<Category> = {}): Category {
  return { id: "c1", name: "Fruits", order: 0, ...overrides };
}
function makeHistory(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { key: "pommes", label: "Pommes", categoryId: "c1", useCount: 1, lastUsed: 0, ...overrides };
}
function payload(overrides: Partial<ImportPayload> = {}): ImportPayload {
  return { name: "Courses", items: [makeItem()], categories: [makeCategory()], history: [makeHistory()], ...overrides };
}

describe("encodeListToParam / decodeListFromParam", () => {
  it("fait un aller-retour fidèle pour un instantané complet (nom, articles, catégories, historique)", () => {
    const data = payload();
    expect(decodeListFromParam(encodeListToParam(data))).toEqual(data);
  });

  it("fait un aller-retour fidèle pour une liste vide", () => {
    const data = payload({ name: "", items: [], categories: [], history: [] });
    expect(decodeListFromParam(encodeListToParam(data))).toEqual(data);
  });

  it("produit un paramètre compressé nettement plus court que le JSON brut sur une grande liste", () => {
    // Représentatif d'une liste proche de MAX_ITEMS_PER_LIST (voir worker/index.ts) :
    // beaucoup de répétition (mêmes clés, mêmes catégories) — exactement le
    // cas que la compression doit bien absorber.
    const items = Array.from({ length: 500 }, (_, i) => makeItem({ id: `i${i}`, name: `Article ${i}`, order: i }));
    const data = payload({ items });
    const rawJson = JSON.stringify(data);
    const encoded = encodeListToParam(data);
    expect(encoded.length).toBeLessThan(rawJson.length);
    expect(decodeListFromParam(encoded)).toEqual(data);
  });

  it("retombe sur une chaîne vide pour name/history absents du JSON encodé", () => {
    // isImportPayload n'exige que items/categories ; un JSON compact ne
    // portant pas ces deux champs (format minimal envisageable) doit tout de
    // même produire un ImportPayload complet et exploitable.
    const encoded = encodeListToParam({ items: [], categories: [] } as unknown as ImportPayload);
    expect(decodeListFromParam(encoded)).toEqual({ name: "", items: [], categories: [], history: [] });
  });

  it("renvoie null pour un paramètre qui ne décompresse pas (corrompu ou tronqué)", () => {
    expect(decodeListFromParam("%%% pas un lien compact valide %%%")).toBeNull();
  });

  it("renvoie null pour un paramètre vide", () => {
    expect(decodeListFromParam("")).toBeNull();
  });

  it("renvoie null si la décompression réussit mais que le résultat n'est pas du JSON valide", () => {
    const encoded = LZString.compressToEncodedURIComponent("ceci n'est pas du JSON");
    expect(decodeListFromParam(encoded)).toBeNull();
  });

  it("renvoie null si le JSON décompressé n'est pas un objet (ex: un nombre)", () => {
    const encoded = encodeListToParam(42 as unknown as ImportPayload);
    expect(decodeListFromParam(encoded)).toBeNull();
  });

  it("renvoie null si le JSON décompressé est null", () => {
    const encoded = encodeListToParam(null as unknown as ImportPayload);
    expect(decodeListFromParam(encoded)).toBeNull();
  });

  it("renvoie null si items/categories ne sont pas des tableaux", () => {
    const encoded = encodeListToParam({ name: "x", items: "pas un tableau", categories: [] } as unknown as ImportPayload);
    expect(decodeListFromParam(encoded)).toBeNull();
  });

  it("renvoie null si categories n'est pas un tableau", () => {
    const encoded = encodeListToParam({ name: "x", items: [], categories: "pas un tableau" } as unknown as ImportPayload);
    expect(decodeListFromParam(encoded)).toBeNull();
  });

  it("ignore un name qui n'est pas une chaîne plutôt que de le propager", () => {
    const encoded = encodeListToParam({ name: 42, items: [], categories: [] } as unknown as ImportPayload);
    expect(decodeListFromParam(encoded)).toEqual({ name: "", items: [], categories: [], history: [] });
  });

  it("retombe sur un historique vide si history n'est pas un tableau", () => {
    const encoded = encodeListToParam({ name: "x", items: [], categories: [], history: "pas un tableau" } as unknown as ImportPayload);
    expect(decodeListFromParam(encoded)).toEqual({ name: "x", items: [], categories: [], history: [] });
  });
});

describe("buildImportUrl", () => {
  it("construit une URL absolue portant le paramètre import", () => {
    const url = buildImportUrl("https://example.test/", "abc123");
    expect(url).toBe("https://example.test/?import=abc123");
  });

  it("préserve un chemin de base non racine", () => {
    const url = buildImportUrl("https://example.test/koikimanke/", "abc123");
    expect(url).toBe("https://example.test/koikimanke/?import=abc123");
  });

  it("échappe correctement un paramètre contenant '+' et '$' (alphabet URI-safe de lz-string) pour un aller-retour fidèle via URLSearchParams", () => {
    // Un `+` non échappé dans une query string assemblée à la main serait lu
    // comme un espace par URLSearchParams — exactement le bug que cette
    // fonction évite en passant par `URL`/`URLSearchParams` plutôt qu'une
    // simple concaténation (voir son commentaire dans compactShare.ts).
    // Cherche un nom qui produit un `+` dans l'encodage compressé, pour
    // exercer réellement le cas à risque plutôt que de dépendre du hasard.
    let data = { name: "x", items: [], categories: [], history: [] };
    let encoded = encodeListToParam(data);
    let attempt = 0;
    while (!encoded.includes("+") && attempt < 200) {
      data = { ...data, name: `x${attempt}` };
      encoded = encodeListToParam(data);
      attempt += 1;
    }
    expect(encoded).toContain("+");

    const url = buildImportUrl("https://example.test/", encoded);
    const reparsed = new URL(url).searchParams.get(IMPORT_PARAM);

    expect(reparsed).toBe(encoded);
    expect(decodeListFromParam(reparsed!)).toEqual(data);
  });
});

describe("consumeImportParam", () => {
  it("lit et retire le paramètre import de l'URL donnée", () => {
    const url = new URL(`https://example.test/?${IMPORT_PARAM}=abc123&autre=1`);

    const raw = consumeImportParam(url);

    expect(raw).toBe("abc123");
    expect(url.searchParams.has(IMPORT_PARAM)).toBe(false);
    expect(url.searchParams.get("autre")).toBe("1");
  });

  it("renvoie null sans modifier l'URL si le paramètre est absent", () => {
    const url = new URL("https://example.test/l/ABCDEF");

    const raw = consumeImportParam(url);

    expect(raw).toBeNull();
    expect(url.toString()).toBe("https://example.test/l/ABCDEF");
  });
});
