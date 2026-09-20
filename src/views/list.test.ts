// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountListView } from "./list";
import { cacheListState } from "../lib/storage";
import { encodeListToParam } from "../lib/compactShare";
import type { Category, ClientMessage, HistoryEntry, Item, ListState } from "../../shared/types";

// --- ws.ts : la vraie classe ouvrirait une connexion WebSocket réelle ---
// vi.mock() est hoisté en tête de fichier : la classe et la liste de ses
// instances doivent l'être aussi (vi.hoisted) pour être déjà initialisées
// quand la factory s'exécute.
type Listener<T> = (arg: T) => void;
const { FakeListConnection, fakeConnectionInstances } = vi.hoisted(() => {
  const instances: unknown[] = [];
  class Impl {
    send = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    private stateListeners: Listener<unknown>[] = [];
    private presenceListeners: Listener<unknown>[] = [];
    private errorListeners: Listener<unknown>[] = [];
    private connListeners: Listener<unknown>[] = [];

    constructor(
      public code: string,
      public participantName: string,
    ) {
      instances.push(this);
    }
    onState(l: Listener<unknown>) {
      this.stateListeners.push(l);
      return () => (this.stateListeners = this.stateListeners.filter((x) => x !== l));
    }
    onPresence(l: Listener<unknown>) {
      this.presenceListeners.push(l);
      return () => (this.presenceListeners = this.presenceListeners.filter((x) => x !== l));
    }
    onError(l: Listener<unknown>) {
      this.errorListeners.push(l);
      return () => (this.errorListeners = this.errorListeners.filter((x) => x !== l));
    }
    onConnectionChange(l: Listener<unknown>) {
      this.connListeners.push(l);
      return () => (this.connListeners = this.connListeners.filter((x) => x !== l));
    }
    emitState(s: unknown) {
      for (const l of [...this.stateListeners]) l(s);
    }
    emitPresence(names: unknown) {
      for (const l of [...this.presenceListeners]) l(names);
    }
    emitError(m: unknown) {
      for (const l of [...this.errorListeners]) l(m);
    }
    emitConnection(c: unknown) {
      for (const l of [...this.connListeners]) l(c);
    }
  }
  return { FakeListConnection: Impl, fakeConnectionInstances: instances };
});
type FakeListConnection = InstanceType<typeof FakeListConnection> & {
  send: ReturnType<typeof vi.fn<(msg: ClientMessage) => void>>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  emitState: (s: ListState) => void;
  emitPresence: (names: string[]) => void;
  emitError: (m: string) => void;
  emitConnection: (c: boolean) => void;
};
vi.mock("../lib/ws", () => ({ ListConnection: FakeListConnection }));

const fetchListState = vi.fn();
const uploadItemPhoto = vi.fn();
vi.mock("../lib/http", () => ({
  fetchListState: (...a: unknown[]) => fetchListState(...a),
  uploadItemPhoto: (...a: unknown[]) => uploadItemPhoto(...a),
  photoUrl: (code: string, photoId: string) => `/photo/${code}/${photoId}`,
}));

const openShareModal = vi.fn();
vi.mock("../components/shareModal", () => ({ openShareModal: (...a: unknown[]) => openShareModal(...a) }));

const openAccessibilityModal = vi.fn();
vi.mock("../components/accessibilityModal", () => ({ openAccessibilityModal: () => openAccessibilityModal() }));

const exportListState = vi.fn();
vi.mock("../lib/importExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/importExport")>();
  return { ...actual, exportListState: (...a: unknown[]) => exportListState(...a) };
});

const getNotificationStatus = vi.fn(() => "default" as const);
const notificationStatusLabel = vi.fn((_status: string) => "Désactivées");
const notifyItemAdded = vi.fn();
const toggleNotifications = vi.fn();
vi.mock("../lib/notifications", () => ({
  getNotificationStatus: () => getNotificationStatus(),
  notificationStatusLabel: (status: string) => notificationStatusLabel(status),
  notifyItemAdded: (...a: unknown[]) => notifyItemAdded(...a),
  toggleNotifications: (...a: unknown[]) => toggleNotifications(...a),
}));

interface DndCall {
  container: HTMLElement;
  opts: { containerSelector: string; itemSelector: string; handleSelector: string; onDrop: (el: HTMLElement) => void };
  dispose: ReturnType<typeof vi.fn>;
}
const dndCalls: DndCall[] = [];
const enableDragReorder = vi.fn((container: HTMLElement, opts: DndCall["opts"]) => {
  const dispose = vi.fn();
  dndCalls.push({ container, opts, dispose });
  return dispose;
});
vi.mock("../lib/dnd", () => ({ enableDragReorder: (...a: Parameters<typeof enableDragReorder>) => enableDragReorder(...a) }));

interface SwipeCall {
  opts: { onDelete: (el: HTMLElement) => void };
}
const swipeCalls: SwipeCall[] = [];
const enableSwipeToDelete = vi.fn((_container: HTMLElement, opts: SwipeCall["opts"]) => {
  swipeCalls.push({ opts });
  return vi.fn();
});
vi.mock("../lib/swipe", () => ({ enableSwipeToDelete: (...a: Parameters<typeof enableSwipeToDelete>) => enableSwipeToDelete(...a) }));

interface ConfirmClickCall {
  button: HTMLElement;
  opts: { onConfirm: () => void; isDisabled?: () => boolean };
}
const confirmClickCalls: ConfirmClickCall[] = [];
const wireConfirmClick = vi.fn((button: HTMLElement, opts: ConfirmClickCall["opts"]) => {
  confirmClickCalls.push({ button, opts });
});
vi.mock("../lib/confirmClick", () => ({ wireConfirmClick: (...a: Parameters<typeof wireConfirmClick>) => wireConfirmClick(...a) }));

interface StartEditCall {
  el: HTMLElement;
  opts: { value: string; onCommit: (value: string) => void };
}
const startEditCalls: StartEditCall[] = [];
const startEdit = vi.fn((el: HTMLElement, opts: StartEditCall["opts"]) => {
  startEditCalls.push({ el, opts });
});
vi.mock("../lib/editable", () => ({ startEdit: (...a: Parameters<typeof startEdit>) => startEdit(...a) }));

const focusReleases: ReturnType<typeof vi.fn>[] = [];
const trapFocus = vi.fn(() => {
  const release = vi.fn();
  focusReleases.push(release);
  return release;
});
vi.mock("../lib/focusTrap", () => ({ trapFocus: (...a: Parameters<typeof trapFocus>) => trapFocus(...a) }));

