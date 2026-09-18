// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trapFocus } from "./focusTrap";

// jsdom ne fait pas de mise en page réelle : offsetParent vaut toujours null,
// ce qui exclurait tout élément de focusableElements() sauf le déjà-focalisé.
// On simule donc "visible" comme le ferait un vrai navigateur pour un
// élément affiché.
function makeVisible(el: HTMLElement): void {
  Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
}

describe("trapFocus", () => {
  let outsideButton: HTMLButtonElement;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);
    makeVisible(outsideButton);
    outsideButton.focus();

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("focalise le premier élément focalisable du conteneur à l'activation", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    container.append(first, second);
    makeVisible(first);
    makeVisible(second);

    trapFocus(container);

    expect(document.activeElement).toBe(first);
  });

  it("compte comme focalisable un élément déjà activeElement même sans offsetParent (jsdom, pas de vrai layout)", () => {
    const first = document.createElement("button");
    container.append(first);
    first.focus(); // pas de makeVisible : jsdom permet quand même de focaliser un <button>
    expect(document.activeElement).toBe(first);

    trapFocus(container);

    expect(document.activeElement).toBe(first);
  });

  it("focalise le conteneur lui-même s'il n'a pas d'élément focalisable (et un tabindex)", () => {
    container.tabIndex = -1;

    trapFocus(container);

    expect(document.activeElement).toBe(container);
  });

  it("Tab depuis le dernier élément revient au premier (piège le focus)", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    container.append(first, second);
    makeVisible(first);
    makeVisible(second);
    trapFocus(container);
    second.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    expect(document.activeElement).toBe(first);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Shift+Tab depuis le premier élément revient au dernier", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    container.append(first, second);
    makeVisible(first);
    makeVisible(second);
    trapFocus(container);
    first.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    expect(document.activeElement).toBe(second);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Tab au milieu de la liste ne fait rien (laisse le navigateur gérer)", () => {
    const first = document.createElement("button");
    const middle = document.createElement("button");
    const last = document.createElement("button");
    container.append(first, middle, last);
    makeVisible(first);
    makeVisible(middle);
    makeVisible(last);
    trapFocus(container);
    middle.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    expect(document.activeElement).toBe(middle);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignore les touches autres que Tab", () => {
    const first = document.createElement("button");
    container.append(first);
    makeVisible(first);
    trapFocus(container);

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("Tab ne fait rien si le conteneur redevient sans élément focalisable (branche focusable.length === 0)", () => {
    const first = document.createElement("button");
    container.append(first);
    makeVisible(first);
    trapFocus(container);
    container.removeChild(first);

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    expect(() => container.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });

  it("le nettoyage retire l'écouteur et restaure le focus précédent", () => {
    const first = document.createElement("button");
    container.append(first);
    makeVisible(first);
    const release = trapFocus(container);
    expect(document.activeElement).toBe(first);

    release();

    expect(document.activeElement).toBe(outsideButton);

    // L'écouteur est bien retiré : Tab ne fait plus rien après le nettoyage.
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("le nettoyage ne plante pas si document.activeElement valait null à l'activation", () => {
    const spy = vi.spyOn(document, "activeElement", "get").mockReturnValue(null);
    const first = document.createElement("button");
    container.append(first);
    makeVisible(first);
    const release = trapFocus(container);
    spy.mockRestore();
    expect(() => release()).not.toThrow();
  });
});
