import type { Category, HistoryEntry, Item, ListState, Priority } from "../../shared/types";
import { parseFreeText } from "../../shared/quantity";
import { ListConnection } from "../lib/ws";
import { fetchListState, photoUrl, uploadItemPhoto } from "../lib/http";
import { isAllowedPhotoType, MAX_PHOTO_BYTES } from "../../shared/photo";
import { cacheListState, getCachedListState, touchRecentList } from "../lib/storage";
import { uid } from "../lib/id";
import { escapeHtml } from "../lib/dom";
import { startEdit } from "../lib/editable";
import { wireConfirmClick } from "../lib/confirmClick";
import { enableDragReorder } from "../lib/dnd";
import { enableSwipeToDelete } from "../lib/swipe";
import { openShareModal } from "../components/shareModal";
import { exportListState, parseImportFile, toImportPayload } from "../lib/importExport";
import { decodeListFromParam } from "../lib/compactShare";
import { icons } from "../lib/icons";
import { trapFocus } from "../lib/focusTrap";
import { resolveCategoryHue } from "../lib/color";
import { alnumCompare } from "../lib/sort";
import { cycleThemePreference, getThemePreference, themeLabel, type ThemePreference } from "../lib/theme";
import { toggleAccessibilityPreference, getAccessibilityPreference, accessibilityLabel } from "../lib/accessibilityPreference";
import { cycleItemSortPreference, getItemSortPreference, itemSortLabel } from "../lib/itemSortPreference";
import { getHideCheckedPreference, toggleHideCheckedPreference } from "../lib/hideCheckedPreference";
import { getDeviceName } from "../lib/presence";
import { historyKey } from "../../shared/historyKey";
import { PRIVACY_HINT } from "../lib/privacyHint";
import { getNotificationStatus, notificationStatusLabel, notifyItemAdded, toggleNotifications } from "../lib/notifications";

const THEME_ICON: Record<ThemePreference, string> = { system: icons.themeAuto, light: icons.sun, dark: icons.moon };

// Palette de teintes proposées pour la couleur manuelle d'une catégorie
// (voir colorPaletteHtml) — un choix curé plutôt qu'un sélecteur de couleur
// libre, pour rester cohérent avec le rendu HSL (saturation/luminosité
// fixes) utilisé partout ailleurs pour l'accent de couleur automatique.
const CATEGORY_COLOR_HUES: readonly { hue: number; name: string }[] = [
  { hue: 0, name: "Rouge" },
  { hue: 30, name: "Orange" },
  { hue: 60, name: "Jaune" },
  { hue: 90, name: "Citron vert" },
  { hue: 120, name: "Vert" },
  { hue: 150, name: "Émeraude" },
  { hue: 180, name: "Turquoise" },
  { hue: 210, name: "Bleu ciel" },
  { hue: 240, name: "Bleu" },
  { hue: 270, name: "Indigo" },
  { hue: 300, name: "Violet" },
  { hue: 330, name: "Rose" },
];

// Item sans priority explicite (créé avant l'introduction du champ) :
// traité comme Normale, pour ne rien changer à l'ordre existant.
const PRIORITY_LABELS = ["Basse", "Normale", "Haute"] as const;
// Ne fait pas confiance à item.priority au-delà de sa forme réelle : le
// serveur le valide désormais (voir worker/reducer.ts), mais data-priority
// n'est pas échappé à l'affichage ci-dessous (c'est un simple entier), donc
// une valeur déjà persistée avant ce contrôle (ou tout autre bug futur) ne
// doit jamais s'y retrouver telle quelle.
const priorityOf = (item: Item): Priority => (item.priority === 0 || item.priority === 1 || item.priority === 2 ? item.priority : 1);
const cyclePriority = (p: Priority): Priority => (((p + 1) % 3) as Priority);

function colorPaletteHtml(category: Category): string {
  const autoSelected = category.color === undefined;
  const autoSwatch = `<button type="button" class="color-swatch color-swatch-auto${autoSelected ? " selected" : ""}" data-color="auto" aria-label="Couleur automatique" aria-pressed="${autoSelected}">Auto</button>`;
  const hueSwatches = CATEGORY_COLOR_HUES.map(({ hue, name }) => {
    const selected = category.color === hue;
    return `<button type="button" class="color-swatch${selected ? " selected" : ""}" data-color="${hue}" style="--swatch-hue: ${hue}" aria-label="${name}" aria-pressed="${selected}"></button>`;
  }).join("");
  return `<div class="color-palette">${autoSwatch}${hueSwatches}</div>`;
}

