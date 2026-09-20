import { describe, expect, it } from "vitest";
import { generatePhotoId, isSafePhotoId, photoObjectKey } from "./photos";

describe("isSafePhotoId", () => {
  it("accepte un uuid v4 (format généré par generatePhotoId)", () => {
    expect(isSafePhotoId(generatePhotoId())).toBe(true);
  });

  it("accepte un identifiant alphanumérique simple", () => {
    expect(isSafePhotoId("abc123_-XYZ")).toBe(true);
  });

  it("refuse une valeur non-chaîne", () => {
    expect(isSafePhotoId(42)).toBe(false);
    expect(isSafePhotoId(null)).toBe(false);
    expect(isSafePhotoId(undefined)).toBe(false);
  });

  it("refuse une chaîne vide ou trop longue", () => {
    expect(isSafePhotoId("")).toBe(false);
    expect(isSafePhotoId("a".repeat(65))).toBe(false);
  });

  it("refuse des caractères hors alphabet (traversée de chemin, etc.)", () => {
    expect(isSafePhotoId("../secret")).toBe(false);
    expect(isSafePhotoId("a/b")).toBe(false);
    expect(isSafePhotoId("<script>")).toBe(false);
  });
});

describe("generatePhotoId", () => {
  it("génère un id différent à chaque appel", () => {
    expect(generatePhotoId()).not.toBe(generatePhotoId());
  });
});

describe("photoObjectKey", () => {
  it("préfixe l'id par le code de la liste", () => {
    expect(photoObjectKey("ABCDEF", "the-id")).toBe("ABCDEF/the-id");
  });
});
