import { describe, it, expect } from "vitest";
import { categoryHue } from "./color";

describe("categoryHue", () => {
  it("est déterministe pour un même id", () => {
    expect(categoryHue("cat-1")).toBe(categoryHue("cat-1"));
  });

  it("reste dans [0, 360)", () => {
    for (const id of ["a", "abc", "une-tres-longue-cle-de-categorie", ""]) {
      const hue = categoryHue(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("des ids différents donnent (généralement) des teintes différentes", () => {
    expect(categoryHue("fruits")).not.toBe(categoryHue("legumes"));
  });
});