export function mountListView(
  root: HTMLElement,
  code: string,
  navigate: (path: string) => void,
  importParam: string | null = null,
): () => void {
  let state: ListState | null = getCachedListState(code);
  let connected = false;
  let loading = state === null;
  let notFound = false;
  let loadError = false;
  let disposeItemDnd: (() => void) | null = null;
  let disposeCategoryDnd: (() => void) | null = null;
  let disposeSwipe: (() => void) | null = null;
  let shellMounted = false;
  let searchQuery = "";
  // null = pas encore évalué (évite de célébrer à l'ouverture d'une liste
  // déjà entièrement cochée) ; sinon, reflète l'état à la dernière vérification.
  let wasFullyChecked: boolean | null = null;
  // Id des articles qu'on vient d'ajouter/restaurer soi-même (addItem,
  // restoreItems) : le serveur rediffuse l'état entier à tout le monde, y
  // compris à son propre auteur, donc sans ça notifyRemoteAdditions (voir
  // onStateUpdate) nous notifierait nos propres ajouts.
  const pendingLocalItemIds = new Set<string>();
  const conn = new ListConnection(code, getDeviceName());

  const UNDO_TIMEOUT_MS = 5000;
  const MAX_UNDO_STACK = 10;
  interface UndoEntry {
    label: string;
    undo: () => void;
    timer: ReturnType<typeof setTimeout>;
  }
  let undoEntries: UndoEntry[] = [];

  function pushUndo(label: string, undo: () => void): void {
    const entry: UndoEntry = {
      label,
      undo,
      timer: setTimeout(() => {
        undoEntries = undoEntries.filter((e) => e !== entry);
        renderUndoToast();
      }, UNDO_TIMEOUT_MS),
    };
    undoEntries.push(entry);
    if (undoEntries.length > MAX_UNDO_STACK) {
      // shift() ne peut renvoyer undefined que sur un tableau vide, ce que
      // la condition ci-dessus exclut déjà (longueur > MAX_UNDO_STACK >= 1).
      clearTimeout(undoEntries.shift()!.timer);
    }
    renderUndoToast();
  }

  function undoLast(): void {
    // Le bouton "Annuler" n'est affiché (voir renderUndoToast) que lorsque
    // undoEntries n'est pas vide, et c'est le seul appelant de undoLast().
    const entry = undoEntries.pop()!;
    clearTimeout(entry.timer);
    entry.undo();
    renderUndoToast();
  }

  function clearUndoStack(): void {
    for (const entry of undoEntries) clearTimeout(entry.timer);
    undoEntries = [];
    document.getElementById("undo-toast")?.remove();
  }

  function renderUndoToast(): void {
    let el = document.getElementById("undo-toast");
    if (undoEntries.length === 0) {
      el?.remove();
      return;
    }
    const last = undoEntries[undoEntries.length - 1];
    if (!el) {
      el = document.createElement("div");
      el.id = "undo-toast";
      el.className = "undo-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.innerHTML = `<span></span><button type="button">Annuler${undoEntries.length > 1 ? ` (${undoEntries.length})` : ""}</button>`;
    el.querySelector("span")!.textContent = last.label;
    el.querySelector("button")!.addEventListener("click", undoLast);
  }

  function onStateUpdate(next: ListState) {
    const previous = state;
    state = next;
    loading = false;
    notFound = false;
    cacheListState(next);
    touchRecentList(next.code, next.name);
    notifyRemoteAdditions(previous, next);
    render();
  }

  // Compare l'état précédent au nouveau plutôt que d'écouter un message
  // particulier : le serveur ne rediffuse jamais autre chose qu'un état
  // complet (voir CLAUDE.md, protocole de synchronisation), il n'y a pas de
  // message "addItem" à observer côté client une fois confirmé.
  function notifyRemoteAdditions(previous: ListState | null, next: ListState): void {
    // Pas de base de comparaison : première connexion (état initial), pas
    // un ajout en direct — ne pas notifier tout l'historique existant.
    if (!previous) return;
    const previousIds = new Set(previous.items.map((i) => i.id));
    for (const item of next.items) {
      if (previousIds.has(item.id)) continue;
      if (pendingLocalItemIds.delete(item.id)) continue;
      void notifyItemAdded(item.name, item.quantity, next.name);
    }
  }

  conn.onState(onStateUpdate);
  conn.onPresence((names) => renderPresence(names));
  conn.onConnectionChange((isConnected) => {
    connected = isConnected;
    updateConnDot();
  });
  conn.onError((message) => showToast(message));

  // Lien/QR compact (voir src/lib/compactShare.ts, src/main.ts) : réutilise
  // le même choix fusion/remplacement qu'un import de fichier JSON
  // (openImportModal), plutôt que de dupliquer ce flux — conn.send() met en
  // file d'attente tant que le WebSocket n'est pas encore connecté, donc pas
  // besoin d'attendre conn.connect() ci-dessous pour ouvrir l'invite.
  if (importParam !== null) {
    const imported = decodeListFromParam(importParam);
    if (imported) openImportModal(imported);
    else showToast("Lien d'import invalide ou corrompu.");
  }

  (async () => {
    try {
      const fetched = await fetchListState(code);
      if (!fetched) {
        if (!state) {
          notFound = true;
          loading = false;
          render();
          return;
        }
      } else {
        state = fetched;
        cacheListState(fetched);
        touchRecentList(fetched.code, fetched.name);
      }
    } catch {
      loadError = state === null;
    }
    loading = false;
    render();
    conn.connect();
  })();

  render();

  function render(): void {
    if (notFound) {
      root.innerHTML = notFoundHtml(code);
      root.querySelector("#btn-home")?.addEventListener("click", () => navigate("/"));
      return;
    }
    if (loading && !state) {
      root.innerHTML = `<div class="centered-message"><p>Chargement…</p></div>`;
      return;
    }
    if (loadError && !state) {
      root.innerHTML = `<div class="centered-message"><p>Impossible de charger la liste. Vérifie ta connexion.</p><button class="btn" id="retry">Réessayer</button></div>`;
      root.querySelector("#retry")?.addEventListener("click", () => location.reload());
      return;
    }
    // Les trois branches ci-dessus couvrent exhaustivement tous les cas où
    // state peut être nul (jamais réassigné à null une fois non-nul) : au
    // delà de ce point, garanti non-nul pour le reste du module.

    if (!shellMounted) {
      // Built only once: re-creating this on every realtime update would
      // wipe out whatever the user is currently typing in the add-item
      // input whenever a broadcast arrives (e.g. someone else adds an item
      // while you're composing yours).
      root.innerHTML = layoutHtml(state!);
      wireHeader();
      wireAddForm();
      wireMenu();
      shellMounted = true;
    } else {
      updateTitle();
      updateCategorySelect();
    }
    renderCategories();
    renderQuickAdd();
    updateItemCounter();
    checkCelebration();
  }

  function updateItemCounter(): void {
    // Toujours appelée juste après que le gabarit contenant #item-counter a
    // été construit (voir render()), et state garanti non-nul à ce stade.
    const el = root.querySelector("#item-counter")!;
    const total = state!.items.length;
    if (total === 0) {
      el.textContent = "";
      return;
    }
    const checked = state!.items.filter((i) => i.checked).length;
    el.textContent = `${checked}/${total}`;
  }

  function checkCelebration(): void {
    const isFullyChecked = state!.items.length > 0 && state!.items.every((i) => i.checked);
    if (wasFullyChecked !== null && isFullyChecked && !wasFullyChecked) celebrate();
    wasFullyChecked = isFullyChecked;
  }

  function celebrate(): void {
    const el = document.createElement("div");
    el.className = "celebration-toast";
    el.setAttribute("role", "status");
    el.textContent = "🎉 Tout est dans le chariot !";
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("visible"));
    setTimeout(() => {
      el.classList.remove("visible");
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  function updateTitle(): void {
    // Appelée uniquement une fois le gabarit déjà construit (voir render()),
    // #list-title et state garantis présents à ce stade.
    const titleEl = root.querySelector("#list-title") as HTMLElement;
    if (titleEl.querySelector("input")) return; // user is mid-edit, don't clobber
    if (titleEl.textContent !== state!.name) titleEl.textContent = state!.name;
  }

  function updateCategorySelect(): void {
    const select = root.querySelector("#add-category") as HTMLSelectElement;
    const previous = select.value;
    select.innerHTML = categoryOptionsHtml(state!.categories);
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  function updateConnDot(): void {
    const dot = root.querySelector("#conn-dot");
    if (!dot) return;
    dot.classList.toggle("online", connected);
    dot.setAttribute("title", connected ? "Synchronisé" : "Connexion…");
  }

  function renderPresence(names: string[]): void {
    const countEl = root.querySelector("#presence-count");
    if (countEl) countEl.textContent = String(names.length);
    const panel = root.querySelector("#presence-panel");
    if (!panel) return;
    const ownName = getDeviceName();
    if (names.length === 0) {
      panel.innerHTML = "";
      return;
    }
    const items = names.map((n) => (n === ownName ? "Toi" : n));
    panel.innerHTML = `<ul class="presence-list">${items.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`;
  }

  // wireHeader()/wireMenu() ne s'exécutent qu'une fois le gabarit statique de
  // layoutHtml() déjà en place (voir render()) : chaque élément qu'elles
  // interrogent y est garanti présent, d'où les affirmations de type
  // non-nul plutôt que des `?.`/`if` redondants à chaque usage.
  function wireHeader(): void {
    root.querySelector("#btn-home")!.addEventListener("click", () => navigate("/"));
    root.querySelector("#btn-hide-checked")!.addEventListener("click", (e) => {
      toggleHideCheckedPreference();
      updateHideCheckedButton(e.currentTarget as HTMLElement);
      renderCategories();
      renderQuickAdd();
    });

    const presenceBtn = root.querySelector("#btn-presence")!;
    const presencePanel = root.querySelector("#presence-panel") as HTMLElement;
    presenceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      presencePanel.hidden = !presencePanel.hidden;
    });
    document.addEventListener("click", () => {
      presencePanel.hidden = true;
    });

    const searchBar = root.querySelector("#search-bar") as HTMLElement;
    const searchInput = root.querySelector("#search-input") as HTMLInputElement;
    let searchDebounce: ReturnType<typeof setTimeout> | null = null;
    const closeSearch = () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchBar.hidden = true;
      searchQuery = "";
      searchInput.value = "";
      renderCategories();
    };
    root.querySelector("#btn-search")!.addEventListener("click", () => {
      searchBar.hidden = !searchBar.hidden;
      if (!searchBar.hidden) searchInput.focus();
      else closeSearch();
    });
    root.querySelector("#search-close")!.addEventListener("click", closeSearch);
    searchInput.addEventListener("input", () => {
      // Attend une courte pause dans la frappe avant de reconstruire toute
      // la liste (renderCategories() n'est pas incrémental) : sur une liste
      // chargée, filtrer à chaque caractère tapé referait tout le travail à
      // chaque frappe pour rien.
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchQuery = searchInput.value;
        renderCategories();
      }, 150);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSearch();
    });
    const titleEl = root.querySelector("#list-title") as HTMLElement;
    titleEl.addEventListener("click", () => {
      startEdit(titleEl, {
        value: state!.name,
        onCommit: (value) => {
          if (value) conn.send({ type: "renameList", name: value });
          else render();
        },
      });
    });
  }

  function wireMenu(): void {
    const menuBtn = root.querySelector("#btn-menu")!;
    const panel = root.querySelector("#menu-panel") as HTMLElement;
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
    });
    document.addEventListener("click", () => {
      panel.hidden = true;
    });

    panel.querySelector('[data-action="share"]')!.addEventListener("click", () => {
      openShareModal(state!.code, state!.name, toImportPayload(state!), {
        onExport: () => {
          exportListState(state!);
        },
        onImportFile: handleImportFile,
      });
    });
    panel.querySelector('[data-action="theme"]')!.addEventListener("click", (e) => {
      cycleThemePreference();
      updateThemeMenuItem(e.currentTarget as HTMLElement);
    });
    panel.querySelector('[data-action="accessibility"]')!.addEventListener("click", (e) => {
      toggleAccessibilityPreference();
      updateAccessibilityMenuItem(e.currentTarget as HTMLElement);
    });
    panel.querySelector('[data-action="item-sort"]')!.addEventListener("click", (e) => {
      cycleItemSortPreference();
      updateItemSortMenuItem(e.currentTarget as HTMLElement);
      renderCategories();
    });
    panel.querySelector('[data-action="notifications"]')!.addEventListener("click", (e) => {
      // e.currentTarget devient null une fois l'événement terminé : on le
      // capture avant l'attente de toggleNotifications() (permission
      // navigateur potentiellement asynchrone).
      const button = e.currentTarget as HTMLElement;
      toggleNotifications().then((status) => {
        updateNotificationsMenuItem(button);
        if (status === "denied") showToast("Notifications bloquées : autorise-les dans les réglages du navigateur pour ce site.");
        else if (status === "unsupported") showToast("Notifications indisponibles sur ce navigateur.");
      });
    });
    panel.querySelector('[data-action="manage-categories"]')!.addEventListener("click", openCategoryManager);
    panel.querySelector('[data-action="manage-suggestions"]')!.addEventListener("click", openSuggestionManager);
    const clearCheckedBtn = panel.querySelector<HTMLButtonElement>('[data-action="clear-checked"]')!;
    wireConfirmClick(clearCheckedBtn, {
      armedText: "Confirmer : tout vider ?",
      labelEl: clearCheckedBtn.querySelector<HTMLElement>(".menu-item-label")!,
      isDisabled: () => state!.items.filter((i) => i.checked).length === 0,
      onConfirm: () => {
        const checkedItems = state!.items.filter((i) => i.checked);
        if (checkedItems.length === 0) return;
        conn.send({ type: "clearChecked" });
        pushUndo(`${checkedItems.length} article(s) coché(s) vidé(s)`, () => {
          for (const item of checkedItems) pendingLocalItemIds.add(item.id);
          conn.send({ type: "restoreItems", items: checkedItems });
        });
        panel.hidden = true;
      },
    });
  }

  async function handleImportFile(file: File): Promise<void> {
    try {
      const data = await parseImportFile(file);
      openImportModal(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Import impossible.");
    }
  }

  function openImportModal(data: Awaited<ReturnType<typeof parseImportFile>>): void {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
        <button class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
        <h2>Importer la liste</h2>
        <p>${data.items.length} article(s) et ${data.categories.length} catégorie(s) trouvés dans le fichier.</p>
        <div class="stacked-actions">
          <button class="btn primary" id="import-merge">Fusionner avec la liste actuelle</button>
          <button class="btn danger" id="import-replace">Remplacer la liste actuelle</button>
          <button class="btn" id="import-cancel">Annuler</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const releaseFocusTrap = trapFocus(overlay.querySelector(".modal")!);
    const close = () => {
      overlay.remove();
      releaseFocusTrap();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onImportKeydown);
    function onImportKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onImportKeydown);
        close();
      }
    }
    overlay.querySelector(".modal-close")?.addEventListener("click", close);
    overlay.querySelector("#import-cancel")?.addEventListener("click", close);
    overlay.querySelector("#import-merge")?.addEventListener("click", () => {
      conn.send({ type: "importState", mode: "merge", data });
      close();
    });
    overlay.querySelector("#import-replace")?.addEventListener("click", () => {
      if (confirm("Remplacer entièrement la liste actuelle par le contenu du fichier ?")) {
        conn.send({ type: "importState", mode: "replace", data });
        close();
      }
    });
  }

  // Un <input type=file> créé/déclenché/retiré à la volée plutôt qu'un champ
  // permanent dans layoutHtml() : évite un état caché à réinitialiser entre
  // deux photos. Pas de `capture="environment"` : il permet bien de choisir
  // une image déjà existante (galerie/fichiers) en plus de prendre une
  // photo sur certains navigateurs/OS, mais pas partout de façon fiable —
  // certaines combinaisons Android/WebView plus anciennes ouvrent
  // directement l'appareil photo sans proposer d'alternative. Sans cet
  // attribut, le sélecteur de fichier natif standard s'affiche partout de
  // la même façon (photo, galerie ou fichier, au choix), ce qui correspond
  // à l'intention : envoyer une image quelconque, pas seulement une photo
  // prise sur le vif.
  function triggerPhotoPicker(itemId: string): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (file) void handlePhotoFile(itemId, file);
    });
    document.body.appendChild(input);
    input.click();
  }

  async function handlePhotoFile(itemId: string, file: File): Promise<void> {
    // Revalidé côté serveur de toute façon (voir worker/index.ts) : ces deux
    // contrôles côté client ne font qu'éviter un aller-retour réseau pour un
    // fichier qu'on sait déjà rejeter (mauvais type, ou trop volumineux).
    if (!isAllowedPhotoType(file.type)) {
      showToast("Format de photo non pris en charge.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      showToast("Photo trop volumineuse.");
      return;
    }
    try {
      const photoId = await uploadItemPhoto(state!.code, file);
      conn.send({ type: "updateItem", id: itemId, photoId });
    } catch {
      showToast("Impossible d'envoyer la photo.");
    }
  }

  // Simple édition de champ (comme renommer/requantifier un article) plutôt
  // qu'une suppression structurelle : pas de pile d'annulation ici, cohérent
  // avec les autres édition de champ unique de cette vue.
  function openPhotoViewer(item: Item): void {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal photo-viewer-modal" role="dialog" aria-modal="true" tabindex="-1">
        <button class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
        <h2>${escapeHtml(item.name)}</h2>
        <img class="photo-viewer-img" src="${escapeHtml(photoUrl(state!.code, item.photoId!))}" alt="" />
        <div class="stacked-actions">
          <button class="btn primary" id="photo-replace">Remplacer la photo</button>
          <button class="btn danger" id="photo-remove">Supprimer la photo</button>
          <button class="btn" id="photo-cancel">Fermer</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const releaseFocusTrap = trapFocus(overlay.querySelector(".modal")!);
    const close = () => {
      overlay.remove();
      releaseFocusTrap();
      document.removeEventListener("keydown", onKeydown);
    };
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKeydown);
    overlay.querySelector(".modal-close")!.addEventListener("click", close);
    overlay.querySelector("#photo-cancel")!.addEventListener("click", close);
    overlay.querySelector("#photo-replace")!.addEventListener("click", () => {
      close();
      triggerPhotoPicker(item.id);
    });
    overlay.querySelector("#photo-remove")!.addEventListener("click", () => {
      conn.send({ type: "updateItem", id: item.id, photoId: null });
      close();
    });
  }

  function openCategoryManager(): void {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    let openPaletteFor: string | null = null;
    let disposeDnd: (() => void) | null = null;
    const render = () => {
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
          <button class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
          <h2>Catégories</h2>
          <ul class="manage-category-list">
            ${[...state!.categories]
              .sort((a, b) => a.order - b.order)
              .map((c) => {
                // Échappé en défense en profondeur (voir itemRowHtml) : le
                // serveur valide désormais le format des id, mais data-id
                // n'échappe rien tout seul.
                const id = escapeHtml(c.id);
                return `
              <li data-id="${id}">
                <div class="cat-row" style="--cat-hue: ${resolveCategoryHue(c)}">
                  <button class="drag-handle category-manage-drag-handle" aria-label="Réordonner « ${escapeHtml(c.name)} »">${icons.gripVertical}</button>
                  <button type="button" class="category-dot color-swatch-toggle" data-id="${id}" aria-label="Changer la couleur de « ${escapeHtml(c.name)} »" aria-expanded="${openPaletteFor === c.id}"></button>
                  <span class="cat-name" data-id="${id}">${escapeHtml(c.name)}</span>
                  <button class="icon-btn" data-action="del" data-id="${id}" aria-label="Supprimer">${icons.trash}</button>
                </div>
                ${openPaletteFor === c.id ? colorPaletteHtml(c) : ""}
              </li>`;
              })
              .join("")}
          </ul>
          <form id="new-category-form" class="row">
            <input id="new-category-name" type="text" placeholder="Nouvelle catégorie" maxlength="40" />
            <button type="submit" class="btn primary">Ajouter</button>
          </form>
          <p class="add-form-hint">${PRIVACY_HINT}</p>
        </div>
      `;
      overlay.querySelector(".modal-close")!.addEventListener("click", close);
      overlay.querySelectorAll<HTMLElement>(".cat-name").forEach((el) => {
        el.addEventListener("click", () => {
          startEdit(el, {
            value: el.textContent || "",
            onCommit: (value) => {
              if (value) conn.send({ type: "renameCategory", id: el.dataset.id!, name: value });
            },
          });
        });
      });
      overlay.querySelectorAll<HTMLElement>(".color-swatch-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id!;
          openPaletteFor = openPaletteFor === id ? null : id;
          render();
        });
      });
      overlay.querySelectorAll<HTMLElement>(".color-swatch").forEach((btn) => {
        btn.addEventListener("click", () => {
          // .color-swatch n'apparaît que dans colorPaletteHtml(c), toujours
          // rendu à l'intérieur du <li data-id> de sa propre catégorie c.
          const id = btn.closest("li")!.dataset.id!;
          const raw = btn.dataset.color!;
          conn.send({ type: "setCategoryColor", id, color: raw === "auto" ? null : Number(raw) });
          openPaletteFor = null;
          render();
        });
      });
      overlay.querySelectorAll<HTMLElement>('[data-action="del"]').forEach((btn) => {
        const id = btn.dataset.id!;
        // Vient de state!.categories à l'instant même du rendu ci-dessus :
        // toujours trouvée.
        const category = state!.categories.find((c) => c.id === id)!;
        wireConfirmClick(btn, {
          armedLabel: `Confirmer la suppression de « ${category.name} »`,
          onConfirm: () => {
            const itemIds = state!.items.filter((i) => i.categoryId === id).map((i) => i.id);
            conn.send({ type: "deleteCategory", id });
            pushUndo(`Catégorie « ${category.name} » supprimée`, () => conn.send({ type: "restoreCategory", category, itemIds }));
          },
        });
      });
      overlay.querySelector("#new-category-form")!.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = overlay.querySelector("#new-category-name") as HTMLInputElement;
        const name = input.value.trim();
        if (!name) return;
        conn.send({ type: "addCategory", id: uid(), name });
        input.value = "";
      });

      disposeDnd?.();
      disposeDnd = enableDragReorder(overlay, {
        containerSelector: ".manage-category-list",
        itemSelector: "li",
        handleSelector: ".category-manage-drag-handle",
        onDrop: () => {
          const orderedIds = Array.from(overlay.querySelectorAll<HTMLElement>(".manage-category-list li"))
            .map((li) => li.dataset.id!)
            .filter((id) => id);
          conn.send({ type: "reorderCategories", orderedIds });
        },
      });
    };
    const close = () => {
      disposeDnd?.();
      overlay.remove();
      unsubscribe();
      releaseFocusTrap();
      document.removeEventListener("keydown", onKeydown);
    };
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKeydown);
    const unsubscribe = conn.onState(() => render());
    document.body.appendChild(overlay);
    render();
    const releaseFocusTrap = trapFocus(overlay);
  }

  function openSuggestionManager(): void {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    let searchQuery = "";

    const sortEntries = (a: HistoryEntry, b: HistoryEntry) => alnumCompare(a.label, b.label);

    const suggestionRowHtml = (h: HistoryEntry): string => `
      <li data-key="${escapeHtml(h.key)}">
        <div class="suggestion-row">
          <button type="button" class="icon-btn suggestion-favorite" data-action="fav" data-key="${escapeHtml(h.key)}" aria-label="${h.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-pressed="${h.favorite ? "true" : "false"}">
            ${h.favorite ? icons.starFilled : icons.star}
          </button>
          <span class="suggestion-name" data-key="${escapeHtml(h.key)}">${escapeHtml(h.label)}</span>
          <select class="suggestion-category" data-key="${escapeHtml(h.key)}" aria-label="Catégorie de « ${escapeHtml(h.label)} »">
            ${categoryOptionsHtml(state!.categories, h.categoryId)}
          </select>
          <button class="icon-btn" data-action="del" data-key="${escapeHtml(h.key)}" aria-label="Supprimer la suggestion « ${escapeHtml(h.label)} »">${icons.trash}</button>
        </div>
      </li>`;

    const wireRows = (container: Element): void => {
      container.querySelectorAll<HTMLElement>(".suggestion-name").forEach((el) => {
        el.addEventListener("click", () => {
          startEdit(el, {
            value: el.textContent || "",
            onCommit: (value) => {
              if (!value) {
                renderList();
                return;
              }
              const oldKey = el.dataset.key!;
              conn.send({ type: "updateHistoryEntry", key: oldKey, label: value });
              // Retag this row's data-key immediately, without waiting for the
              // round trip: a rename changes the entry's dedupe key (see
              // historyKey/updateHistoryEntry in worker/reducer.ts), so an
              // action fired right after (e.g. picking a category below)
              // would otherwise still target the old, since-vanished key and
              // be silently dropped by the server.
              const newKey = historyKey(value);
              if (newKey !== oldKey) {
                // .suggestion-name est toujours à l'intérieur du <li
                // data-key> de sa propre ligne.
                el.closest("li")!
                  .querySelectorAll<HTMLElement>("[data-key]")
                  .forEach((node) => {
                    node.dataset.key = newKey;
                  });
              }
            },
          });
        });
      });
      container.querySelectorAll<HTMLSelectElement>(".suggestion-category").forEach((sel) => {
        sel.addEventListener("change", () => {
          conn.send({ type: "updateHistoryEntry", key: sel.dataset.key!, categoryId: sel.value || null });
        });
      });
      container.querySelectorAll<HTMLElement>('[data-action="fav"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          conn.send({ type: "toggleFavoriteHistoryEntry", key: btn.dataset.key! });
        });
      });
      container.querySelectorAll<HTMLElement>('[data-action="del"]').forEach((btn) => {
        const key = btn.dataset.key!;
        // Vient de state!.history à l'instant même du rendu ci-dessus :
        // toujours trouvée.
        const entry = state!.history.find((h) => h.key === key)!;
        wireConfirmClick(btn, {
          armedLabel: `Confirmer la suppression de la suggestion « ${entry.label} »`,
          onConfirm: () => {
            conn.send({ type: "deleteHistoryEntry", key });
            pushUndo(`Suggestion « ${entry.label} » supprimée`, () => conn.send({ type: "restoreHistoryEntry", entry }));
          },
        });
      });
    };

    // Ne touche qu'au conteneur de la liste, jamais au champ de recherche
    // lui-même : sinon il perdrait le focus à chaque frappe (ce handler
    // tourne aussi bien sur "input" que sur les mises à jour reçues du
    // serveur pendant que l'utilisateur tape).
    const renderList = (): void => {
      // #suggestion-list est dans le gabarit statique de renderShell(),
      // toujours rendu avant que renderList() ne soit jamais appelée.
      const container = overlay.querySelector("#suggestion-list")!;
      if (state!.history.length === 0) {
        container.innerHTML = `<p class="hint">Aucune suggestion pour l'instant : elles apparaissent une fois qu'un article a été coché.</p>`;
        return;
      }
      const q = searchQuery.trim().toLowerCase();
      const matches = (h: HistoryEntry) => !q || h.label.toLowerCase().includes(q);
      const favorites = state!.history.filter((h) => h.favorite && matches(h)).sort(sortEntries);
      const others = state!.history.filter((h) => !h.favorite && matches(h)).sort(sortEntries);
      if (favorites.length === 0 && others.length === 0) {
        container.innerHTML = `<p class="hint">Aucune suggestion ne correspond à « ${escapeHtml(searchQuery.trim())} ».</p>`;
        return;
      }
      container.innerHTML = `
        ${favorites.length ? `<h3 class="recent-subheading">Favoris</h3><ul class="manage-category-list manage-suggestion-list">${favorites.map(suggestionRowHtml).join("")}</ul>` : ""}
        ${
          others.length
            ? `${favorites.length ? '<h3 class="recent-subheading">Autres</h3>' : ""}<ul class="manage-category-list manage-suggestion-list">${others.map(suggestionRowHtml).join("")}</ul>`
            : ""
        }
      `;
      wireRows(container);
    };

    const renderShell = (): void => {
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
          <button class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
          <h2>Suggestions</h2>
          ${
            state!.history.length > 0
              ? `<input type="text" id="suggestion-search" class="suggestion-search" placeholder="Rechercher…" aria-label="Rechercher une suggestion" />`
              : ""
          }
          <div id="suggestion-list"></div>
          <p class="add-form-hint">${PRIVACY_HINT}</p>
        </div>
      `;
      overlay.querySelector(".modal-close")!.addEventListener("click", close);
      const searchInput = overlay.querySelector<HTMLInputElement>("#suggestion-search");
      searchInput?.addEventListener("input", () => {
        searchQuery = searchInput.value;
        renderList();
      });
      renderList();
    };

    const close = () => {
      overlay.remove();
      unsubscribe();
      releaseFocusTrap();
      document.removeEventListener("keydown", onKeydown);
    };
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKeydown);
    const unsubscribe = conn.onState(() => renderList());
    document.body.appendChild(overlay);
    renderShell();
    const releaseFocusTrap = trapFocus(overlay);
  }

  function wireAddForm(): void {
    // Toutes les cibles ci-dessous font partie du gabarit statique de
    // layoutHtml(), garanti déjà en place (voir render()).
    const form = root.querySelector("#add-form") as HTMLFormElement;
    const input = root.querySelector("#add-input") as HTMLInputElement;
    const preview = root.querySelector("#add-preview-qty") as HTMLElement;
    const suggestionsEl = root.querySelector("#suggestions") as HTMLElement;
    const categorySelect = root.querySelector("#add-category") as HTMLSelectElement;

    input.addEventListener("input", () => {
      const { quantity } = parseFreeText(input.value);
      preview.hidden = !quantity;
      preview.textContent = quantity;
      renderTypeahead(input.value);
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        suggestionsEl.hidden = true;
      }, 150);
    });
    input.addEventListener("focus", () => renderTypeahead(input.value));

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const rawText = input.value.trim();
      if (!rawText) return;
      const categoryId = categorySelect.value || null;
      const id = uid();
      pendingLocalItemIds.add(id);
      conn.send({ type: "addItem", id, rawText, categoryId });
      input.value = "";
      preview.hidden = true;
      suggestionsEl.hidden = true;
      input.focus();
    });

    function renderTypeahead(query: string): void {
      const q = query.trim().toLowerCase();
      if (!q) {
        suggestionsEl.hidden = true;
        return;
      }
      const matches = suggestionPool().filter((h) => h.key.includes(q)).slice(0, 6);
      if (matches.length === 0) {
        suggestionsEl.hidden = true;
        return;
      }
      suggestionsEl.hidden = false;
      suggestionsEl.innerHTML = matches
        .map((h) => `<li><button type="button" data-key="${escapeHtml(h.key)}">${escapeHtml(h.label)}</button></li>`)
        .join("");
      suggestionsEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const entry = state!.history.find((h) => h.key === btn.dataset.key);
          if (entry) addFromHistory(entry);
          suggestionsEl.hidden = true;
        });
      });
    }
  }

  function renderQuickAdd(): void {
    // #quick-add fait partie du gabarit statique, state garanti non-nul
    // (voir render()).
    const el = root.querySelector("#quick-add")!;
    if (getHideCheckedPreference()) {
      el.innerHTML = "";
      return;
    }
    const items = suggestionPool().slice(0, 12);
    if (items.length === 0) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `
      <div class="quick-add-label">Suggestions</div>
      <div class="chip-row">
        ${items
          .map((h) => `<button type="button" class="chip" data-key="${escapeHtml(h.key)}">+ ${escapeHtml(h.label)}</button>`)
          .join("")}
      </div>
    `;
    el.querySelectorAll<HTMLButtonElement>(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = state!.history.find((h) => h.key === btn.dataset.key);
        if (entry) addFromHistory(entry);
      });
    });
  }

  function suggestionPool(): HistoryEntry[] {
    const activeNames = new Set(state!.items.filter((i) => !i.checked).map((i) => i.name.trim().toLowerCase()));
    return [...state!.history].filter((h) => !activeNames.has(h.key)).sort((a, b) => alnumCompare(a.label, b.label));
  }

  function addFromHistory(entry: HistoryEntry): void {
    const id = uid();
    pendingLocalItemIds.add(id);
    conn.send({ type: "addItem", id, rawText: entry.label, categoryId: entry.categoryId });
  }

  function renderCategories(): void {
    // #categories fait partie du gabarit statique, state garanti non-nul
    // (voir render()).
    const container = root.querySelector("#categories") as HTMLElement;

    const query = searchQuery.trim().toLowerCase();
    const alphabeticalItems = getItemSortPreference() === "alphabetical";
    const hideChecked = getHideCheckedPreference();
    const byCategory = (categoryId: string | null): Item[] =>
      state!.items.filter(
        (i) => i.categoryId === categoryId && (!query || i.name.toLowerCase().includes(query)) && (!hideChecked || !i.checked),
      );
    const sortItems = (items: Item[]): Item[] =>
      [...items].sort(
        (a, b) => Number(a.checked) - Number(b.checked) || (alphabeticalItems ? alnumCompare(a.name, b.name) : a.order - b.order),
      );

    const cats = [...state!.categories].sort((a, b) => a.order - b.order);
    type Group = { id: string | null; name: string; items: Item[]; showHeader: boolean; hue: number };
    let groups: Group[] = cats.map((c) => ({
      id: c.id,
      name: c.name,
      items: sortItems(byCategory(c.id)),
      showHeader: true,
      hue: resolveCategoryHue(c),
    }));
    const uncategorized = sortItems(byCategory(null));
    if (cats.length === 0) {
      groups.unshift({ id: null, name: "Articles", items: uncategorized, showHeader: false, hue: 0 });
    } else if (uncategorized.length > 0) {
      groups.push({ id: null, name: "Sans catégorie", items: uncategorized, showHeader: true, hue: 0 });
    }

    // Une catégorie sans article (dans cette liste, ou ne correspondant pas
    // à la recherche en cours) n'a rien à montrer — elle reste gérable via
    // "Gérer les catégories", mais son en-tête n'encombre pas la liste tant
    // qu'elle est vide.
    groups = groups.filter((g) => g.items.length > 0);

    // Une catégorie entièrement cochée passe après celles encore en cours,
    // même logique que pour les articles au sein d'une catégorie (voir
    // sortItems ci-dessus). Tri stable : ne touche pas à l'ordre relatif au
    // sein de chaque groupe (complet / non complet).
    groups.sort((a, b) => Number(a.items.every((i) => i.checked)) - Number(b.items.every((i) => i.checked)));

    if (groups.length === 0 && query) {
      container.innerHTML = `<div class="empty-state">Aucun article ne correspond à « ${escapeHtml(searchQuery.trim())} ».</div>`;
      disposeItemDnd?.();
      disposeCategoryDnd?.();
      disposeSwipe?.();
      return;
    }

    if (groups.length === 0 && hideChecked && state!.items.length > 0) {
      container.innerHTML = `<div class="empty-state">Tous les articles sont cochés (et masqués).</div>`;
      disposeItemDnd?.();
      disposeCategoryDnd?.();
      disposeSwipe?.();
      return;
    }

    if (groups.every((g) => g.items.length === 0)) {
      container.innerHTML = `<div class="empty-state">Ta liste est vide. Ajoute un premier article ci-dessus 👆</div>`;
      disposeItemDnd?.();
      disposeCategoryDnd?.();
      disposeSwipe?.();
      return;
    }

    container.innerHTML = groups
      .map((g) => {
        // Échappé en défense en profondeur (voir itemRowHtml) : le serveur
        // valide désormais le format des id, mais data-category-id/data-id
        // n'échappent rien tout seuls.
        const id = escapeHtml(g.id ?? "");
        return `
      <section class="category-section${g.id ? " has-color" : ""}" data-category-id="${id}" ${g.id ? `style="--cat-hue: ${g.hue}"` : ""}>
        ${
          g.showHeader
            ? `<header class="category-header">
                ${g.id ? `<button class="drag-handle category-drag-handle" aria-label="Réordonner la catégorie">${icons.gripVertical}</button>` : `<span class="drag-handle-spacer"></span>`}
                ${g.id ? `<span class="category-dot" aria-hidden="true"></span>` : ""}
                <span class="category-name" data-id="${id}">${escapeHtml(g.name)}</span>
                <span class="category-count">${g.items.filter((i) => !i.checked).length}</span>
              </header>`
            : ""
        }
        <ul class="item-list" data-category-id="${id}">
          ${g.items.map(itemRowHtml).join("")}
        </ul>
      </section>`;
      })
      .join("");

    container.querySelectorAll<HTMLInputElement>(".item-check").forEach((cb) => {
      cb.addEventListener("change", () => {
        conn.send({ type: "toggleItem", id: cb.dataset.id!, checked: cb.checked });
        if (cb.checked) navigator.vibrate?.(10);
      });
    });

    container.querySelectorAll<HTMLElement>(".item-priority").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = state!.items.find((i) => i.id === btn.dataset.id);
        if (!item) return;
        const next = cyclePriority(priorityOf(item));
        // Mise à jour optimiste : sans elle, le badge n'apparaît qu'après
        // l'aller-retour serveur (contrairement à la case à cocher, qui a
        // un retour visuel natif immédiat). L'état reçu en confirmation
        // écrasera de toute façon cette valeur locale (voir onStateUpdate).
        item.priority = next;
        renderCategories();
        conn.send({ type: "updateItem", id: item.id, priority: next });
      });
    });

    container.querySelectorAll<HTMLElement>('[data-action="delete-item"]').forEach((btn) => {
      // Vient de state!.items à l'instant même du rendu ci-dessus : toujours
      // trouvé.
      const item = state!.items.find((i) => i.id === btn.dataset.id)!;
      wireConfirmClick(btn, {
        armedLabel: `Confirmer la suppression de « ${item.name} »`,
        onConfirm: () => {
          conn.send({ type: "deleteItem", id: item.id });
          pushUndo(`« ${item.name} » supprimé`, () => {
            pendingLocalItemIds.add(item.id);
            conn.send({ type: "restoreItems", items: [item] });
          });
        },
      });
    });

    container.querySelectorAll<HTMLButtonElement>(".item-photo").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = state!.items.find((i) => i.id === btn.dataset.id);
        if (!item) return;
        if (item.photoId) openPhotoViewer(item);
        else triggerPhotoPicker(item.id);
      });
    });

    container.querySelectorAll<HTMLSelectElement>(".item-category").forEach((sel) => {
      sel.addEventListener("change", () => {
        conn.send({ type: "updateItem", id: sel.dataset.id!, categoryId: sel.value || null });
      });
    });

    container.querySelectorAll<HTMLElement>(".item-name").forEach((el) => {
      el.addEventListener("click", () => {
        const item = state!.items.find((i) => i.id === el.dataset.id);
        if (!item) return;
        startEdit(el, {
          value: item.name,
          onCommit: (value) => {
            if (value) conn.send({ type: "updateItem", id: item.id, name: value });
            else render();
          },
        });
      });
    });

    container.querySelectorAll<HTMLElement>(".qty-badge").forEach((el) => {
      el.addEventListener("click", () => {
        const item = state!.items.find((i) => i.id === el.dataset.id);
        if (!item) return;
        startEdit(el, {
          value: item.quantity,
          placeholder: "ex: 2, 500 g",
          onCommit: (value) => conn.send({ type: "updateItem", id: item.id, quantity: value }),
        });
      });
    });

    container.querySelectorAll<HTMLElement>(".category-name").forEach((el) => {
      if (!el.dataset.id) return;
      el.addEventListener("click", () => {
        startEdit(el, {
          value: el.textContent || "",
          onCommit: (value) => {
            if (value) conn.send({ type: "renameCategory", id: el.dataset.id!, name: value });
          },
        });
      });
    });

    disposeItemDnd?.();
    disposeCategoryDnd?.();
    disposeSwipe?.();

    // Le glisser-déposer reste actif même en tri alphabétique : il permet
    // toujours de déplacer un article vers une autre catégorie. Seul le
    // repositionnement au sein d'une même catégorie n'a plus d'effet visuel
    // durable (le prochain rendu retrie par ordre alphabétique).
    disposeItemDnd = enableDragReorder(container, {
      containerSelector: ".item-list",
      itemSelector: ".item",
      handleSelector: ".item-drag-handle",
      onDrop: (el) => {
        const itemId = el.dataset.id!;
        const newCategoryRaw = el.closest(".item-list")?.getAttribute("data-category-id") ?? "";
        const newCategoryId = newCategoryRaw || null;
        const item = state!.items.find((i) => i.id === itemId);
        if (item && item.categoryId !== newCategoryId) {
          conn.send({ type: "updateItem", id: itemId, categoryId: newCategoryId });
        }
        const orderedIds = Array.from(container.querySelectorAll<HTMLElement>(".item")).map((li) => li.dataset.id!);
        conn.send({ type: "reorderItems", orderedIds });
      },
    });

    disposeCategoryDnd = enableDragReorder(container, {
      containerSelector: "#categories",
      itemSelector: ".category-section",
      handleSelector: ".category-drag-handle",
      onDrop: () => {
        const orderedIds = Array.from(container.querySelectorAll<HTMLElement>(".category-section"))
          .map((el) => el.dataset.categoryId!)
          .filter((id) => id);
        conn.send({ type: "reorderCategories", orderedIds });
      },
    });

    disposeSwipe = enableSwipeToDelete(container, {
      itemSelector: ".item",
      contentSelector: ".item-content",
      ignoreSelector: ".item-drag-handle, .item-check, .item-priority, .item-delete",
      onDelete: (el) => {
        const item = state!.items.find((i) => i.id === el.dataset.id);
        if (!item) return;
        conn.send({ type: "deleteItem", id: item.id });
        pushUndo(`« ${item.name} » supprimé`, () => {
          pendingLocalItemIds.add(item.id);
          conn.send({ type: "restoreItems", items: [item] });
        });
      },
    });
  }

  function itemRowHtml(item: Item): string {
    // La poignée reste utile même en tri alphabétique : elle permet de
    // déplacer un article vers une autre catégorie déjà affichée dans la
    // liste par glisser-déposer. Le sélecteur .item-category ci-dessous
    // couvre le cas d'une catégorie vide (pas de section affichée, donc pas
    // de cible de dépôt) : les deux moyens coexistent. Seul le
    // repositionnement au sein d'une même catégorie devient sans effet
    // visuel en tri alphabétique (l'ordre est alors recalculé à chaque
    // rendu).
    const priority = priorityOf(item);
    // Échappé même si le serveur valide désormais le format des id (voir
    // worker/reducer.ts) : défense en profondeur pour une liste déjà
    // persistée avant ce contrôle, ou tout autre bug futur qui le
    // contournerait — data-id n'est pas un contexte qui échappe tout seul.
    const id = escapeHtml(item.id);
    return `
      <li class="item ${item.checked ? "checked" : ""}" data-id="${id}" data-priority="${priority}">
        <div class="item-swipe-bg" aria-hidden="true">${icons.trash}</div>
        <div class="item-content">
          <button class="drag-handle item-drag-handle" aria-label="Déplacer">${icons.gripVertical}</button>
          <input type="checkbox" class="item-check" data-id="${id}" ${item.checked ? "checked" : ""} />
          <button class="item-priority" data-action="cycle-priority" data-id="${id}" data-priority="${priority}" aria-label="Priorité : ${PRIORITY_LABELS[priority]} (cliquer pour changer)"></button>
          <span class="qty-badge ${item.quantity ? "" : "qty-empty"}" data-id="${id}">${escapeHtml(item.quantity) || "+"}</span>
          <span class="item-name" data-id="${id}">${escapeHtml(item.name)}</span>
          ${
            item.photoId
              ? `<button type="button" class="item-photo has-photo" data-id="${id}" aria-label="Voir la photo de « ${escapeHtml(item.name)} »"><img src="${escapeHtml(photoUrl(state!.code, item.photoId))}" alt="" loading="lazy" /></button>`
              : `<button type="button" class="item-photo" data-id="${id}" aria-label="Ajouter une photo à « ${escapeHtml(item.name)} »">${icons.camera}</button>`
          }
          <span class="item-category-picker">
            <span class="icon-btn item-category-icon" aria-hidden="true">${icons.tag}</span>
            <select class="item-category" data-id="${id}" aria-label="Changer la catégorie de « ${escapeHtml(item.name)} »">
              ${categoryOptionsHtml(state!.categories, item.categoryId)}
            </select>
          </span>
          <button class="icon-btn item-delete" data-action="delete-item" data-id="${id}" aria-label="Supprimer">${icons.trash}</button>
        </div>
      </li>
    `;
  }

  function categoryOptionsHtml(categories: Category[], selectedId: string | null = null): string {
    // Alphabétique plutôt que l'ordre manuel des catégories (voir
    // renderCategories) : plus facile à parcourir dans une liste déroulante
    // qu'à retenir un ordre personnalisé.
    const sorted = [...categories].sort((a, b) => alnumCompare(a.name, b.name));
    const optionHtml = (c: Category) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.name)}</option>`;
    return [`<option value="" ${selectedId === null ? "selected" : ""}>Sans catégorie</option>`, sorted.map(optionHtml).join("")].join("");
  }

  function layoutHtml(s: ListState): string {
    // Le point de connexion démarre toujours hors-ligne : ce gabarit n'est
    // construit qu'une fois (voir render(), shellMounted), et systématiquement
    // avant conn.connect() — updateConnDot() prend ensuite le relais pour
    // refléter les changements d'état de la connexion en direct.
    return `
      <div class="list-view">
        <header class="list-header">
          <button class="icon-btn" id="btn-home" aria-label="Accueil">${icons.back}</button>
          <h1 class="list-title" id="list-title">${escapeHtml(s.name)}</h1>
          <span class="item-counter" id="item-counter" aria-live="polite"></span>
          <span class="conn-dot" id="conn-dot" title="Connexion…"></span>
          <button class="icon-btn presence-btn" id="btn-presence" aria-label="Personnes connectées">
            ${icons.users}<span class="presence-count" id="presence-count">1</span>
          </button>
          <div class="menu-panel presence-panel" id="presence-panel" hidden></div>
          <button class="icon-btn" id="btn-search" aria-label="Rechercher">${icons.search}</button>
          ${hideCheckedButtonHtml(getHideCheckedPreference())}
          <button class="icon-btn" id="btn-menu" aria-label="Menu">${icons.more}</button>
          <div class="menu-panel" id="menu-panel" hidden>
            <button type="button" data-action="share"><span class="menu-item-icon">${icons.share}</span>Partager</button>
            <button type="button" data-action="theme">${themeMenuHtml(getThemePreference())}</button>
            <button type="button" data-action="accessibility">${accessibilityMenuHtml(getAccessibilityPreference())}</button>
            <button type="button" data-action="item-sort">${itemSortMenuHtml(getItemSortPreference())}</button>
            <button type="button" data-action="notifications">${notificationsMenuHtml(getNotificationStatus())}</button>
            <button type="button" data-action="manage-categories"><span class="menu-item-icon">${icons.tag}</span>Gérer les catégories</button>
            <button type="button" data-action="manage-suggestions"><span class="menu-item-icon">${icons.history}</span>Gérer les suggestions</button>
            <button type="button" data-action="clear-checked"><span class="menu-item-icon">${icons.checkCircle}</span><span class="menu-item-label">Vider les articles cochés</span></button>
          </div>
        </header>

        <div class="search-bar" id="search-bar" hidden>
          <input id="search-input" type="text" aria-label="Rechercher un article" placeholder="Rechercher un article…" />
          <button class="icon-btn" id="search-close" aria-label="Fermer la recherche">${icons.close}</button>
        </div>

        <form id="add-form" class="add-form">
          <div class="add-row">
            <div class="add-input-wrap">
              <input id="add-input" type="text" placeholder="Ajouter un article… (ex: 2 kg pommes)" autocomplete="off" />
              <span id="add-preview-qty" class="qty-badge qty-preview" hidden></span>
            </div>
            <select id="add-category" aria-label="Catégorie">
              ${categoryOptionsHtml(s.categories)}
            </select>
            <button type="submit" class="btn primary add-submit" aria-label="Ajouter">${icons.plus}</button>
          </div>
          <ul id="suggestions" class="suggestions" hidden></ul>
        </form>
        <p class="add-form-hint">${PRIVACY_HINT}</p>

        <div id="quick-add" class="quick-add"></div>

        <div id="categories" class="categories"></div>

        <p class="list-privacy-note">${PRIVACY_HINT}</p>
      </div>
    `;
  }

  function themeMenuHtml(pref: ThemePreference): string {
    return `<span class="menu-item-icon">${THEME_ICON[pref]}</span> Thème : ${themeLabel(pref)}`;
  }

  function updateThemeMenuItem(button: HTMLElement): void {
    button.innerHTML = themeMenuHtml(getThemePreference());
  }

  function accessibilityMenuHtml(pref: ReturnType<typeof getAccessibilityPreference>): string {
    return `<span class="menu-item-icon">${icons.accessibility}</span>Accessibilité : ${accessibilityLabel(pref)}`;
  }

  function updateAccessibilityMenuItem(button: HTMLElement): void {
    button.innerHTML = accessibilityMenuHtml(getAccessibilityPreference());
  }

  function itemSortMenuHtml(pref: ReturnType<typeof getItemSortPreference>): string {
    return `<span class="menu-item-icon">${icons.sort}</span>Tri des articles : ${itemSortLabel(pref)}`;
  }

  function updateItemSortMenuItem(button: HTMLElement): void {
    button.innerHTML = itemSortMenuHtml(getItemSortPreference());
  }

  function notificationsMenuHtml(status: ReturnType<typeof getNotificationStatus>): string {
    return `<span class="menu-item-icon">${icons.bell}</span>Notifications : ${notificationStatusLabel(status)}`;
  }

  function updateNotificationsMenuItem(button: HTMLElement): void {
    button.innerHTML = notificationsMenuHtml(getNotificationStatus());
  }

  function hideCheckedButtonHtml(hide: boolean): string {
    return `<button class="icon-btn" id="btn-hide-checked" aria-label="${hide ? "Afficher les articles cochés" : "Masquer les articles cochés"}" aria-pressed="${hide}">${hide ? icons.eyeOff : icons.eye}</button>`;
  }

  function updateHideCheckedButton(button: HTMLElement): void {
    const hide = getHideCheckedPreference();
    button.setAttribute("aria-label", hide ? "Afficher les articles cochés" : "Masquer les articles cochés");
    button.setAttribute("aria-pressed", String(hide));
    button.innerHTML = hide ? icons.eyeOff : icons.eye;
  }

  function notFoundHtml(c: string): string {
    return `
      <div class="centered-message">
        <p>Aucune liste ne correspond au code <strong>${escapeHtml(c)}</strong>.</p>
        <button class="btn primary" id="btn-home">Retour à l'accueil</button>
      </div>
    `;
  }

  function showToast(message: string): void {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("visible"));
    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  return () => {
    conn.disconnect();
    disposeItemDnd?.();
    disposeCategoryDnd?.();
    disposeSwipe?.();
    clearUndoStack();
    document.querySelectorAll(".modal-overlay").forEach((el) => el.remove());
  };
}
