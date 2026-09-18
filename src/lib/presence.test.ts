// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDeviceName } from "./presence";

describe("getDeviceName", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("génère un nom \"Animal adjectif\" la première fois et le persiste", () => {
    const name = getDeviceName();
    expect(name).toMatch(/^[A-ZÀ-Ü][a-zà-ÿ]+ [a-zà-ÿ]+$/);
    expect(localStorage.getItem("nldc:deviceName")).toBe(name);
  });

  it("renvoie le même nom à chaque appel une fois généré", () => {
    const first = getDeviceName();
    const second = getDeviceName();
    expect(second).toBe(first);
  });

  it("relit le nom déjà stocké plutôt que d'en régénérer un", () => {
    localStorage.setItem("nldc:deviceName", "Renard curieux");
    expect(getDeviceName()).toBe("Renard curieux");
  });

  it("génère quand même un nom (non persisté) si localStorage.getItem lève", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const name = getDeviceName();
    expect(name).toMatch(/^\S+ \S+$/);
    spy.mockRestore();
  });

  it("renvoie quand même le nom généré si localStorage.setItem lève", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const name = getDeviceName();
    expect(name).toMatch(/^\S+ \S+$/);
    expect(localStorage.getItem("nldc:deviceName")).toBeNull();
    spy.mockRestore();
  });
});
