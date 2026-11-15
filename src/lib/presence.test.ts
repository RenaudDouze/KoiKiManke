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
  it("tire chaque animal et chaque adjectif de la liste attendue", () => {
    const animals = ["Renard", "Chat", "Hibou", "Panda", "Loutre", "Lynx", "Corbeau", "Lapin", "Écureuil", "Dauphin", "Faucon", "Blaireau"];
    const adjectives = ["curieux", "discret", "malicieux", "rapide", "joyeux", "calme", "vif", "espiègle", "attentif", "gourmand", "rêveur", "futé"];
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      localStorage.clear();
      const value = (i + 0.5) / 12;
      const spy = vi.spyOn(Math, "random").mockReturnValue(value);
      seen.push(getDeviceName());
      spy.mockRestore();
    }
    expect(seen).toEqual(animals.map((animal, i) => `${animal} ${adjectives[i]}`));
  });
});
