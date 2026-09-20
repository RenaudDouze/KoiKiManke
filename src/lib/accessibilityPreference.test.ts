// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAccessibilityPreference, getAccessibilityPreference, setAccessibilityPreference } from "./accessibilityPreference";

describe("accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-large-text");
    document.documentElement.removeAttribute("data-high-contrast");
    document.documentElement.removeAttribute("data-reduce-motion");
  });

  describe("getAccessibilityPreference", () => {
    it("vaut tout désactivé par défaut", () => {
      expect(getAccessibilityPreference()).toEqual({ largeText: false, highContrast: false, reduceMotion: false });
    });

    it("lit la préférence stockée si valide", () => {
      localStorage.setItem("nldc:a11y", JSON.stringify({ largeText: true, highContrast: false, reduceMotion: true }));
      expect(getAccessibilityPreference()).toEqual({ largeText: true, highContrast: false, reduceMotion: true });
    });

    it("retombe sur tout désactivé si la valeur stockée est un JSON invalide", () => {
      localStorage.setItem("nldc:a11y", "not json");
      expect(getAccessibilityPreference()).toEqual({ largeText: false, highContrast: false, reduceMotion: false });
    });

    it("retombe sur tout désactivé pour l'ancien format (chaîne \"on\"/\"off\")", () => {
      localStorage.setItem("nldc:a11y", "on");
      expect(getAccessibilityPreference()).toEqual({ largeText: false, highContrast: false, reduceMotion: false });
    });

    it("retombe sur tout désactivé si localStorage lève", () => {
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      expect(getAccessibilityPreference()).toEqual({ largeText: false, highContrast: false, reduceMotion: false });
      spy.mockRestore();
    });
  });

  describe("applyAccessibilityPreference", () => {
    it("pose chaque attribut indépendamment selon la préférence", () => {
      applyAccessibilityPreference({ largeText: true, highContrast: false, reduceMotion: true });
      expect(document.documentElement.hasAttribute("data-large-text")).toBe(true);
      expect(document.documentElement.hasAttribute("data-high-contrast")).toBe(false);
      expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(true);
    });

    it("retire les attributs pour un réglage désactivé", () => {
      document.documentElement.setAttribute("data-large-text", "");
      applyAccessibilityPreference({ largeText: false, highContrast: false, reduceMotion: false });
      expect(document.documentElement.hasAttribute("data-large-text")).toBe(false);
    });
  });

  describe("setAccessibilityPreference", () => {
    it("persiste et applique les attributs", () => {
      setAccessibilityPreference({ largeText: false, highContrast: true, reduceMotion: false });
      expect(JSON.parse(localStorage.getItem("nldc:a11y")!)).toEqual({ largeText: false, highContrast: true, reduceMotion: false });
      expect(document.documentElement.hasAttribute("data-high-contrast")).toBe(true);
    });

    it("applique quand même si localStorage lève", () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      setAccessibilityPreference({ largeText: true, highContrast: false, reduceMotion: false });
      expect(document.documentElement.hasAttribute("data-large-text")).toBe(true);
      spy.mockRestore();
    });
  });
});
