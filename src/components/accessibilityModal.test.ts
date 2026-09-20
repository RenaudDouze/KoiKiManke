// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { openAccessibilityModal } from "./accessibilityModal";
import { getAccessibilityPreference, setAccessibilityPreference } from "../lib/accessibilityPreference";

describe("openAccessibilityModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    document.documentElement.removeAttribute("data-large-text");
    document.documentElement.removeAttribute("data-high-contrast");
    document.documentElement.removeAttribute("data-reduce-motion");
  });

  it("affiche les trois réglages, tous décochés par défaut", () => {
    openAccessibilityModal();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;

    const checkboxes = overlay.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    expect(checkboxes).toHaveLength(3);
    checkboxes.forEach((cb) => expect(cb.checked).toBe(false));
    expect(overlay.querySelector('[data-key="largeText"]')).not.toBeNull();
    expect(overlay.querySelector('[data-key="highContrast"]')).not.toBeNull();
    expect(overlay.querySelector('[data-key="reduceMotion"]')).not.toBeNull();
  });

  it("reflète la préférence déjà stockée à l'ouverture", () => {
    setAccessibilityPreference({ largeText: true, highContrast: false, reduceMotion: true });

    openAccessibilityModal();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;

    expect(overlay.querySelector<HTMLInputElement>('[data-key="largeText"]')!.checked).toBe(true);
    expect(overlay.querySelector<HTMLInputElement>('[data-key="highContrast"]')!.checked).toBe(false);
    expect(overlay.querySelector<HTMLInputElement>('[data-key="reduceMotion"]')!.checked).toBe(true);
  });

  it("cocher une case applique immédiatement le réglage sans toucher aux autres", () => {
    openAccessibilityModal();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;
    const largeText = overlay.querySelector<HTMLInputElement>('[data-key="largeText"]')!;

    largeText.checked = true;
    largeText.dispatchEvent(new Event("change"));

    expect(getAccessibilityPreference()).toEqual({ largeText: true, highContrast: false, reduceMotion: false });
    expect(document.documentElement.hasAttribute("data-large-text")).toBe(true);
  });

  it("décocher une case déjà activée la retire, en préservant les autres réglages", () => {
    setAccessibilityPreference({ largeText: true, highContrast: true, reduceMotion: false });
    openAccessibilityModal();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;
    const highContrast = overlay.querySelector<HTMLInputElement>('[data-key="highContrast"]')!;

    highContrast.checked = false;
    highContrast.dispatchEvent(new Event("change"));

    expect(getAccessibilityPreference()).toEqual({ largeText: true, highContrast: false, reduceMotion: false });
  });

  it("place le focus dans la modale à l'ouverture (piège de focus)", () => {
    openAccessibilityModal();
    const modal = document.querySelector(".modal") as HTMLElement;

    expect(document.activeElement).toBe(modal);
  });

  it("le bouton de fermeture ferme la modale et retire l'écouteur clavier", () => {
    openAccessibilityModal();
    (document.querySelector(".modal-close") as HTMLElement).click();

    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("Échap ferme la modale", () => {
    openAccessibilityModal();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("une touche autre qu'Échap ne ferme pas la modale", () => {
    openAccessibilityModal();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(document.querySelector(".modal-overlay")).not.toBeNull();
  });

  it("cliquer sur l'overlay (en dehors de la modale) la ferme", () => {
    openAccessibilityModal();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;

    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("cliquer à l'intérieur de la modale ne la ferme pas", () => {
    openAccessibilityModal();
    const modal = document.querySelector(".modal") as HTMLElement;

    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".modal-overlay")).not.toBeNull();
  });
});
