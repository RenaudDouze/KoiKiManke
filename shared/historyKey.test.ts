import { describe, it, expect } from "vitest";
import { historyKey } from "./historyKey";

describe("historyKey", () => {
  it("met en minuscule et retire les espaces de bord", () => {
    expect(historyKey("  Lait  ")).toBe("lait");
  });
});