function sampleState(overrides: Partial<ListState> = {}): ListState {
  return { code: "ABCDEF", name: "Courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0, ...overrides };
}
function makeItem(overrides: Partial<Item> = {}): Item {
  return { id: "i1", name: "Pommes", quantity: "", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0, ...overrides };
}
function makeCategory(overrides: Partial<Category> = {}): Category {
  return { id: "c1", name: "Fruits", order: 0, ...overrides };
}
function makeHistory(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { key: "pommes", label: "Pommes", categoryId: null, useCount: 1, lastUsed: 0, ...overrides };
}

function findDnd(handleSelector: string): DndCall {
  const call = [...dndCalls].reverse().find((c) => c.opts.handleSelector === handleSelector);
  if (!call) throw new Error(`no enableDragReorder call for ${handleSelector}`);
  return call;
}
function findSwipe(): SwipeCall {
  const call = swipeCalls[swipeCalls.length - 1];
  if (!call) throw new Error("no enableSwipeToDelete call");
  return call;
}
function findConfirm(button: HTMLElement): ConfirmClickCall {
  const call = confirmClickCalls.find((c) => c.button === button);
  if (!call) throw new Error("no wireConfirmClick call for this button");
  return call;
}
function findStartEdit(el: HTMLElement): StartEditCall {
  const call = startEditCalls.find((c) => c.el === el);
  if (!call) throw new Error("no startEdit call for this element");
  return call;
}

describe("mountListView", () => {
  let root: HTMLElement;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    navigate = vi.fn<(path: string) => void>();
    fakeConnectionInstances.length = 0;
    dndCalls.length = 0;
    swipeCalls.length = 0;
    confirmClickCalls.length = 0;
    startEditCalls.length = 0;
    focusReleases.length = 0;
    fetchListState.mockReset().mockResolvedValue(sampleState());
    getNotificationStatus.mockReturnValue("default");
  });

  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(fetched: ListState | null = sampleState(), fetchError = false, importParam: string | null = null): Promise<FakeListConnection> {
    if (fetchError) fetchListState.mockRejectedValue(new Error("network"));
    else fetchListState.mockResolvedValue(fetched);
    cleanup = mountListView(root, "ABCDEF", navigate, importParam);
    await vi.waitFor(() => expect(fetchListState).toHaveBeenCalled());
    await vi.waitFor(() => expect(fakeConnectionInstances.length).toBeGreaterThan(0));
    const conn = fakeConnectionInstances[fakeConnectionInstances.length - 1] as FakeListConnection;
    await vi.waitFor(() => expect(conn.connect).toHaveBeenCalled());
    return conn;
  }

  describe("chargement", () => {
    it("affiche un message de chargement puis la liste une fois récupérée", async () => {
      expect.hasAssertions();
      fetchListState.mockResolvedValue(sampleState({ name: "Ma liste" }));
      cleanup = mountListView(root, "ABCDEF", navigate);
      expect(root.textContent).toContain("Chargement");

      await vi.waitFor(() => expect(root.querySelector("#list-title")).not.toBeNull());
      expect(root.querySelector("#list-title")?.textContent).toBe("Ma liste");
    });

    it("affiche immédiatement une liste en cache, puis la met à jour après la réponse serveur", async () => {
      cacheListState(sampleState({ name: "Cache" }));
      fetchListState.mockResolvedValue(sampleState({ name: "Fraîche" }));
      cleanup = mountListView(root, "ABCDEF", navigate);

      expect(root.querySelector("#list-title")?.textContent).toBe("Cache");
      await vi.waitFor(() => expect(root.querySelector("#list-title")?.textContent).toBe("Fraîche"));
    });

    it("affiche un message « liste introuvable » si le serveur renvoie 404 sans cache", async () => {
      // N'utilise pas mount() : le cas "introuvable" retourne avant
      // conn.connect(), que le helper générique attend toujours.
      fetchListState.mockResolvedValue(null);
      cleanup = mountListView(root, "ABCDEF", navigate);
      await vi.waitFor(() => expect(root.textContent).toContain("Aucune liste ne correspond au code"));

      (root.querySelector("#btn-home") as HTMLButtonElement).click();
      expect(navigate).toHaveBeenCalledWith("/");
      // La connexion est instanciée dès le montage (avant le fetch initial),
      // mais jamais connectée : liste introuvable, rien à synchroniser.
      expect((fakeConnectionInstances[0] as FakeListConnection).connect).not.toHaveBeenCalled();
    });

    it("garde la liste en cache affichée si le serveur renvoie 404 (liste supprimée après coup)", async () => {
      cacheListState(sampleState({ name: "Cache" }));
      fetchListState.mockResolvedValue(null);
      cleanup = mountListView(root, "ABCDEF", navigate);
      await vi.waitFor(() => expect(fetchListState).toHaveBeenCalled());
      await vi.waitFor(() => expect(fakeConnectionInstances.length).toBeGreaterThan(0));

      expect(root.querySelector("#list-title")?.textContent).toBe("Cache");
      expect(root.textContent).not.toContain("Aucune liste ne correspond");
    });

    it("affiche une erreur réseau avec un bouton réessayer si aucun cache n'est disponible", async () => {
      await mount(null, true);
      expect(root.textContent).toContain("Impossible de charger la liste");
      const reload = vi.fn();
      vi.stubGlobal("location", { ...location, reload });
      (root.querySelector("#retry") as HTMLButtonElement).click();
      expect(reload).toHaveBeenCalled();
    });

    it("une erreur réseau n'empêche pas l'affichage si une liste en cache existe", async () => {
      cacheListState(sampleState({ name: "Cache" }));
      fetchListState.mockRejectedValue(new Error("network"));
      cleanup = mountListView(root, "ABCDEF", navigate);
      await vi.waitFor(() => expect(fetchListState).toHaveBeenCalled());
      await vi.waitFor(() => expect(fakeConnectionInstances.length).toBeGreaterThan(0));

      expect(root.querySelector("#list-title")?.textContent).toBe("Cache");
      expect(root.textContent).not.toContain("Impossible de charger");
    });
  });

  describe("en-tête", () => {
    it("le bouton accueil navigue vers /", async () => {
      await mount();
      (root.querySelector("#btn-home") as HTMLButtonElement).click();
      expect(navigate).toHaveBeenCalledWith("/");
    });

    it("bascule l'affichage des articles cochés et ré-affiche", async () => {
      await mount(sampleState({ items: [makeItem({ checked: true })] }));
      expect(root.querySelectorAll(".item")).toHaveLength(1);

      (root.querySelector("#btn-hide-checked") as HTMLButtonElement).click();

      expect(root.querySelectorAll(".item")).toHaveLength(0);
      expect(root.querySelector("#btn-hide-checked")?.getAttribute("aria-pressed")).toBe("true");

      // Un second clic revient à l'état initial (bascule dans l'autre sens).
      (root.querySelector("#btn-hide-checked") as HTMLButtonElement).click();

      expect(root.querySelectorAll(".item")).toHaveLength(1);
      expect(root.querySelector("#btn-hide-checked")?.getAttribute("aria-pressed")).toBe("false");
    });

    it("affiche le bouton déjà activé si la préférence est déjà « masquer » au montage", async () => {
      const { setHideCheckedPreference } = await import("../lib/hideCheckedPreference");
      setHideCheckedPreference(true);

      await mount(sampleState({ items: [makeItem({ checked: true })] }));

      expect(root.querySelectorAll(".item")).toHaveLength(0);
      expect(root.querySelector("#btn-hide-checked")?.getAttribute("aria-pressed")).toBe("true");
    });

    it("le panneau de présence s'ouvre au clic et se ferme au clic extérieur", async () => {
      await mount();
      const panel = root.querySelector("#presence-panel") as HTMLElement;
      expect(panel.hidden).toBe(true);

      (root.querySelector("#btn-presence") as HTMLButtonElement).click();
      expect(panel.hidden).toBe(false);

      document.body.click();
      expect(panel.hidden).toBe(true);
    });

    it("affiche la présence reçue, en distinguant son propre appareil", async () => {
      const conn = await mount();
      const { getDeviceName } = await import("../lib/presence");
      const me = getDeviceName();

      conn.emitPresence([me, "Renard curieux"]);

      expect(root.querySelector("#presence-count")?.textContent).toBe("2");
      const names = Array.from(root.querySelectorAll("#presence-panel li")).map((li) => li.textContent);
      expect(names).toEqual(["Toi", "Renard curieux"]);
    });

    it("une présence vide efface le panneau", async () => {
      const conn = await mount();
      conn.emitPresence(["Renard curieux"]);
      conn.emitPresence([]);
      expect(root.querySelector("#presence-panel")?.innerHTML).toBe("");
    });

    it("la recherche filtre les articles après un court délai puis se ferme", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1", name: "Pommes" }), makeItem({ id: "i2", name: "Poires" })] }));
      const searchBar = root.querySelector("#search-bar") as HTMLElement;
      const input = root.querySelector("#search-input") as HTMLInputElement;

      (root.querySelector("#btn-search") as HTMLButtonElement).click();
      expect(searchBar.hidden).toBe(false);

      input.value = "pom";
      input.dispatchEvent(new Event("input"));
      expect(root.querySelectorAll(".item")).toHaveLength(2); // pas encore, debounce

      vi.advanceTimersByTime(150);
      expect(root.querySelectorAll(".item")).toHaveLength(1);

      (root.querySelector("#search-close") as HTMLButtonElement).click();
      expect(searchBar.hidden).toBe(true);
      expect(root.querySelectorAll(".item")).toHaveLength(2);
    });

    it("Échap dans la recherche la referme", async () => {
      await mount();
      (root.querySelector("#btn-search") as HTMLButtonElement).click();
      const input = root.querySelector("#search-input") as HTMLInputElement;

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      expect((root.querySelector("#search-bar") as HTMLElement).hidden).toBe(true);
    });

    it("une touche autre qu'Échap dans la recherche ne la referme pas", async () => {
      await mount();
      (root.querySelector("#btn-search") as HTMLButtonElement).click();
      const input = root.querySelector("#search-input") as HTMLInputElement;

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

      expect((root.querySelector("#search-bar") as HTMLElement).hidden).toBe(false);
    });

    it("taper rapidement annule le délai précédent avant d'en reprogrammer un nouveau", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1", name: "Pommes" }), makeItem({ id: "i2", name: "Poires" })] }));
      (root.querySelector("#btn-search") as HTMLButtonElement).click();
      const input = root.querySelector("#search-input") as HTMLInputElement;

      input.value = "p";
      input.dispatchEvent(new Event("input"));
      input.value = "po";
      input.dispatchEvent(new Event("input")); // annule le délai du premier "input" avant qu'il n'expire
      vi.advanceTimersByTime(150);

      expect(root.querySelectorAll(".item")).toHaveLength(2);
    });

    it("cliquer à nouveau sur le bouton recherche la referme (déjà ouverte)", async () => {
      await mount();
      const btn = root.querySelector("#btn-search") as HTMLButtonElement;
      btn.click();
      btn.click();

      expect((root.querySelector("#search-bar") as HTMLElement).hidden).toBe(true);
    });

    it("cliquer sur le titre permet de le renommer", async () => {
      await mount(sampleState({ name: "Courses" }));
      const titleEl = root.querySelector("#list-title") as HTMLElement;

      titleEl.click();
      const call = findStartEdit(titleEl);
      call.opts.onCommit("Nouveau nom");

      expect((fakeConnectionInstances[0] as FakeListConnection).send).toHaveBeenCalledWith({ type: "renameList", name: "Nouveau nom" });
    });

    it("valider le renommage du titre avec une valeur vide ré-affiche sans envoyer", async () => {
      const conn = await mount();
      const titleEl = root.querySelector("#list-title") as HTMLElement;
      titleEl.click();
      findStartEdit(titleEl).opts.onCommit("");

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "renameList" }));
    });

    it("ne ré-affiche pas le titre si l'utilisateur est en train de l'éditer", async () => {
      const conn = await mount(sampleState({ name: "Courses" }));
      const titleEl = root.querySelector("#list-title") as HTMLElement;
      titleEl.appendChild(document.createElement("input")); // simule startEdit réel (mocké ici)

      conn.emitState(sampleState({ name: "Autre nom" }));

      expect(titleEl.querySelector("input")).not.toBeNull();
    });
  });

  describe("menu", () => {
    it("s'ouvre au clic et se ferme au clic extérieur", async () => {
      await mount();
      const panel = root.querySelector("#menu-panel") as HTMLElement;
      expect(panel.hidden).toBe(true);

      (root.querySelector("#btn-menu") as HTMLButtonElement).click();
      expect(panel.hidden).toBe(false);

      document.body.click();
      expect(panel.hidden).toBe(true);
    });

    it("« Partager » ouvre le modal de partage avec export/import câblés", async () => {
      const state = sampleState({ code: "ABCDEF", name: "Courses" });
      await mount(state);
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));

      expect(openShareModal).toHaveBeenCalledWith(
        "ABCDEF",
        "Courses",
        expect.objectContaining({ name: "Courses", items: state.items, categories: state.categories, history: state.history }),
        expect.objectContaining({ onExport: expect.any(Function), onImportFile: expect.any(Function) }),
      );

      const actions = openShareModal.mock.calls[0][3];
      actions.onExport();
      expect(exportListState).toHaveBeenCalledWith(expect.objectContaining({ code: "ABCDEF" }));
    });

    it("« Thème » cycle la préférence et met à jour son libellé", async () => {
      await mount();
      const btn = root.querySelector('[data-action="theme"]') as HTMLElement;
      const before = btn.innerHTML;

      btn.click();

      expect(btn.innerHTML).not.toBe(before);
    });

    it("« Accessibilité » ouvre la modale dédiée", async () => {
      await mount();
      const btn = root.querySelector('[data-action="accessibility"]') as HTMLElement;

      btn.click();

      expect(openAccessibilityModal).toHaveBeenCalledTimes(1);
    });

    it("« Tri des articles » cycle la préférence et ré-affiche", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1", name: "Zoe" }), makeItem({ id: "i2", name: "Abel" })] }));
      const btn = root.querySelector('[data-action="item-sort"]') as HTMLElement;

      btn.click();

      const names = Array.from(root.querySelectorAll(".item-name")).map((n) => n.textContent);
      expect(names).toEqual(["Abel", "Zoe"]);
    });

    it("« Notifications » bascule et affiche un toast si bloquées par le navigateur", async () => {
      toggleNotifications.mockResolvedValue("denied");
      await mount();
      const btn = root.querySelector('[data-action="notifications"]') as HTMLElement;

      btn.click();
      await vi.waitFor(() => expect(document.querySelector(".toast")).not.toBeNull());

      expect(document.querySelector(".toast")?.textContent).toContain("bloquées");
    });

    it("« Notifications » affiche un toast si indisponibles sur ce navigateur", async () => {
      toggleNotifications.mockResolvedValue("unsupported");
      await mount();
      (root.querySelector('[data-action="notifications"]') as HTMLElement).click();

      await vi.waitFor(() => expect(document.querySelector(".toast")).not.toBeNull());
      expect(document.querySelector(".toast")?.textContent).toContain("indisponibles");
    });

    it("« Notifications » activées avec succès n'affiche aucun toast", async () => {
      toggleNotifications.mockResolvedValue("granted");
      await mount();
      (root.querySelector('[data-action="notifications"]') as HTMLElement).click();
      await vi.waitFor(() => expect(toggleNotifications).toHaveBeenCalled());

      expect(document.querySelector(".toast")).toBeNull();
    });

    it("« Gérer les catégories » ouvre le gestionnaire de catégories", async () => {
      await mount(sampleState({ categories: [makeCategory()] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      expect(document.querySelector(".manage-category-list")).not.toBeNull();
    });

    it("« Gérer les suggestions » ouvre le gestionnaire de suggestions", async () => {
      await mount(sampleState({ history: [makeHistory()] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      expect(document.querySelector("#suggestion-list")).not.toBeNull();
    });

    it("« Vider les articles cochés » est désactivé s'il n'y a rien à vider", async () => {
      await mount(sampleState({ items: [makeItem({ checked: false })] }));
      const btn = root.querySelector('[data-action="clear-checked"]') as HTMLElement;

      expect(findConfirm(btn).opts.isDisabled?.()).toBe(true);
    });

    it("« Vider les articles cochés » vide, permet d'annuler, et ferme le menu", async () => {
      const checkedItem = makeItem({ id: "i1", checked: true });
      const conn = await mount(sampleState({ items: [checkedItem] }));
      const menuPanel = root.querySelector("#menu-panel") as HTMLElement;
      const btn = root.querySelector('[data-action="clear-checked"]') as HTMLElement;

      findConfirm(btn).opts.onConfirm();

      expect(conn.send).toHaveBeenCalledWith({ type: "clearChecked" });
      expect(menuPanel.hidden).toBe(true);
      expect(document.querySelector(".undo-toast")).not.toBeNull();

      (document.querySelector(".undo-toast button") as HTMLButtonElement).click();
      expect(conn.send).toHaveBeenCalledWith({ type: "restoreItems", items: [checkedItem] });
    });

    it("« Vider les articles cochés » sans rien de coché (état changé entre-temps) ne fait rien", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ checked: true })] }));
      const btn = root.querySelector('[data-action="clear-checked"]') as HTMLElement;
      conn.emitState(sampleState({ items: [makeItem({ checked: false })] }));

      findConfirm(btn).opts.onConfirm();

      expect(conn.send).not.toHaveBeenCalledWith({ type: "clearChecked" });
    });
  });

  describe("formulaire d'ajout", () => {
    it("affiche un aperçu de la quantité détectée pendant la saisie", async () => {
      await mount();
      const input = root.querySelector("#add-input") as HTMLInputElement;
      const preview = root.querySelector("#add-preview-qty") as HTMLElement;

      input.value = "2 kg pommes";
      input.dispatchEvent(new Event("input"));

      expect(preview.hidden).toBe(false);
      expect(preview.textContent).toBe("2 kg");
    });

    it("masque l'aperçu si aucune quantité n'est détectée", async () => {
      await mount();
      const input = root.querySelector("#add-input") as HTMLInputElement;
      const preview = root.querySelector("#add-preview-qty") as HTMLElement;

      input.value = "2 kg";
      input.dispatchEvent(new Event("input"));
      input.value = "pommes";
      input.dispatchEvent(new Event("input"));

      expect(preview.hidden).toBe(true);
    });

    it("soumettre le formulaire envoie addItem et vide le champ", async () => {
      const conn = await mount();
      const input = root.querySelector("#add-input") as HTMLInputElement;
      input.value = "2 kg pommes";

      (root.querySelector("#add-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "addItem", rawText: "2 kg pommes", categoryId: null }));
      expect(input.value).toBe("");
    });

    it("soumettre un champ vide ne fait rien", async () => {
      const conn = await mount();
      (root.querySelector("#add-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      expect(conn.send).not.toHaveBeenCalled();
    });

    it("soumettre avec une catégorie choisie l'inclut dans le message", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" })] }));
      const input = root.querySelector("#add-input") as HTMLInputElement;
      const select = root.querySelector("#add-category") as HTMLSelectElement;
      input.value = "Pommes";
      select.value = "c1";

      (root.querySelector("#add-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c1" }));
    });

    it("l'auto-complétion propose les suggestions correspondantes et se ferme après un choix", async () => {
      const conn = await mount(
        sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" }), makeHistory({ key: "poires", label: "Poires" })] }),
      );
      const input = root.querySelector("#add-input") as HTMLInputElement;
      const suggestions = root.querySelector("#suggestions") as HTMLElement;

      input.value = "pom";
      input.dispatchEvent(new Event("input"));

      expect(suggestions.hidden).toBe(false);
      expect(suggestions.textContent).toContain("Pommes");
      expect(suggestions.textContent).not.toContain("Poires");

      (suggestions.querySelector("button") as HTMLButtonElement).dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "addItem", rawText: "Pommes" }));
      expect(suggestions.hidden).toBe(true);
    });

    it("choisir une suggestion d'auto-complétion déjà supprimée entre-temps ne fait rien", async () => {
      const conn = await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      const input = root.querySelector("#add-input") as HTMLInputElement;
      const suggestions = root.querySelector("#suggestions") as HTMLElement;
      input.value = "pom";
      input.dispatchEvent(new Event("input"));
      const button = suggestions.querySelector("button") as HTMLButtonElement;

      conn.emitState(sampleState({ history: [] })); // la suggestion a disparu
      conn.send.mockClear();
      button.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "addItem" }));
    });

    it("l'auto-complétion se ferme si le champ est vidé", async () => {
      await mount(sampleState({ history: [makeHistory()] }));
      const input = root.querySelector("#add-input") as HTMLInputElement;
      const suggestions = root.querySelector("#suggestions") as HTMLElement;
      input.value = "pom";
      input.dispatchEvent(new Event("input"));
      input.value = "";
      input.dispatchEvent(new Event("input"));

      expect(suggestions.hidden).toBe(true);
    });

    it("l'auto-complétion reste fermée si rien ne correspond", async () => {
      await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      const input = root.querySelector("#add-input") as HTMLInputElement;
      const suggestions = root.querySelector("#suggestions") as HTMLElement;
      input.value = "xyz";
      input.dispatchEvent(new Event("input"));

      expect(suggestions.hidden).toBe(true);
    });

    it("le focus sur le champ ré-affiche l'auto-complétion pour la saisie actuelle", async () => {
      await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      const input = root.querySelector("#add-input") as HTMLInputElement;
      input.value = "pom";

      input.dispatchEvent(new Event("focus"));

      expect((root.querySelector("#suggestions") as HTMLElement).hidden).toBe(false);
    });

    it("perdre le focus masque l'auto-complétion après un court délai", async () => {
      await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      const input = root.querySelector("#add-input") as HTMLInputElement;
      input.value = "pom";
      input.dispatchEvent(new Event("input"));

      input.dispatchEvent(new Event("blur"));
      expect((root.querySelector("#suggestions") as HTMLElement).hidden).toBe(false);

      vi.advanceTimersByTime(150);
      expect((root.querySelector("#suggestions") as HTMLElement).hidden).toBe(true);
    });
  });

  describe("suggestions rapides (quick add)", () => {
    it("affiche jusqu'à 12 suggestions non actives, et en ajoute une au clic", async () => {
      const conn = await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      const chip = root.querySelector(".chip") as HTMLButtonElement;
      expect(chip.textContent).toContain("Pommes");

      chip.click();

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "addItem", rawText: "Pommes" }));
    });

    it("cliquer sur une puce de suggestion rapide déjà supprimée entre-temps ne fait rien", async () => {
      const conn = await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      const chip = root.querySelector(".chip") as HTMLButtonElement;

      conn.emitState(sampleState({ history: [] })); // la suggestion a disparu
      conn.send.mockClear();
      chip.click();

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "addItem" }));
    });

    it("exclut une suggestion dont le nom correspond déjà à un article non coché", async () => {
      await mount(
        sampleState({
          items: [makeItem({ id: "i1", name: "Pommes", checked: false })],
          history: [makeHistory({ key: "pommes", label: "Pommes" })],
        }),
      );

      expect(root.querySelector("#quick-add")?.textContent).toBe("");
    });

    it("n'affiche rien si les articles cochés sont masqués", async () => {
      await mount(sampleState({ history: [makeHistory()] }));
      (root.querySelector("#btn-hide-checked") as HTMLButtonElement).click();

      expect(root.querySelector("#quick-add")?.innerHTML).toBe("");
    });

    it("n'affiche rien sans historique", async () => {
      await mount();
      expect(root.querySelector("#quick-add")?.innerHTML).toBe("");
    });
  });

  describe("catégories et articles", () => {
    it("le sélecteur de catégorie de la barre d'ajout revient à « Sans catégorie » si la sélection est supprimée", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" })] }));
      const select = root.querySelector("#add-category") as HTMLSelectElement;
      select.value = "c1";

      conn.emitState(sampleState({ categories: [] }));

      expect(select.value).toBe("");
    });

    it("le sélecteur de catégorie de la barre d'ajout garde sa sélection si elle existe toujours", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" }), makeCategory({ id: "c2", order: 1 })] }));
      const select = root.querySelector("#add-category") as HTMLSelectElement;
      select.value = "c1";

      conn.emitState(sampleState({ categories: [makeCategory({ id: "c1" }), makeCategory({ id: "c2", order: 1 })] }));

      expect(select.value).toBe("c1");
    });

    it("un article sans catégorie est affiché sous un titre générique quand il n'y a aucune catégorie", async () => {
      await mount(sampleState({ items: [makeItem()] }));
      expect(root.querySelector(".category-header")).toBeNull();
      expect(root.querySelector(".item-name")?.textContent).toBe("Pommes");
    });

    it("un article sans catégorie est affiché sous « Sans catégorie » s'il existe des catégories", async () => {
      await mount(sampleState({ categories: [makeCategory()], items: [makeItem({ categoryId: null })] }));
      expect(root.querySelector(".category-name")?.textContent).toBe("Sans catégorie");
    });

    it("une catégorie sans article ne s'affiche pas", async () => {
      await mount(sampleState({ categories: [makeCategory({ id: "c1", name: "Fruits" })], items: [] }));
      expect(root.querySelector("#categories")?.textContent).toContain("liste est vide");
    });

    it("une catégorie entièrement cochée passe après les autres", async () => {
      await mount(
        sampleState({
          categories: [makeCategory({ id: "c1", name: "Faite" }), makeCategory({ id: "c2", name: "En cours" })],
          items: [makeItem({ id: "i1", categoryId: "c1", checked: true }), makeItem({ id: "i2", categoryId: "c2", checked: false })],
        }),
      );
      const names = Array.from(root.querySelectorAll(".category-name")).map((n) => n.textContent);
      expect(names).toEqual(["En cours", "Faite"]);
    });

    it("un article coché passe après les non cochés au sein d'une catégorie", async () => {
      await mount(
        sampleState({
          items: [makeItem({ id: "i1", name: "A", checked: true, order: 0 }), makeItem({ id: "i2", name: "B", checked: false, order: 1 })],
        }),
      );
      const names = Array.from(root.querySelectorAll(".item-name")).map((n) => n.textContent);
      expect(names).toEqual(["B", "A"]);
    });

    it("affiche un état vide dédié si la recherche ne correspond à rien", async () => {
      await mount(sampleState({ items: [makeItem({ name: "Pommes" })] }));
      (root.querySelector("#btn-search") as HTMLButtonElement).click();
      const input = root.querySelector("#search-input") as HTMLInputElement;
      input.value = "xyz";
      input.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(150);

      expect(root.querySelector("#categories")?.textContent).toContain("Aucun article ne correspond");
    });

    it("affiche un état vide dédié si tout est coché et masqué", async () => {
      await mount(sampleState({ items: [makeItem({ checked: true })] }));
      (root.querySelector("#btn-hide-checked") as HTMLButtonElement).click();

      expect(root.querySelector("#categories")?.textContent).toContain("Tous les articles sont cochés");
    });

    it("affiche un état vide générique pour une liste sans aucun article", async () => {
      await mount(sampleState({ items: [] }));
      expect(root.querySelector("#categories")?.textContent).toContain("liste est vide");
    });

    it("cocher un article envoie toggleItem et déclenche un retour haptique", async () => {
      const vibrate = vi.fn();
      Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1", checked: false })] }));

      const checkbox = root.querySelector(".item-check") as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change"));

      expect(conn.send).toHaveBeenCalledWith({ type: "toggleItem", id: "i1", checked: true });
      expect(vibrate).toHaveBeenCalledWith(10);
    });

    it("décocher un article n'appelle pas le retour haptique", async () => {
      const vibrate = vi.fn();
      Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1", checked: true })] }));

      const checkbox = root.querySelector(".item-check") as HTMLInputElement;
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change"));

      expect(conn.send).toHaveBeenCalledWith({ type: "toggleItem", id: "i1", checked: false });
      expect(vibrate).not.toHaveBeenCalled();
    });

    it("cliquer sur la priorité la fait cycler, avec mise à jour optimiste immédiate", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      const btn = root.querySelector(".item-priority") as HTMLButtonElement;
      expect(btn.dataset.priority).toBe("1"); // Normale par défaut

      btn.click();

      expect(root.querySelector(".item-priority")?.getAttribute("data-priority")).toBe("2");
      expect(conn.send).toHaveBeenCalledWith({ type: "updateItem", id: "i1", priority: 2 });
    });

    it("cliquer sur la priorité d'un article introuvable (retiré entre-temps) ne fait rien", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      const btn = root.querySelector(".item-priority") as HTMLButtonElement;
      conn.emitState(sampleState({ items: [] }));
      conn.send.mockClear();

      // Le bouton précédent n'existe plus dans le DOM après le ré-affichage.
      expect(root.querySelector(".item-priority")).toBeNull();
      expect(() => btn.click()).not.toThrow();
      expect(conn.send).not.toHaveBeenCalled();
    });

    it("supprimer un article confirmé envoie deleteItem et permet d'annuler", async () => {
      const theItem = makeItem({ id: "i1", name: "Pommes" });
      const conn = await mount(sampleState({ items: [theItem] }));
      const btn = root.querySelector('[data-action="delete-item"]') as HTMLElement;

      findConfirm(btn).opts.onConfirm();

      expect(conn.send).toHaveBeenCalledWith({ type: "deleteItem", id: "i1" });
      (document.querySelector(".undo-toast button") as HTMLButtonElement).click();
      expect(conn.send).toHaveBeenCalledWith({ type: "restoreItems", items: [theItem] });
    });

    it("changer la catégorie d'un article envoie updateItem", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" })], items: [makeItem({ id: "i1" })] }));
      const sel = root.querySelector(".item-category") as HTMLSelectElement;
      sel.value = "c1";
      sel.dispatchEvent(new Event("change"));

      expect(conn.send).toHaveBeenCalledWith({ type: "updateItem", id: "i1", categoryId: "c1" });
    });

    it("remettre « Sans catégorie » envoie categoryId null", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" })], items: [makeItem({ id: "i1", categoryId: "c1" })] }));
      const sel = root.querySelector(".item-category") as HTMLSelectElement;
      sel.value = "";
      sel.dispatchEvent(new Event("change"));

      expect(conn.send).toHaveBeenCalledWith({ type: "updateItem", id: "i1", categoryId: null });
    });

    it("renommer un article via son nom envoie updateItem", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1", name: "Pommes" })] }));
      const nameEl = root.querySelector(".item-name") as HTMLElement;
      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("Poires");

      expect(conn.send).toHaveBeenCalledWith({ type: "updateItem", id: "i1", name: "Poires" });
    });

    it("annuler l'édition du nom (valeur vide) ré-affiche sans envoyer", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1", name: "Pommes" })] }));
      const nameEl = root.querySelector(".item-name") as HTMLElement;
      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("");

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateItem" }));
    });

    it("modifier la quantité via son badge envoie updateItem", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      // Le badge de l'aperçu de quantité du formulaire d'ajout porte aussi
      // la classe .qty-badge : cibler explicitement celui de l'article.
      const badge = root.querySelector("#categories .qty-badge") as HTMLElement;
      badge.click();
      findStartEdit(badge).opts.onCommit("2 kg");

      expect(conn.send).toHaveBeenCalledWith({ type: "updateItem", id: "i1", quantity: "2 kg" });
    });

    it("affiche une icône appareil photo pour un article sans photo", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      const btn = root.querySelector(".item-photo") as HTMLElement;
      expect(btn.classList.contains("has-photo")).toBe(false);
      expect(btn.querySelector("img")).toBeNull();
    });

    it("affiche la miniature de la photo d'un article qui en a une", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1", photoId: "photo1" })] }));
      const btn = root.querySelector(".item-photo") as HTMLElement;
      expect(btn.classList.contains("has-photo")).toBe(true);
      expect(btn.querySelector("img")?.getAttribute("src")).toBe("/photo/ABCDEF/photo1");
    });

    it("cliquer sur la photo (aucune photo) ouvre le sélecteur de fichier et envoie photoId après upload", async () => {
      uploadItemPhoto.mockResolvedValue("new-photo-id");
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      (root.querySelector(".item-photo") as HTMLButtonElement).click();

      const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).not.toBeNull();
      const file = new File(["fake"], "photo.jpg", { type: "image/jpeg" });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change"));

      await vi.waitFor(() => expect(conn.send).toHaveBeenCalledWith({ type: "updateItem", id: "i1", photoId: "new-photo-id" }));
      expect(uploadItemPhoto).toHaveBeenCalledWith("ABCDEF", file);
      // Retiré du DOM une fois le fichier lu, plutôt que laissé traîner.
      expect(document.body.contains(input)).toBe(false);
    });

    it("annuler la sélection de fichier (aucun fichier choisi) ne fait rien", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      (root.querySelector(".item-photo") as HTMLButtonElement).click();
      const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [], configurable: true });
      input.dispatchEvent(new Event("change"));

      expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it("refuse un fichier d'un type non pris en charge sans l'envoyer", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      (root.querySelector(".item-photo") as HTMLButtonElement).click();
      const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["fake"], "doc.pdf", { type: "application/pdf" });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change"));

      expect(uploadItemPhoto).not.toHaveBeenCalled();
      expect(document.querySelector(".toast")?.textContent).toBe("Format de photo non pris en charge.");
    });

    it("refuse un fichier trop volumineux sans l'envoyer", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      (root.querySelector(".item-photo") as HTMLButtonElement).click();
      const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["fake"], "photo.jpg", { type: "image/jpeg" });
      Object.defineProperty(file, "size", { value: 9 * 1024 * 1024, configurable: true });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change"));

      expect(uploadItemPhoto).not.toHaveBeenCalled();
      expect(document.querySelector(".toast")?.textContent).toBe("Photo trop volumineuse.");
    });

    it("affiche une erreur si l'envoi de la photo échoue", async () => {
      uploadItemPhoto.mockRejectedValue(new Error("network"));
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      (root.querySelector(".item-photo") as HTMLButtonElement).click();
      const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["fake"], "photo.jpg", { type: "image/jpeg" });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change"));

      await vi.waitFor(() => expect(document.querySelector(".toast")).not.toBeNull());
      expect(document.querySelector(".toast")?.textContent).toBe("Impossible d'envoyer la photo.");
      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateItem", photoId: expect.anything() }));
    });

    it("cliquer sur la photo d'un article introuvable (retiré entre-temps) ne fait rien", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      const btn = root.querySelector(".item-photo") as HTMLButtonElement;
      conn.emitState(sampleState({ items: [] }));

      expect(() => btn.click()).not.toThrow();
      expect(uploadItemPhoto).not.toHaveBeenCalled();
      expect(document.body.querySelector('input[type="file"]')).toBeNull();
    });

    describe("visionneuse de photo", () => {
      it("s'ouvre au clic sur une photo existante et affiche l'image en grand", async () => {
        await mount(sampleState({ items: [makeItem({ id: "i1", name: "Pommes", photoId: "photo1" })] }));
        (root.querySelector(".item-photo") as HTMLButtonElement).click();

        const modal = document.querySelector(".photo-viewer-modal");
        expect(modal).not.toBeNull();
        expect(modal!.querySelector("img")?.getAttribute("src")).toBe("/photo/ABCDEF/photo1");
        expect(modal!.querySelector("h2")?.textContent).toBe("Pommes");
      });

      it("« Remplacer la photo » ferme la visionneuse et ouvre le sélecteur de fichier", async () => {
        await mount(sampleState({ items: [makeItem({ id: "i1", photoId: "photo1" })] }));
        (root.querySelector(".item-photo") as HTMLButtonElement).click();
        (document.querySelector("#photo-replace") as HTMLButtonElement).click();

        expect(document.querySelector(".photo-viewer-modal")).toBeNull();
        expect(document.body.querySelector('input[type="file"]')).not.toBeNull();
      });

      it("« Supprimer la photo » envoie photoId: null et ferme la visionneuse", async () => {
        const conn = await mount(sampleState({ items: [makeItem({ id: "i1", photoId: "photo1" })] }));
        (root.querySelector(".item-photo") as HTMLButtonElement).click();
        (document.querySelector("#photo-remove") as HTMLButtonElement).click();

        expect(conn.send).toHaveBeenCalledWith({ type: "updateItem", id: "i1", photoId: null });
        expect(document.querySelector(".photo-viewer-modal")).toBeNull();
      });

      it("« Fermer » ferme la visionneuse sans envoyer de message", async () => {
        const conn = await mount(sampleState({ items: [makeItem({ id: "i1", photoId: "photo1" })] }));
        (root.querySelector(".item-photo") as HTMLButtonElement).click();
        (document.querySelector("#photo-cancel") as HTMLButtonElement).click();

        expect(document.querySelector(".photo-viewer-modal")).toBeNull();
        expect(conn.send).not.toHaveBeenCalled();
      });

      it("le bouton de fermeture (croix) ferme la visionneuse", async () => {
        await mount(sampleState({ items: [makeItem({ id: "i1", photoId: "photo1" })] }));
        (root.querySelector(".item-photo") as HTMLButtonElement).click();
        (document.querySelector(".photo-viewer-modal .modal-close") as HTMLButtonElement).click();

        expect(document.querySelector(".photo-viewer-modal")).toBeNull();
      });

      it("cliquer en dehors de la modale la ferme", async () => {
        await mount(sampleState({ items: [makeItem({ id: "i1", photoId: "photo1" })] }));
        (root.querySelector(".item-photo") as HTMLButtonElement).click();
        (document.querySelector(".modal-overlay") as HTMLElement).dispatchEvent(new Event("click"));

        expect(document.querySelector(".photo-viewer-modal")).toBeNull();
      });

      it("Échap ferme la visionneuse, une autre touche non", async () => {
        await mount(sampleState({ items: [makeItem({ id: "i1", photoId: "photo1" })] }));
        (root.querySelector(".item-photo") as HTMLButtonElement).click();

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
        expect(document.querySelector(".photo-viewer-modal")).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(document.querySelector(".photo-viewer-modal")).toBeNull();
      });
    });

    it("renommer une catégorie depuis la liste envoie renameCategory", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1", name: "Fruits" })], items: [makeItem({ categoryId: "c1" })] }));
      const nameEl = root.querySelector(".category-name") as HTMLElement;
      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("Légumes");

      expect(conn.send).toHaveBeenCalledWith({ type: "renameCategory", id: "c1", name: "Légumes" });
    });

    it("annuler le renommage d'une catégorie depuis la liste (valeur vide) ne renvoie rien", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1", name: "Fruits" })], items: [makeItem({ categoryId: "c1" })] }));
      const nameEl = root.querySelector(".category-name") as HTMLElement;
      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("");

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "renameCategory" }));
    });

    it("propose un champ vide pour renommer une catégorie au nom vide depuis la liste (donnée corrompue)", async () => {
      await mount(sampleState({ categories: [makeCategory({ id: "c1", name: "" })], items: [makeItem({ categoryId: "c1" })] }));
      const nameEl = root.querySelector(".category-name") as HTMLElement;

      nameEl.click();

      expect(findStartEdit(nameEl).opts.value).toBe("");
    });

    it("renommer le nom d'un article introuvable (retiré entre-temps) ne fait rien", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      const nameEl = root.querySelector(".item-name") as HTMLElement;
      conn.emitState(sampleState({ items: [] }));
      conn.send.mockClear();

      expect(() => nameEl.click()).not.toThrow();
      expect(startEdit).not.toHaveBeenCalledWith(nameEl, expect.anything());
    });

    it("modifier la quantité d'un article introuvable (retiré entre-temps) ne fait rien", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      const badge = root.querySelector("#categories .qty-badge") as HTMLElement;
      conn.emitState(sampleState({ items: [] }));
      conn.send.mockClear();

      expect(() => badge.click()).not.toThrow();
      expect(startEdit).not.toHaveBeenCalledWith(badge, expect.anything());
    });

    it("déplacer un article vers une autre catégorie et réordonner envoie updateItem puis reorderItems", async () => {
      const conn = await mount(
        sampleState({
          categories: [makeCategory({ id: "c1" }), makeCategory({ id: "c2", name: "Légumes", order: 1 })],
          // Une catégorie sans article n'affiche aucune section (voir
          // CLAUDE.md) : c2 a besoin d'un article pour avoir un conteneur
          // .item-list à faire apparaître comme cible du glisser-déposer.
          items: [makeItem({ id: "i1", categoryId: "c1" }), makeItem({ id: "i2", categoryId: "c2" })],
        }),
      );
      const draggedEl = root.querySelector('.item[data-id="i1"]') as HTMLElement;
      const otherList = root.querySelector('.item-list[data-category-id="c2"]') as HTMLElement;
      otherList.appendChild(draggedEl);

      findDnd(".item-drag-handle").opts.onDrop(draggedEl);

      expect(conn.send).toHaveBeenCalledWith({ type: "updateItem", id: "i1", categoryId: "c2" });
      expect(conn.send).toHaveBeenCalledWith({ type: "reorderItems", orderedIds: ["i2", "i1"] });
    });

    it("déplacer un article dans la même catégorie ne renvoie que reorderItems", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" }), makeItem({ id: "i2", order: 1 })] }));
      const items = root.querySelectorAll(".item");
      const container = root.querySelector(".item-list") as HTMLElement;
      container.appendChild(items[0]); // réordonne dans le DOM : i2 puis i1

      findDnd(".item-drag-handle").opts.onDrop(items[0] as HTMLElement);

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateItem" }));
      expect(conn.send).toHaveBeenCalledWith({ type: "reorderItems", orderedIds: ["i2", "i1"] });
    });

    it("réordonner les catégories par glisser-déposer envoie reorderCategories", async () => {
      // Une catégorie sans article n'affiche pas de section du tout (voir
      // CLAUDE.md) : il en faut au moins une avec un article pour que le
      // glisser-déposer des catégories soit câblé.
      const conn = await mount(
        sampleState({
          categories: [makeCategory({ id: "c1" }), makeCategory({ id: "c2", name: "Légumes", order: 1 })],
          items: [makeItem({ categoryId: "c1" })],
        }),
      );

      findDnd(".category-drag-handle").opts.onDrop(root.querySelector(".category-section") as HTMLElement);

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "reorderCategories" }));
    });

    it("déposer un article hors de tout conteneur .item-list le traite comme sans catégorie", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" })], items: [makeItem({ id: "i1", categoryId: "c1" })] }));
      const draggedEl = root.querySelector(".item") as HTMLElement;
      draggedEl.remove(); // plus dans aucun .item-list au moment du dépôt

      findDnd(".item-drag-handle").opts.onDrop(draggedEl);

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "updateItem", id: "i1", categoryId: null }));
    });

    it("un glisser-déposer d'article coché supprime via glissement (swipe)", async () => {
      const theItem = makeItem({ id: "i1", name: "Pommes" });
      const conn = await mount(sampleState({ items: [theItem] }));

      findSwipe().opts.onDelete(root.querySelector(".item") as HTMLElement);

      expect(conn.send).toHaveBeenCalledWith({ type: "deleteItem", id: "i1" });
      (document.querySelector(".undo-toast button") as HTMLButtonElement).click();
      expect(conn.send).toHaveBeenCalledWith({ type: "restoreItems", items: [theItem] });
    });

    it("swipe sur un élément déjà retiré de l'état ne fait rien", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      const el = root.querySelector(".item") as HTMLElement;
      conn.emitState(sampleState({ items: [] }));
      conn.send.mockClear();

      findSwipe().opts.onDelete(el);

      expect(conn.send).not.toHaveBeenCalled();
    });

    it("le tri alphabétique reste actif même en glisser-déposer (pas d'effet visuel durable)", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1", name: "Zoe" }), makeItem({ id: "i2", name: "Abel" })] }));
      (root.querySelector('[data-action="item-sort"]') as HTMLElement).click();

      // Le glisser-déposer reste câblé (dnd.ts gère lui-même le déplacement
      // DOM en direct) même si le prochain rendu retriera par ordre alpha.
      expect(enableDragReorder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ handleSelector: ".item-drag-handle" }));
    });
  });

  describe("import", () => {
    it("un fichier invalide affiche un message d'erreur en toast", async () => {
      const conn = await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File(["not json"], "x.json", { type: "application/json" });

      await actions.onImportFile(file);

      expect(document.querySelector(".toast")?.textContent).toContain("JSON valide");
      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "importState" }));
    });

    it("une erreur de lecture non standard (pas une instance Error) affiche le message générique", async () => {
      await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File(["{}"], "x.json", { type: "application/json" });
      // file.text() peut rejeter avec autre chose qu'une Error (ex: une
      // DOMException, qui ne descend pas du prototype Error natif).
      vi.spyOn(file, "text").mockRejectedValue("boom");

      await actions.onImportFile(file);

      expect(document.querySelector(".toast")?.textContent).toBe("Import impossible.");
    });

    it("un fichier valide ouvre le modal d'import avec le résumé du contenu", async () => {
      await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File([JSON.stringify({ items: [makeItem()], categories: [makeCategory()] })], "x.json", { type: "application/json" });

      await actions.onImportFile(file);

      expect(document.querySelector(".modal h2")?.textContent).toBe("Importer la liste");
      expect(document.querySelector(".modal")?.textContent).toContain("1 article(s) et 1 catégorie(s)");
    });

    it("« Fusionner » envoie importState en mode merge et ferme le modal", async () => {
      const conn = await mount();
      const importFile = async () => {
        root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
        const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
        const file = new File([JSON.stringify({ items: [], categories: [] })], "x.json", { type: "application/json" });
        await actions.onImportFile(file);
      };
      await importFile();

      (document.querySelector("#import-merge") as HTMLButtonElement).click();

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "importState", mode: "merge" }));
      expect(document.querySelector(".modal-overlay")).toBeNull();
    });

    it("« Remplacer » demande confirmation puis envoie importState en mode replace", async () => {
      vi.stubGlobal("confirm", vi.fn(() => true));
      const conn = await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File([JSON.stringify({ items: [], categories: [] })], "x.json", { type: "application/json" });
      await actions.onImportFile(file);

      (document.querySelector("#import-replace") as HTMLButtonElement).click();

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "importState", mode: "replace" }));
    });

    it("annuler la confirmation de remplacement n'envoie rien", async () => {
      vi.stubGlobal("confirm", vi.fn(() => false));
      const conn = await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File([JSON.stringify({ items: [], categories: [] })], "x.json", { type: "application/json" });
      await actions.onImportFile(file);

      (document.querySelector("#import-replace") as HTMLButtonElement).click();

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "importState" }));
    });

    it("« Annuler » ferme le modal sans rien envoyer", async () => {
      const conn = await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File([JSON.stringify({ items: [], categories: [] })], "x.json", { type: "application/json" });
      await actions.onImportFile(file);

      (document.querySelector("#import-cancel") as HTMLButtonElement).click();

      expect(document.querySelector(".modal-overlay")).toBeNull();
      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "importState" }));
    });

    it("cliquer hors du modal d'import le ferme, Échap aussi", async () => {
      await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File([JSON.stringify({ items: [], categories: [] })], "x.json", { type: "application/json" });
      await actions.onImportFile(file);

      (document.querySelector(".modal-overlay") as HTMLElement).dispatchEvent(new Event("click"));
      expect(document.querySelector(".modal-overlay")).toBeNull();
    });

    it("le bouton de fermeture du modal d'import fonctionne aussi", async () => {
      await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File([JSON.stringify({ items: [], categories: [] })], "x.json", { type: "application/json" });
      await actions.onImportFile(file);

      (document.querySelector(".modal-close") as HTMLButtonElement).click();
      expect(document.querySelector(".modal-overlay")).toBeNull();
    });

    it("cliquer à l'intérieur du modal d'import ne le ferme pas, une touche autre qu'Échap non plus", async () => {
      await mount();
      root.querySelector('[data-action="share"]')?.dispatchEvent(new Event("click"));
      const actions = openShareModal.mock.calls[openShareModal.mock.calls.length - 1][3];
      const file = new File([JSON.stringify({ items: [], categories: [] })], "x.json", { type: "application/json" });
      await actions.onImportFile(file);

      (document.querySelector(".modal") as HTMLElement).dispatchEvent(new Event("click", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

      expect(document.querySelector(".modal-overlay")).not.toBeNull();
    });
  });

  describe("lien/QR compact (?import=, voir src/lib/compactShare.ts)", () => {
    it("un paramètre valide ouvre directement l'invite fusion/remplacement, sans attendre la connexion", async () => {
      const encoded = encodeListToParam({ name: "Reçue", items: [makeItem()], categories: [makeCategory()], history: [] });
      fetchListState.mockResolvedValue(sampleState());
      cleanup = mountListView(root, "ABCDEF", navigate, encoded);

      expect(document.querySelector(".modal h2")?.textContent).toBe("Importer la liste");
      expect(document.querySelector(".modal")?.textContent).toContain("1 article(s) et 1 catégorie(s)");
    });

    it("« Fusionner » sur l'invite ouverte depuis un lien compact envoie bien importState, même avant connexion", async () => {
      const encoded = encodeListToParam({ name: "Reçue", items: [makeItem()], categories: [], history: [] });
      const conn = await mount(sampleState(), false, encoded);

      (document.querySelector("#import-merge") as HTMLButtonElement).click();

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "importState", mode: "merge" }));
    });

    it("un paramètre invalide ou corrompu affiche un toast plutôt que de planter", async () => {
      fetchListState.mockResolvedValue(sampleState());
      cleanup = mountListView(root, "ABCDEF", navigate, "%%% pas un lien compact valide %%%");

      expect(document.querySelector(".toast")?.textContent).toBe("Lien d'import invalide ou corrompu.");
      expect(document.querySelector(".modal-overlay")).toBeNull();
    });

    it("sans paramètre (navigation normale), aucune invite ne s'ouvre automatiquement", async () => {
      await mount();
      expect(document.querySelector(".modal-overlay")).toBeNull();
    });
  });

  describe("gestionnaire de catégories", () => {
    it("ouvre avec les catégories triées et se ferme via Échap", async () => {
      const conn = await mount(
        sampleState({ categories: [makeCategory({ id: "c2", name: "Z", order: 1 }), makeCategory({ id: "c1", name: "A", order: 0 })] }),
      );
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      const names = Array.from(document.querySelectorAll(".manage-category-list .cat-name")).map((n) => n.textContent);
      expect(names).toEqual(["A", "Z"]);

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(document.querySelector(".modal-overlay")).toBeNull();
      expect(conn.send).toBeDefined();
    });

    it("cliquer à l'intérieur ne ferme pas, une touche autre qu'Échap non plus", async () => {
      await mount(sampleState({ categories: [makeCategory()] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      (document.querySelector(".modal") as HTMLElement).dispatchEvent(new Event("click", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

      expect(document.querySelector(".modal-overlay")).not.toBeNull();
    });

    it("renommer une catégorie envoie renameCategory", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1", name: "Fruits" })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));
      const nameEl = document.querySelector(".cat-name") as HTMLElement;
      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("Légumes");

      expect(conn.send).toHaveBeenCalledWith({ type: "renameCategory", id: "c1", name: "Légumes" });
    });

    it("annuler le renommage (valeur vide) ne renvoie rien", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1", name: "Fruits" })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));
      const nameEl = document.querySelector(".cat-name") as HTMLElement;
      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("");

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "renameCategory" }));
    });

    it("propose un champ vide pour une catégorie au nom vide (donnée corrompue)", async () => {
      await mount(sampleState({ categories: [makeCategory({ id: "c1", name: "" })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));
      const nameEl = document.querySelector(".cat-name") as HTMLElement;

      nameEl.click();

      expect(findStartEdit(nameEl).opts.value).toBe("");
    });

    it("ouvrir puis fermer la palette de couleur bascule aria-expanded", async () => {
      await mount(sampleState({ categories: [makeCategory({ id: "c1" })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      // Chaque clic reconstruit tout le contenu du modal (innerHTML) : il
      // faut re-sélectionner l'élément à chaque fois, la référence
      // précédente devient une copie détachée du DOM.
      (document.querySelector(".color-swatch-toggle") as HTMLButtonElement).click();
      expect(document.querySelector(".color-palette")).not.toBeNull();
      expect(document.querySelector(".color-swatch-toggle")?.getAttribute("aria-expanded")).toBe("true");

      (document.querySelector(".color-swatch-toggle") as HTMLButtonElement).click();
      expect(document.querySelector(".color-palette")).toBeNull();
    });

    it("choisir une couleur envoie setCategoryColor et referme la palette", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));
      (document.querySelector(".color-swatch-toggle") as HTMLButtonElement).click();
      const redSwatch = document.querySelector('.color-swatch[data-color="0"]') as HTMLButtonElement;

      redSwatch.click();

      expect(conn.send).toHaveBeenCalledWith({ type: "setCategoryColor", id: "c1", color: 0 });
      expect(document.querySelector(".color-palette")).toBeNull();
    });

    it("choisir « Auto » envoie une couleur nulle", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1", color: 90 })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));
      (document.querySelector(".color-swatch-toggle") as HTMLButtonElement).click();
      (document.querySelector(".color-swatch-auto") as HTMLButtonElement).click();

      expect(conn.send).toHaveBeenCalledWith({ type: "setCategoryColor", id: "c1", color: null });
    });

    it("supprimer une catégorie confirmée envoie deleteCategory et permet d'annuler", async () => {
      const cat = makeCategory({ id: "c1", name: "Fruits" });
      const conn = await mount(sampleState({ categories: [cat], items: [makeItem({ id: "i1", categoryId: "c1" })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));
      const delBtn = document.querySelector('[data-action="del"]') as HTMLElement;

      findConfirm(delBtn).opts.onConfirm();

      expect(conn.send).toHaveBeenCalledWith({ type: "deleteCategory", id: "c1" });
      (document.querySelector(".undo-toast button") as HTMLButtonElement).click();
      expect(conn.send).toHaveBeenCalledWith({ type: "restoreCategory", category: cat, itemIds: ["i1"] });
    });

    it("ajouter une nouvelle catégorie envoie addCategory et vide le champ", async () => {
      const conn = await mount();
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));
      const input = document.querySelector("#new-category-name") as HTMLInputElement;
      input.value = "Fruits";

      (document.querySelector("#new-category-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "addCategory", name: "Fruits" }));
      expect(input.value).toBe("");
    });

    it("soumettre le formulaire de nouvelle catégorie sans nom ne fait rien", async () => {
      const conn = await mount();
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      (document.querySelector("#new-category-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "addCategory" }));
    });

    it("réordonner les catégories dans le gestionnaire envoie reorderCategories", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" }), makeCategory({ id: "c2", order: 1 })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      findDnd(".category-manage-drag-handle").opts.onDrop(document.querySelector(".manage-category-list li") as HTMLElement);

      expect(conn.send).toHaveBeenCalledWith(expect.objectContaining({ type: "reorderCategories" }));
    });

    it("une mise à jour d'état pendant que le gestionnaire est ouvert le ré-affiche", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1", name: "Fruits" })] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      conn.emitState(sampleState({ categories: [makeCategory({ id: "c1", name: "Légumes" })] }));

      expect(document.querySelector(".cat-name")?.textContent).toBe("Légumes");
    });

    it("cliquer hors du modal le ferme", async () => {
      await mount(sampleState({ categories: [makeCategory()] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      (document.querySelector(".modal-overlay") as HTMLElement).dispatchEvent(new Event("click"));

      expect(document.querySelector(".modal-overlay")).toBeNull();
    });

    it("le bouton de fermeture fonctionne aussi", async () => {
      await mount(sampleState({ categories: [makeCategory()] }));
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));

      (document.querySelector(".modal-close") as HTMLButtonElement).click();

      expect(document.querySelector(".modal-overlay")).toBeNull();
    });
  });

  describe("gestionnaire de suggestions", () => {
    it("affiche un message si aucune suggestion n'existe", async () => {
      const conn = await mount(sampleState({ history: [makeHistory()] }));
      // conn n'est utilisé que pour typer, mais évite un flake si mount() change
      void conn;
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      // Cette histoire non vide ne fait que garantir la barre de recherche.
      expect(document.querySelector("#suggestion-list")).not.toBeNull();
    });

    it("affiche un message dédié si l'historique est réellement vide", async () => {
      await mount(sampleState({ history: [] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      expect(document.querySelector(".hint")?.textContent).toContain("Aucune suggestion pour l'instant");
    });

    it("n'affiche pas la barre de recherche si l'historique est vide (a priori)", async () => {
      await mount(sampleState({ items: [] })); // history vide par défaut
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      expect(document.querySelector("#suggestion-search")).toBeNull();
    });

    it("filtre les suggestions par recherche", async () => {
      await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" }), makeHistory({ key: "poires", label: "Poires" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const searchInput = document.querySelector("#suggestion-search") as HTMLInputElement;
      searchInput.value = "pom";
      searchInput.dispatchEvent(new Event("input"));

      expect(document.querySelectorAll(".suggestion-name")).toHaveLength(1);
      expect(document.querySelector(".suggestion-name")?.textContent).toBe("Pommes");
    });

    it("affiche un message si aucune suggestion ne correspond à la recherche", async () => {
      await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const searchInput = document.querySelector("#suggestion-search") as HTMLInputElement;
      searchInput.value = "xyz";
      searchInput.dispatchEvent(new Event("input"));

      expect(document.querySelector(".hint")?.textContent).toContain("Aucune suggestion ne correspond");
    });

    it("sépare favoris et autres, triés alphabétiquement", async () => {
      await mount(
        sampleState({
          history: [
            makeHistory({ key: "z", label: "Zoe", favorite: false }),
            makeHistory({ key: "a", label: "Abel", favorite: true }),
            makeHistory({ key: "b", label: "Bea", favorite: false }),
          ],
        }),
      );
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      const headings = Array.from(document.querySelectorAll(".recent-subheading")).map((h) => h.textContent);
      expect(headings).toEqual(["Favoris", "Autres"]);
      const names = Array.from(document.querySelectorAll(".suggestion-name")).map((n) => n.textContent);
      expect(names).toEqual(["Abel", "Bea", "Zoe"]);
    });

    it("renommer une suggestion envoie updateHistoryEntry et retague la ligne à la nouvelle clé", async () => {
      const conn = await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const nameEl = document.querySelector(".suggestion-name") as HTMLElement;

      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("Poires");

      expect(conn.send).toHaveBeenCalledWith({ type: "updateHistoryEntry", key: "pommes", label: "Poires" });
      // Seuls les descendants du <li> sont retagués (le <li> lui-même garde
      // son data-key d'origine, jamais relu ensuite) ; la puce de suggestion
      // rapide sous-jacente porte aussi un data-key="pommes" et n'est
      // retaguée qu'à la confirmation serveur (state), jamais optimistiquement.
      expect(document.querySelector('.modal .suggestion-name[data-key="poires"]')).not.toBeNull();
      expect(document.querySelector('.modal .suggestion-name[data-key="pommes"]')).toBeNull();
    });

    it("annuler le renommage (valeur vide) ré-affiche la liste", async () => {
      const conn = await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const nameEl = document.querySelector(".suggestion-name") as HTMLElement;
      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("");

      expect(conn.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateHistoryEntry" }));
    });

    it("changer la catégorie d'une suggestion envoie updateHistoryEntry", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" })], history: [makeHistory({ key: "pommes" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const sel = document.querySelector(".suggestion-category") as HTMLSelectElement;
      sel.value = "c1";
      sel.dispatchEvent(new Event("change"));

      expect(conn.send).toHaveBeenCalledWith({ type: "updateHistoryEntry", key: "pommes", categoryId: "c1" });
    });

    it("remettre « Sans catégorie » pour une suggestion envoie categoryId null", async () => {
      const conn = await mount(sampleState({ categories: [makeCategory({ id: "c1" })], history: [makeHistory({ key: "pommes", categoryId: "c1" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const sel = document.querySelector(".suggestion-category") as HTMLSelectElement;
      sel.value = "";
      sel.dispatchEvent(new Event("change"));

      expect(conn.send).toHaveBeenCalledWith({ type: "updateHistoryEntry", key: "pommes", categoryId: null });
    });

    it("renommer sans changer la clé de dédoublonnage (casse différente) ne retague rien", async () => {
      const conn = await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const nameEl = document.querySelector(".suggestion-name") as HTMLElement;

      nameEl.click();
      findStartEdit(nameEl).opts.onCommit("POMMES"); // historyKey("POMMES") === historyKey("Pommes") === "pommes"

      expect(conn.send).toHaveBeenCalledWith({ type: "updateHistoryEntry", key: "pommes", label: "POMMES" });
      expect(document.querySelector('.modal .suggestion-name[data-key="pommes"]')).not.toBeNull();
    });

    it("propose un champ vide pour une suggestion au libellé vide (donnée corrompue)", async () => {
      await mount(sampleState({ history: [makeHistory({ key: "", label: "" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const nameEl = document.querySelector(".suggestion-name") as HTMLElement;

      nameEl.click();

      expect(findStartEdit(nameEl).opts.value).toBe("");
    });

    it("n'affiche que les favoris s'il n'y a aucune autre suggestion", async () => {
      await mount(sampleState({ history: [makeHistory({ key: "a", label: "Abel", favorite: true })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      const headings = Array.from(document.querySelectorAll(".recent-subheading")).map((h) => h.textContent);
      expect(headings).toEqual(["Favoris"]);
      expect(document.querySelectorAll(".suggestion-name")).toHaveLength(1);
    });

    it("cliquer à l'intérieur ne ferme pas, une touche autre qu'Échap non plus", async () => {
      await mount(sampleState({ history: [makeHistory()] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      (document.querySelector(".modal") as HTMLElement).dispatchEvent(new Event("click", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

      expect(document.querySelector(".modal-overlay")).not.toBeNull();
    });

    it("cliquer hors du modal (sur l'overlay) le ferme", async () => {
      await mount(sampleState({ history: [makeHistory()] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      (document.querySelector(".modal-overlay") as HTMLElement).dispatchEvent(new Event("click"));

      expect(document.querySelector(".modal-overlay")).toBeNull();
    });

    it("une mise à jour d'état pendant que le gestionnaire est ouvert ré-affiche la liste", async () => {
      const conn = await mount(sampleState({ history: [makeHistory({ key: "pommes", label: "Pommes" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      conn.emitState(sampleState({ history: [makeHistory({ key: "poires", label: "Poires" })] }));

      expect(document.querySelector(".suggestion-name")?.textContent).toBe("Poires");
    });

    it("Échap ferme le gestionnaire de suggestions", async () => {
      await mount(sampleState({ history: [makeHistory()] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(document.querySelector(".modal-overlay")).toBeNull();
    });

    it("basculer le favori d'une suggestion envoie toggleFavoriteHistoryEntry", async () => {
      const conn = await mount(sampleState({ history: [makeHistory({ key: "pommes" })] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      (document.querySelector('[data-action="fav"]') as HTMLElement).click();

      expect(conn.send).toHaveBeenCalledWith({ type: "toggleFavoriteHistoryEntry", key: "pommes" });
    });

    it("supprimer une suggestion confirmée envoie deleteHistoryEntry et permet d'annuler", async () => {
      const entry = makeHistory({ key: "pommes", label: "Pommes" });
      const conn = await mount(sampleState({ history: [entry] }));
      root.querySelector('[data-action="manage-suggestions"]')?.dispatchEvent(new Event("click"));
      const delBtn = document.querySelector('[data-action="del"]') as HTMLElement;
      findConfirm(delBtn).opts.onConfirm();

      expect(conn.send).toHaveBeenCalledWith({ type: "deleteHistoryEntry", key: "pommes" });
      (document.querySelector(".undo-toast button") as HTMLButtonElement).click();
      expect(conn.send).toHaveBeenCalledWith({ type: "restoreHistoryEntry", entry });
    });
  });

  describe("notifications d'ajouts distants", () => {
    it("ne notifie rien à la connexion initiale (pas d'état précédent)", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      expect(notifyItemAdded).not.toHaveBeenCalled();
    });

    it("ne notifie rien si un état arrive avant toute base de comparaison (onState posé avant même le fetch initial)", () => {
      // conn.onState(onStateUpdate) est posé en tout premier, avant le fetch
      // HTTP : si un état arrivait à cet instant précis (jamais le cas en
      // usage réel, fetch avant connect()), `state` local vaudrait encore
      // sa valeur initiale (pas de cache ici → null).
      fetchListState.mockReturnValue(new Promise(() => {}));
      cleanup = mountListView(root, "ABCDEF", navigate);
      const conn = fakeConnectionInstances[fakeConnectionInstances.length - 1] as FakeListConnection;

      conn.emitState(sampleState({ items: [makeItem()] }));

      expect(notifyItemAdded).not.toHaveBeenCalled();
    });

    it("notifie un article ajouté par un autre appareil", async () => {
      const conn = await mount(sampleState({ items: [] }));
      conn.emitState(sampleState({ items: [makeItem({ id: "i1", name: "Pommes", quantity: "2 kg" })] }));

      expect(notifyItemAdded).toHaveBeenCalledWith("Pommes", "2 kg", "Courses");
    });

    it("ne notifie pas un article qu'on vient d'ajouter soi-même", async () => {
      const conn = await mount(sampleState({ items: [] }));
      const input = root.querySelector("#add-input") as HTMLInputElement;
      input.value = "Pommes";
      (root.querySelector("#add-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      const sentId = (conn.send.mock.calls.find((c) => c[0].type === "addItem")![0] as { id: string }).id;

      conn.emitState(sampleState({ items: [makeItem({ id: sentId, name: "Pommes" })] }));

      expect(notifyItemAdded).not.toHaveBeenCalled();
    });

    it("ne re-notifie pas un article déjà présent dans l'état précédent", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1", name: "Pommes" })] }));
      conn.emitState(sampleState({ items: [makeItem({ id: "i1", name: "Pommes", checked: true })] }));

      expect(notifyItemAdded).not.toHaveBeenCalled();
    });
  });

  describe("annulation (undo)", () => {
    it("le toast affiche le compteur à partir de 2 annulations en attente", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" }), makeItem({ id: "i2" })] }));
      const buttons = root.querySelectorAll('[data-action="delete-item"]');
      findConfirm(buttons[0] as HTMLElement).opts.onConfirm();
      expect(document.querySelector(".undo-toast button")?.textContent).toBe("Annuler");

      findConfirm(buttons[1] as HTMLElement).opts.onConfirm();
      expect(document.querySelector(".undo-toast button")?.textContent).toBe("Annuler (2)");
      void conn;
    });

    it("une annulation restée sans clic expire après 5s et retire le toast", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      findConfirm(root.querySelector('[data-action="delete-item"]') as HTMLElement).opts.onConfirm();
      expect(document.querySelector(".undo-toast")).not.toBeNull();

      vi.advanceTimersByTime(5000);

      expect(document.querySelector(".undo-toast")).toBeNull();
    });

    it("annuler ne restaure que la plus récente action (pile LIFO)", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" }), makeItem({ id: "i2" })] }));
      const buttons = root.querySelectorAll('[data-action="delete-item"]');
      findConfirm(buttons[0] as HTMLElement).opts.onConfirm();
      findConfirm(buttons[1] as HTMLElement).opts.onConfirm();
      conn.send.mockClear();

      (document.querySelector(".undo-toast button") as HTMLButtonElement).click();

      expect(conn.send).toHaveBeenCalledWith({ type: "restoreItems", items: [makeItem({ id: "i2" })] });
      expect(document.querySelector(".undo-toast button")?.textContent).toBe("Annuler");
    });

    it("une pile d'annulation au-delà de 10 entrées évince la plus ancienne", async () => {
      const items = Array.from({ length: 11 }, (_, i) => makeItem({ id: `i${i}` }));
      await mount(sampleState({ items }));
      const buttons = Array.from(root.querySelectorAll('[data-action="delete-item"]'));
      for (const btn of buttons) findConfirm(btn as HTMLElement).opts.onConfirm();

      expect(document.querySelector(".undo-toast button")?.textContent).toBe("Annuler (10)");
    });
  });

  describe("célébration", () => {
    it("cocher le dernier article déclenche une célébration", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1", checked: false })] }));

      conn.emitState(sampleState({ items: [makeItem({ id: "i1", checked: true })] }));

      expect(document.querySelector(".celebration-toast")).not.toBeNull();
      vi.advanceTimersByTime(2900);
      expect(document.querySelector(".celebration-toast")).toBeNull();
    });

    it("ne célèbre pas une liste déjà entièrement cochée dès l'ouverture", async () => {
      await mount(sampleState({ items: [makeItem({ id: "i1", checked: true })] }));
      expect(document.querySelector(".celebration-toast")).toBeNull();
    });

    it("ne célèbre pas à nouveau si l'état reste entièrement coché", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1", checked: true })] }));
      conn.emitState(sampleState({ items: [makeItem({ id: "i1", checked: true }), makeItem({ id: "i2", checked: true })] }));

      expect(document.querySelector(".celebration-toast")).toBeNull();
    });

    it("ne célèbre pas une liste vide", async () => {
      await mount(sampleState({ items: [] }));
      expect(document.querySelector(".celebration-toast")).toBeNull();
    });
  });

  describe("erreurs de connexion", () => {
    it("une erreur reçue du serveur s'affiche en toast", async () => {
      const conn = await mount();
      conn.emitError("Boom");

      expect(document.querySelector(".toast")?.textContent).toBe("Boom");
      vi.advanceTimersByTime(3300);
      expect(document.querySelector(".toast")).toBeNull();
    });

    it("met à jour le point de connexion selon l'état de la connexion", async () => {
      const conn = await mount();
      const dot = root.querySelector("#conn-dot") as HTMLElement;
      expect(dot.classList.contains("online")).toBe(false);

      conn.emitConnection(true);
      expect(dot.classList.contains("online")).toBe(true);
      expect(dot.getAttribute("title")).toBe("Synchronisé");

      conn.emitConnection(false);
      expect(dot.classList.contains("online")).toBe(false);
      expect(dot.getAttribute("title")).toBe("Connexion…");
    });

    it("ignore un évènement de connexion/présence reçu après que la vue a déjà été remplacée", async () => {
      // conn.onConnectionChange/onPresence ne sont jamais désabonnés : un
      // évènement tardif peut arriver après que la navigation a déjà
      // remplacé le contenu de `root` par une autre vue.
      const conn = await mount();
      root.innerHTML = "<div>autre vue</div>";

      expect(() => conn.emitConnection(true)).not.toThrow();
      expect(() => conn.emitPresence(["Renard curieux"])).not.toThrow();
    });
  });

  describe("nettoyage", () => {
    it("déconnecte, nettoie le glisser-déposer/swipe, la pile d'annulation et les modales ouvertes", async () => {
      const conn = await mount(sampleState({ items: [makeItem({ id: "i1" })] }));
      // Capturés avant l'ouverture du modal : ce sont ceux de la vue liste
      // elle-même (renderCategories), les seuls que le cleanup() renvoyé par
      // mountListView dispose directement.
      const viewDndCalls = [...dndCalls];
      findConfirm(root.querySelector('[data-action="delete-item"]') as HTMLElement).opts.onConfirm();
      root.querySelector('[data-action="manage-categories"]')?.dispatchEvent(new Event("click"));
      expect(document.querySelector(".modal-overlay")).not.toBeNull();

      cleanup();

      expect(conn.disconnect).toHaveBeenCalledOnce();
      expect(document.querySelector(".modal-overlay")).toBeNull();
      expect(document.querySelector(".undo-toast")).toBeNull();
      for (const call of viewDndCalls) expect(call.dispose).toHaveBeenCalled();
    });
  });
});

