import { describe, it, expect } from "vitest";
import { parseFreeText } from "./quantity";

describe("parseFreeText", () => {
  it("renvoie une entrée vide pour une chaîne vide ou blanche", () => {
    expect(parseFreeText("")).toEqual({ name: "", quantity: "" });
    expect(parseFreeText("   ")).toEqual({ name: "", quantity: "" });
  });

  it("ne détecte aucune quantité pour un nom simple", () => {
    expect(parseFreeText("pommes")).toEqual({ name: "pommes", quantity: "" });
  });

  it("normalise les espaces multiples", () => {
    expect(parseFreeText("  pommes   vertes  ")).toEqual({ name: "pommes vertes", quantity: "" });
  });

  describe("nombre nu (un seul token)", () => {
    it("en tête", () => {
      expect(parseFreeText("2 pommes")).toEqual({ name: "pommes", quantity: "2" });
    });
    it("en fin", () => {
      expect(parseFreeText("pommes 2")).toEqual({ name: "pommes", quantity: "2" });
    });
    it("avec virgule décimale", () => {
      expect(parseFreeText("1,5 lait")).toEqual({ name: "lait", quantity: "1.5" });
    });
  });

  describe("nombre + unité collés", () => {
    it("en tête", () => {
      expect(parseFreeText("500g farine")).toEqual({ name: "farine", quantity: "500 g" });
    });
    it("en fin", () => {
      expect(parseFreeText("farine 500g")).toEqual({ name: "farine", quantity: "500 g" });
    });
    it("insensible à la casse de l'unité", () => {
      expect(parseFreeText("2KG pommes")).toEqual({ name: "pommes", quantity: "2 kg" });
    });
    it("gère les unités à mot complet (bouteilles)", () => {
      expect(parseFreeText("2bouteilles eau")).toEqual({ name: "eau", quantity: "2 bouteilles" });
    });
  });

  describe("préfixe/suffixe x", () => {
    it("x devant", () => {
      expect(parseFreeText("x8 yaourts")).toEqual({ name: "yaourts", quantity: "x8" });
    });
    it("x derrière", () => {
      expect(parseFreeText("yaourts x8")).toEqual({ name: "yaourts", quantity: "x8" });
    });
    it("nombre puis x collés en suffixe", () => {
      expect(parseFreeText("yaourts 8x")).toEqual({ name: "yaourts", quantity: "x8" });
    });
  });

  describe("nombre + unité en deux mots", () => {
    it("en tête", () => {
      expect(parseFreeText("2 kg pommes de terre")).toEqual({ name: "pommes de terre", quantity: "2 kg" });
    });
    it("en fin", () => {
      expect(parseFreeText("pommes de terre 2 kg")).toEqual({ name: "pommes de terre", quantity: "2 kg" });
    });
    it("un nombre+unité seul (2 mots, rien après) donne un nom vide plutôt que de couper l'unité en nom", () => {
      // Sans ce garde-fou, le chemin nombre-nu-seul ci-dessus interpréterait
      // "2" comme quantité et laisserait "kg" comme nom de l'article — un nom
      // absurde. Un nom vide est silencieusement ignoré par l'appelant
      // (worker/reducer.ts) plutôt que de créer un article "kg".
      expect(parseFreeText("2 kg")).toEqual({ name: "", quantity: "2 kg" });
    });
  });

  it("un nombre au milieu de la chaîne n'est pas extrait", () => {
    expect(parseFreeText("coca 2 litres bio")).toEqual({ name: "coca 2 litres bio", quantity: "" });
  });

  it("un mot qui n'est qu'un nombre après un premier échec de match reste le nom (2 mots, pas d'unité)", () => {
    expect(parseFreeText("7up")).toEqual({ name: "7up", quantity: "" });
  });
});

describe("parseFreeText : motifs exacts", () => {
  const cases: [string, { name: string; quantity: string }][] = [
    ["", { name: "", quantity: "" }],
    ["2 pommes rouges", { name: "pommes rouges", quantity: "2" }],
    ["12 kg pommes", { name: "pommes", quantity: "12 kg" }],
    ["1.25 kg pommes", { name: "pommes", quantity: "1.25 kg" }],
    ["2,5 kg pommes", { name: "pommes", quantity: "2.5 kg" }],
    ["2,5kg pommes", { name: "pommes", quantity: "2.5 kg" }],
    ["2 KG pommes", { name: "pommes", quantity: "2 kg" }],
    ["2 Kg pommes rouges", { name: "pommes rouges", quantity: "2 kg" }],
    ["pommes rouges 2 kg", { name: "pommes rouges", quantity: "2 kg" }],
    ["abc2 kg pommes", { name: "abc2 kg pommes", quantity: "" }],
    ["2abc kg pommes", { name: "2abc kg pommes", quantity: "" }],
    ["pommes rouges", { name: "pommes rouges", quantity: "" }],
    ["2 kg", { name: "", quantity: "2 kg" }],
    ["2", { name: "2", quantity: "" }],
    ["x3", { name: "x3", quantity: "" }],
    ["x12 pommes", { name: "pommes", quantity: "x12" }],
    ["ax3 pommes", { name: "ax3 pommes", quantity: "" }],
    ["x3a pommes", { name: "x3a pommes", quantity: "" }],
    ["12x pommes", { name: "pommes", quantity: "x12" }],
    ["a3x pommes", { name: "a3x pommes", quantity: "" }],
    ["3xa pommes", { name: "3xa pommes", quantity: "" }],
    ["1,5 pommes", { name: "pommes", quantity: "1.5" }],
    ["12 pommes", { name: "pommes", quantity: "12" }],
    ["pommes 12", { name: "pommes", quantity: "12" }],
    ["pommes 1.25", { name: "pommes", quantity: "1.25" }],
    ["pommes rouges vertes 2", { name: "pommes rouges vertes", quantity: "2" }],
    ["pommes rouges vertes x2", { name: "pommes rouges vertes", quantity: "x2" }],
    ["pommes 2abc", { name: "pommes 2abc", quantity: "" }],
    ["pommes 12 abc", { name: "pommes 12 abc", quantity: "" }],
  ];
  it.each(cases)("%j", (raw, expected) => {
    expect(parseFreeText(raw)).toEqual(expected);
  });
});
