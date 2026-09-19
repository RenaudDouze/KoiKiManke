// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountHomeView } from "./home";
import { encodeListToParam } from "../lib/compactShare";
import type { RecentList } from "../lib/storage";
import type { ListState } from "../../shared/types";

const createList = vi.fn();
const fetchListState = vi.fn();
vi.mock("../lib/http", () => ({
  createList: (...args: unknown[]) => createList(...args),
  fetchListState: (...args: unknown[]) => fetchListState(...args),
}));

let recentLists: RecentList[] = [];
const forgetRecentList = vi.fn();
const touchRecentList = vi.fn();
const toggleFavoriteList = vi.fn();
vi.mock("../lib/storage", () => ({
  getRecentLists: () => recentLists,
  forgetRecentList: (...args: unknown[]) => forgetRecentList(...args),
  touchRecentList: (...args: unknown[]) => touchRecentList(...args),
  toggleFavoriteList: (...args: unknown[]) => toggleFavoriteList(...args),
}));

function sampleState(overrides: Partial<ListState> = {}): ListState {
  return { code: "ABCDEF", name: "Courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0, ...overrides };
}

describe("mountHomeView", () => {
  let root: HTMLElement;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-a11y");
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    recentLists = [];
    navigate = vi.fn<(path: string) => void>();
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("affiche l'accueil sans section « Listes récentes » quand il n'y en a pas", () => {
    mountHomeView(root, navigate);

    expect(root.querySelector("h1")?.textContent).toBe("KoiKiManke");
    expect(root.querySelector(".card h2")?.textContent).toBe("Nouvelle liste");
    expect(Array.from(root.querySelectorAll("h2")).some((h) => h.textContent === "Listes récentes")).toBe(false);
  });

  it("affiche les favoris et les autres listes récentes séparément", () => {
    recentLists = [
      { code: "AAAAAA", name: "Favorite", favorite: true, lastOpened: 1 },
      { code: "BBBBBB", name: "Normale", favorite: false, lastOpened: 2 },
    ];
    mountHomeView(root, navigate);

    const headings = Array.from(root.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Favoris", "Autres"]);
    expect(root.querySelector('.recent-favorite[data-code="AAAAAA"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('.recent-favorite[data-code="BBBBBB"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("n'affiche pas le sous-titre « Autres » s'il n'y a que des favoris", () => {
    recentLists = [{ code: "AAAAAA", name: "Favorite", favorite: true, lastOpened: 1 }];
    mountHomeView(root, navigate);

    const headings = Array.from(root.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headings).toEqual(["Favoris"]);
  });

  it("n'affiche aucun sous-titre s'il n'y a que des listes non favorites", () => {
    recentLists = [{ code: "BBBBBB", name: "Normale", favorite: false, lastOpened: 2 }];
    mountHomeView(root, navigate);

    expect(root.querySelectorAll("h3")).toHaveLength(0);
  });

  it("échappe le nom d'une liste récente", () => {
    recentLists = [{ code: "AAAAAA", name: "<img src=x>", favorite: false, lastOpened: 1 }];
    mountHomeView(root, navigate);

    expect(root.querySelector(".recent-name")?.innerHTML).not.toContain("<img");
  });

  it("le bouton de thème cycle la préférence et se ré-affiche", () => {
    mountHomeView(root, navigate);
    const before = root.querySelector("#theme-toggle")?.getAttribute("aria-label");

    (root.querySelector("#theme-toggle") as HTMLButtonElement).click();

    const after = root.querySelector("#theme-toggle")?.getAttribute("aria-label");
    expect(after).not.toBe(before);
  });

  it("le bouton d'accessibilité bascule la préférence et se ré-affiche", () => {
    mountHomeView(root, navigate);

    (root.querySelector("#a11y-toggle") as HTMLButtonElement).click();

    expect(root.querySelector("#a11y-toggle")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("créer une liste : appelle createList, mémorise la liste puis navigue", async () => {
    createList.mockResolvedValue(sampleState({ code: "NEWCOD", name: "Ma liste" }));
    mountHomeView(root, navigate);
    (root.querySelector("#create-name") as HTMLInputElement).value = "Ma liste";

    (root.querySelector("#create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(createList).toHaveBeenCalledWith("Ma liste");
    expect(touchRecentList).toHaveBeenCalledWith("NEWCOD", "Ma liste");
    expect(navigate).toHaveBeenCalledWith("/l/NEWCOD");
  });

  it("créer une liste sans nom utilise le nom par défaut", async () => {
    createList.mockResolvedValue(sampleState());
    mountHomeView(root, navigate);

    (root.querySelector("#create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(createList).toHaveBeenCalled());

    expect(createList).toHaveBeenCalledWith("Liste de courses");
  });

  it("un échec réseau à la création affiche une alerte et réactive le bouton", async () => {
    createList.mockRejectedValue(new Error("network"));
    mountHomeView(root, navigate);
    const btn = root.querySelector("#create-form button") as HTMLButtonElement;

    (root.querySelector("#create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());

    expect(btn.disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejoindre avec un code vide ne fait rien", () => {
    mountHomeView(root, navigate);

    (root.querySelector("#join-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(fetchListState).not.toHaveBeenCalled();
  });

  it("rejoindre avec un code inconnu affiche un message d'erreur", async () => {
    fetchListState.mockResolvedValue(null);
    mountHomeView(root, navigate);
    (root.querySelector("#join-code") as HTMLInputElement).value = "zzzzzz";

    (root.querySelector("#join-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetchListState).toHaveBeenCalled());

    expect(fetchListState).toHaveBeenCalledWith("ZZZZZZ");
    const errorEl = root.querySelector("#join-error") as HTMLElement;
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toBe("Aucune liste ne correspond à ce code.");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejoindre avec un code valide mémorise la liste puis navigue", async () => {
    fetchListState.mockResolvedValue(sampleState({ code: "ABCDEF", name: "Trouvée" }));
    mountHomeView(root, navigate);
    (root.querySelector("#join-code") as HTMLInputElement).value = "abcdef";

    (root.querySelector("#join-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(touchRecentList).toHaveBeenCalledWith("ABCDEF", "Trouvée");
    expect(navigate).toHaveBeenCalledWith("/l/ABCDEF");
  });

  it("une erreur réseau en rejoignant affiche un message d'erreur dédié", async () => {
    fetchListState.mockRejectedValue(new Error("network"));
    mountHomeView(root, navigate);
    (root.querySelector("#join-code") as HTMLInputElement).value = "abcdef";
    const btn = root.querySelector("#join-form button") as HTMLButtonElement;

    (root.querySelector("#join-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(btn.disabled).toBe(false));

    const errorEl = root.querySelector("#join-error") as HTMLElement;
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toBe("Erreur réseau, réessaie.");
  });

  it("cliquer sur une liste récente navigue vers son code", () => {
    recentLists = [{ code: "AAAAAA", name: "Favorite", favorite: false, lastOpened: 1 }];
    mountHomeView(root, navigate);

    (root.querySelector(".recent-open") as HTMLButtonElement).click();

    expect(navigate).toHaveBeenCalledWith("/l/AAAAAA");
  });

  it("basculer un favori l'appelle et ré-affiche sans naviguer", () => {
    recentLists = [{ code: "AAAAAA", name: "Favorite", favorite: false, lastOpened: 1 }];
    mountHomeView(root, navigate);

    (root.querySelector(".recent-favorite") as HTMLButtonElement).click();

    expect(toggleFavoriteList).toHaveBeenCalledWith("AAAAAA");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("oublier une liste récente l'appelle et ré-affiche sans naviguer", () => {
    recentLists = [{ code: "AAAAAA", name: "Favorite", favorite: false, lastOpened: 1 }];
    mountHomeView(root, navigate);

    (root.querySelector(".recent-forget") as HTMLButtonElement).click();

    expect(forgetRecentList).toHaveBeenCalledWith("AAAAAA");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("un favori sans code (cache local-storage corrompu) n'appelle pas toggleFavoriteList", () => {
    recentLists = [{ code: "", name: "Corrompue", favorite: false, lastOpened: 1 }];
    mountHomeView(root, navigate);

    expect(() => (root.querySelector(".recent-favorite") as HTMLButtonElement).click()).not.toThrow();

    expect(toggleFavoriteList).not.toHaveBeenCalled();
  });

  it("oublier une liste sans code (cache local-storage corrompu) n'appelle pas forgetRecentList", () => {
    recentLists = [{ code: "", name: "Corrompue", favorite: false, lastOpened: 1 }];
    mountHomeView(root, navigate);

    expect(() => (root.querySelector(".recent-forget") as HTMLButtonElement).click()).not.toThrow();

    expect(forgetRecentList).not.toHaveBeenCalled();
  });

  it("le nettoyage retourné est un no-op", () => {
    const cleanup = mountHomeView(root, navigate);
    expect(() => cleanup()).not.toThrow();
  });

  describe("lien/QR compact (?import=, voir src/lib/compactShare.ts)", () => {
    const encoded = encodeListToParam({
      name: "Reçue",
      items: [{ id: "i1", name: "Pommes", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
      categories: [{ id: "c1", name: "Fruits", order: 0 }],
      history: [],
    });

    it("sans paramètre, aucune bannière d'import ne s'affiche", () => {
      mountHomeView(root, navigate);
      expect(root.textContent).not.toContain("Liste partagée reçue");
    });

    it("un paramètre valide affiche une bannière résumant le contenu", () => {
      mountHomeView(root, navigate, encoded);

      expect(root.textContent).toContain("Liste partagée reçue");
      expect(root.textContent).toContain("1 article(s) et 1 catégorie(s)");
      expect(root.textContent).toContain("« Reçue »");
    });

    it("un paramètre invalide ou corrompu n'affiche aucune bannière", () => {
      mountHomeView(root, navigate, "%%% pas un lien compact valide %%%");

      expect(root.textContent).not.toContain("Liste partagée reçue");
    });

    it("« Créer une nouvelle liste » crée la liste, mémorise le lien puis navigue en reportant le paramètre", async () => {
      createList.mockResolvedValue(sampleState({ code: "NEWCOD", name: "Reçue" }));
      mountHomeView(root, navigate, encoded);

      (root.querySelector("#import-banner-create") as HTMLButtonElement).click();
      await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

      expect(createList).toHaveBeenCalledWith("Reçue");
      expect(touchRecentList).toHaveBeenCalledWith("NEWCOD", "Reçue");
      expect(navigate).toHaveBeenCalledWith(`/l/NEWCOD?import=${encodeURIComponent(encoded)}`);
    });

    it("un aperçu sans nom utilise le nom de liste par défaut à la création", async () => {
      const unnamed = encodeListToParam({ name: "", items: [], categories: [], history: [] });
      createList.mockResolvedValue(sampleState());
      mountHomeView(root, navigate, unnamed);

      (root.querySelector("#import-banner-create") as HTMLButtonElement).click();
      await vi.waitFor(() => expect(createList).toHaveBeenCalled());

      expect(createList).toHaveBeenCalledWith("Liste de courses");
    });

    it("un échec réseau à la création affiche une alerte et réactive le bouton", async () => {
      createList.mockRejectedValue(new Error("network"));
      mountHomeView(root, navigate, encoded);
      const btn = root.querySelector("#import-banner-create") as HTMLButtonElement;

      btn.click();
      await vi.waitFor(() => expect(alert).toHaveBeenCalled());

      expect(btn.disabled).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });

    it("« Ignorer » retire la bannière sans rien créer ni naviguer", () => {
      mountHomeView(root, navigate, encoded);

      (root.querySelector("#import-banner-dismiss") as HTMLButtonElement).click();

      expect(root.textContent).not.toContain("Liste partagée reçue");
      expect(createList).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
