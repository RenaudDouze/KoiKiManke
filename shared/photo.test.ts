import { describe, expect, it } from "vitest";
import { ALLOWED_PHOTO_TYPES, isAllowedPhotoType, MAX_PHOTO_BYTES } from "./photo";

describe("isAllowedPhotoType", () => {
  it.each(ALLOWED_PHOTO_TYPES)("accepte %s", (type) => {
    expect(isAllowedPhotoType(type)).toBe(true);
  });

  it("refuse un type MIME hors liste", () => {
    expect(isAllowedPhotoType("image/svg+xml")).toBe(false);
    expect(isAllowedPhotoType("application/pdf")).toBe(false);
    expect(isAllowedPhotoType("text/html")).toBe(false);
  });

  it("refuse une valeur absente ou non-chaîne", () => {
    expect(isAllowedPhotoType(null)).toBe(false);
    expect(isAllowedPhotoType(undefined)).toBe(false);
    expect(isAllowedPhotoType("")).toBe(false);
  });
});

describe("MAX_PHOTO_BYTES", () => {
  it("vaut 8 Mio", () => {
    expect(MAX_PHOTO_BYTES).toBe(8 * 1024 * 1024);
  });
});
