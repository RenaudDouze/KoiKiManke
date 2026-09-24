import { describe, it, expect } from "vitest";
import { alnumCompare, normalizeForSearch } from "./sort";

describe("alnumCompare", () => {
  it("ignore la casse", () => {
    expect(["banane", "Ananas"].sort(alnumCompare)).toEqual(["Ananas", "banane"]);
  });

  it("ignore les accents", () => {
    expect(["étagère", "epicerie"].sort(alnumCompare)).toEqual(["epicerie", "étagère"]);
  });

  it("compare les nombres numériquement plutôt que caractère par caractère", () => {
    expect(["Article 10", "Article 2"].sort(alnumCompare)).toEqual(["Article 2", "Article 10"]);
  });
});

describe("normalizeForSearch", () => {
  it("retire les diacritiques", () => {
    expect(normalizeForSearch("café")).toBe("cafe");
    expect(normalizeForSearch("crème")).toBe("creme");
    expect(normalizeForSearch("étagère")).toBe("etagere");
  });

  it("laisse une chaîne sans diacritique inchangée", () => {
    expect(normalizeForSearch("pommes")).toBe("pommes");
  });

  it("permet à une recherche sans accent de trouver un texte accentué, et inversement", () => {
    expect(normalizeForSearch("café").includes(normalizeForSearch("cafe"))).toBe(true);
    expect(normalizeForSearch("cafe").includes(normalizeForSearch("café"))).toBe(true);
  });
});
