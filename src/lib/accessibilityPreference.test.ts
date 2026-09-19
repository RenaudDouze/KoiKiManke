// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessibilityLabel, applyAccessibilityPreference, getAccessibilityPreference, setAccessibilityPreference, toggleAccessibilityPreference } from "./accessibilityPreference";

describe("accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-a11y");
  });

  describe("getAccessibilityPreference", () => {
    it("vaut \"off\" par défaut", () => {
      expect(getAccessibilityPreference()).toBe("off");
    });

    it("lit la préférence stockée si valide", () => {
      localStorage.setItem("nldc:a11y", "on");
      expect(getAccessibilityPreference()).toBe("on");
    });

    it("retombe sur \"off\" si la valeur stockée est invalide", () => {
      localStorage.setItem("nldc:a11y", "maybe");
      expect(getAccessibilityPreference()).toBe("off");
    });

    it("retombe sur \"off\" si localStorage lève", () => {
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      expect(getAccessibilityPreference()).toBe("off");
      spy.mockRestore();
    });
  });

  describe("applyAccessibilityPreference", () => {
    it("retire l'attribut data-a11y pour \"off\"", () => {
      document.documentElement.setAttribute("data-a11y", "on");
      applyAccessibilityPreference("off");
      expect(document.documentElement.hasAttribute("data-a11y")).toBe(false);
    });

    it("pose data-a11y pour \"on\"", () => {
      applyAccessibilityPreference("on");
      expect(document.documentElement.getAttribute("data-a11y")).toBe("on");
    });
  });

  describe("setAccessibilityPreference", () => {
    it("persiste et applique l'attribut", () => {
      setAccessibilityPreference("on");
      expect(localStorage.getItem("nldc:a11y")).toBe("on");
      expect(document.documentElement.getAttribute("data-a11y")).toBe("on");
    });

    it("applique quand même si localStorage lève", () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      setAccessibilityPreference("on");
      expect(document.documentElement.getAttribute("data-a11y")).toBe("on");
      spy.mockRestore();
    });
  });

  describe("toggleAccessibilityPreference", () => {
    it("bascule off ↔ on", () => {
      expect(toggleAccessibilityPreference()).toBe("on");
      expect(toggleAccessibilityPreference()).toBe("off");
    });
  });

  describe("accessibilityLabel", () => {
    it("traduit chaque valeur en libellé affiché", () => {
      expect(accessibilityLabel("off")).toBe("Désactivé");
      expect(accessibilityLabel("on")).toBe("Activé");
    });
  });
});
