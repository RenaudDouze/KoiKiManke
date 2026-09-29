// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchKeyboardInset } from "./keyboardInset";

function makeFakeViewport(overrides: Partial<{ height: number; offsetTop: number }> = {}) {
  const listeners: Record<string, (() => void)[]> = { resize: [], scroll: [] };
  return {
    height: 800,
    offsetTop: 0,
    ...overrides,
    addEventListener: (type: string, cb: () => void) => listeners[type].push(cb),
    removeEventListener: (type: string, cb: () => void) => {
      listeners[type] = listeners[type].filter((l) => l !== cb);
    },
    trigger: (type: "resize" | "scroll") => listeners[type].forEach((cb) => cb()),
    listenerCount: (type: "resize" | "scroll") => listeners[type].length,
  };
}

describe("watchKeyboardInset", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    document.documentElement.style.removeProperty("--keyboard-inset");
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
  });

  it("ne fait rien et renvoie un disposer no-op si l'API est indisponible", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });

    const dispose = watchKeyboardInset();

    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("");
    expect(() => dispose()).not.toThrow();
  });

  it("pose --keyboard-inset à 0px quand le clavier est fermé (viewport visuel = pleine hauteur)", () => {
    const vv = makeFakeViewport({ height: 800 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });

    watchKeyboardInset();

    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("0px");
  });

  it("reflète la hauteur du clavier quand le viewport visuel rétrécit", () => {
    const vv = makeFakeViewport({ height: 800 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    watchKeyboardInset();

    vv.height = 500;
    vv.trigger("resize");

    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("300px");
  });

  it("se met aussi à jour sur un événement scroll du viewport visuel", () => {
    const vv = makeFakeViewport({ height: 800, offsetTop: 0 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    watchKeyboardInset();

    vv.height = 500;
    vv.offsetTop = 50;
    vv.trigger("scroll");

    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("250px");
  });

  it("ne descend jamais sous 0px", () => {
    const vv = makeFakeViewport({ height: 900 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });

    watchKeyboardInset();

    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("0px");
  });

  it("le disposer retire les écouteurs et la variable CSS", () => {
    const vv = makeFakeViewport({ height: 800 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    const dispose = watchKeyboardInset();
    expect(vv.listenerCount("resize")).toBe(1);
    expect(vv.listenerCount("scroll")).toBe(1);

    dispose();

    expect(vv.listenerCount("resize")).toBe(0);
    expect(vv.listenerCount("scroll")).toBe(0);
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("");

    // Un événement après dispose ne doit rien reposer.
    vv.height = 100;
    vv.trigger("resize");
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("");
  });
});
