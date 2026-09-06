import type { Category, HistoryEntry, Item, ListState } from "../../shared/types";
import { parseFreeText } from "../../shared/quantity";
import { ListConnection } from "../lib/ws";
import { fetchListState } from "../lib/http";
import { cacheListState, getCachedListState, touchRecentList } from "../lib/storage";
import { uid } from "../lib/id";
import { escapeHtml } from "../lib/dom";
import { startEdit } from "../lib/editable";
import { wireConfirmClick } from "../lib/confirmClick";
import { enableDragReorder } from "../lib/dnd";
import { openShareModal } from "../components/shareModal";
import { exportListState, parseImportFile } from "../lib/importExport";
import { icons } from "../lib/icons";
import { trapFocus } from "../lib/focusTrap";
import { resolveCategoryHue } from "../lib/color";
import { alnumCompare } from "../lib/sort";
import { cycleThemePreference, getThemePreference, themeLabel, type ThemePreference } from "../lib/theme";

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

function colorPaletteHtml(category: Category): string {
  const autoSelected = category.color === undefined;
  const autoSwatch = `<button type="button" class="color-swatch color-swatch-auto${autoSelected ? " selected" : ""}" data-color="auto" aria-label="Couleur automatique" aria-pressed="${autoSelected}">Auto</button>`;
  const hueSwatches = CATEGORY_COLOR_HUES.map(({ hue, name }) => {
    const selected = category.color === hue;
    return `<button type="button" class="color-swatch${selected ? " selected" : ""}" data-color="${hue}" style="--swatch-hue: ${hue}" aria-label="${name}" aria-pressed="${selected}"></button>`;
  }).join("");
  return `<div class="color-palette">${autoSwatch}${hueSwatches}</div>`;
}

export function mountListView(root: HTMLElement, code: string, navigate: (path: string) => void): () => void {
  let state: ListState | null = getCachedListState(code);
  let connected = false;
  let loading = state === null;
  let notFound = false;
  let loadError = false;
  let disposeItemDnd: (() => void) | null = null;
  let disposeCategoryDnd: (() => void) | null = null;
  let shellMounted = false;
  let searchQuery = "";
  // null = pas encore évalué (évite de célébrer à l'ouverture d'une liste
  // déjà entièrement cochée) ; sinon, reflète l'état à la dernière vérification.
  let wasFullyChecked: boolean | null = null;
  const conn = new ListConnection(code);

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
      const removed = undoEntries.shift();
      if (removed) clearTimeout(removed.timer);
    }
    renderUndoToast();
  }

  function undoLast(): void {
    const entry = undoEntries.pop();
    if (!entry) return;
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
    state = next;
    loading = false;
    notFound = false;
    cacheListState(next);
    touchRecentList(next.code, next.name);
    render();
  }

  conn.onState(onStateUpdate);
  conn.onConnectionChange((isConnected) => {
    connected = isConnected;
    updateConnDot();
  });
  conn.onError((message) => showToast(message));

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
    if (!state) return;

    if (!shellMounted) {
      // Built only once: re-creating this on every realtime update would
      // wipe out whatever the user is currently typing in the add-item
      // input whenever a broadcast arrives (e.g. someone else adds an item
      // while you're composing yours).
      root.innerHTML = layoutHtml(state, connected);
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
    checkCelebration();
  }

  function checkCelebration(): void {
    if (!state) return;
    const isFullyChecked = state.items.length > 0 && state.items.every((i) => i.checked);
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
    const titleEl = root.querySelector("#list-title") as HTMLElement | null;
    if (!titleEl || !state) return;
    if (titleEl.querySelector("input")) return; // user is mid-edit, don't clobber
    if (titleEl.textContent !== state.name) titleEl.textContent = state.name;
  }

  function updateCategorySelect(): void {
    const select = root.querySelector("#add-category") as HTMLSelectElement | null;
    if (!select || !state) return;
    const previous = select.value;
    select.innerHTML = categoryOptionsHtml(state.categories);
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  function updateConnDot(): void {
    const dot = root.querySelector("#conn-dot");
    if (!dot) return;
    dot.classList.toggle("online", connected);
    dot.setAttribute("title", connected ? "Synchronisé" : "Connexion…");
  }

  function wireHeader(): void {
    root.querySelector("#btn-home")?.addEventListener("click", () => navigate("/"));
    root.querySelector("#btn-share")?.addEventListener("click", () => {
      if (state) openShareModal(state.code, state.name);
    });

    const searchBar = root.querySelector("#search-bar") as HTMLElement | null;
    const searchInput = root.querySelector("#search-input") as HTMLInputElement | null;
    const closeSearch = () => {
      if (searchBar) searchBar.hidden = true;
      searchQuery = "";
      if (searchInput) searchInput.value = "";
      renderCategories();
    };
    root.querySelector("#btn-search")?.addEventListener("click", () => {
      if (!searchBar) return;
      searchBar.hidden = !searchBar.hidden;
      if (!searchBar.hidden) searchInput?.focus();
      else closeSearch();
    });
    root.querySelector("#search-close")?.addEventListener("click", closeSearch);
    searchInput?.addEventListener("input", () => {
      searchQuery = searchInput.value;
      renderCategories();
    });
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSearch();
    });
    const titleEl = root.querySelector("#list-title") as HTMLElement | null;
    titleEl?.addEventListener("click", () => {
      if (!state) return;
      startEdit(titleEl, {
        value: state.name,
        onCommit: (value) => {
          if (value && state) conn.send({ type: "renameList", name: value });
          else render();
        },
      });
    });
  }

  function wireMenu(): void {
    const menuBtn = root.querySelector("#btn-menu");
    const panel = root.querySelector("#menu-panel") as HTMLElement | null;
    menuBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (panel) panel.hidden = !panel.hidden;
    });
    document.addEventListener("click", () => {
      if (panel) panel.hidden = true;
    });

    panel?.querySelector('[data-action="theme"]')?.addEventListener("click", (e) => {
      cycleThemePreference();
      updateThemeMenuItem(e.currentTarget as HTMLElement);
    });
    panel?.querySelector('[data-action="manage-categories"]')?.addEventListener("click", openCategoryManager);
    panel?.querySelector('[data-action="manage-suggestions"]')?.addEventListener("click", openSuggestionManager);
    panel?.querySelector('[data-action="export"]')?.addEventListener("click", () => {
      if (state) exportListState(state);
    });
    const clearCheckedBtn = panel?.querySelector<HTMLButtonElement>('[data-action="clear-checked"]');
    if (clearCheckedBtn) {
      wireConfirmClick(clearCheckedBtn, {
        armedText: "Confirmer : tout vider ?",
        isDisabled: () => (state?.items.filter((i) => i.checked).length ?? 0) === 0,
        onConfirm: () => {
          const checkedItems = state?.items.filter((i) => i.checked) ?? [];
          if (checkedItems.length === 0) return;
          conn.send({ type: "clearChecked" });
          pushUndo(`${checkedItems.length} article(s) coché(s) vidé(s)`, () => conn.send({ type: "restoreItems", items: checkedItems }));
          if (panel) panel.hidden = true;
        },
      });
    }

    const fileInput = root.querySelector("#import-file") as HTMLInputElement | null;
    panel?.querySelector('[data-action="import"]')?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      try {
        const data = await parseImportFile(file);
        openImportModal(data);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Import impossible.");
      }
    });
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

  function openCategoryManager(): void {
    if (!state) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    let openPaletteFor: string | null = null;
    const render = () => {
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
          <button class="icon-btn modal-close" aria-label="Fermer">${icons.close}</button>
          <h2>Catégories</h2>
          <ul class="manage-category-list">
            ${[...state!.categories]
              .sort((a, b) => a.order - b.order)
              .map(
                (c) => `
              <li data-id="${c.id}">
                <div class="cat-row" style="--cat-hue: ${resolveCategoryHue(c)}">
                  <button type="button" class="category-dot color-swatch-toggle" data-id="${c.id}" aria-label="Changer la couleur de « ${escapeHtml(c.name)} »" aria-expanded="${openPaletteFor === c.id}"></button>
                  <span class="cat-name" data-id="${c.id}">${escapeHtml(c.name)}</span>
                  <button class="icon-btn" data-action="del" data-id="${c.id}" aria-label="Supprimer">${icons.trash}</button>
                </div>
                ${openPaletteFor === c.id ? colorPaletteHtml(c) : ""}
              </li>`,
              )
              .join("")}
          </ul>
          <form id="new-category-form" class="row">
            <input id="new-category-name" type="text" placeholder="Nouvelle catégorie" maxlength="40" />
            <button type="submit" class="btn primary">Ajouter</button>
          </form>
        </div>
      `;
      overlay.querySelector(".modal-close")?.addEventListener("click", close);
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
          const id = btn.closest("li")?.dataset.id;
          if (!id) return;
          const raw = btn.dataset.color!;
          conn.send({ type: "setCategoryColor", id, color: raw === "auto" ? null : Number(raw) });
          openPaletteFor = null;
          render();
        });
      });
      overlay.querySelectorAll<HTMLElement>('[data-action="del"]').forEach((btn) => {
        const id = btn.dataset.id!;
        const category = state!.categories.find((c) => c.id === id);
        if (!category) return;
        wireConfirmClick(btn, {
          armedLabel: `Confirmer la suppression de « ${category.name} »`,
          onConfirm: () => {
            const itemIds = state!.items.filter((i) => i.categoryId === id).map((i) => i.id);
            conn.send({ type: "deleteCategory", id });
            pushUndo(`Catégorie « ${category.name} » supprimée`, () => conn.send({ type: "restoreCategory", category, itemIds }));
          },
        });
      });
      overlay.querySelector("#new-category-form")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = overlay.querySelector("#new-category-name") as HTMLInputElement;
        const name = input.value.trim();
        if (!name) return;
        conn.send({ type: "addCategory", id: uid(), name });
        input.value = "";
      });
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
    const unsubscribe = conn.onState(() => render());
    document.body.appendChild(overlay);
    render();
    const releaseFocusTrap = trapFocus(overlay);
  }

  function openSuggestionManager(): void {
    if (!state) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    let searchQuery = "";

    const sortEntries = (a: HistoryEntry, b: HistoryEntry) => alnumCompare(a.label, b.label);

    const suggestionRowHtml = (h: HistoryEntry): string => `
      <li data-key="${escapeHtml(h.key)}">
        <button type="button" class="icon-btn suggestion-favorite" data-action="fav" data-key="${escapeHtml(h.key)}" aria-label="${h.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-pressed="${h.favorite ? "true" : "false"}">
          ${h.favorite ? icons.starFilled : icons.star}
        </button>
        <span class="suggestion-name" data-key="${escapeHtml(h.key)}">${escapeHtml(h.label)}</span>
        <select class="suggestion-category" data-key="${escapeHtml(h.key)}" aria-label="Catégorie de « ${escapeHtml(h.label)} »">
          ${categoryOptionsHtml(state!.categories, h.categoryId)}
        </select>
        <button class="icon-btn" data-action="del" data-key="${escapeHtml(h.key)}" aria-label="Supprimer la suggestion « ${escapeHtml(h.label)} »">${icons.trash}</button>
      </li>`;

    const wireRows = (container: Element): void => {
      container.querySelectorAll<HTMLElement>(".suggestion-name").forEach((el) => {
        el.addEventListener("click", () => {
          startEdit(el, {
            value: el.textContent || "",
            onCommit: (value) => {
              if (value) conn.send({ type: "updateHistoryEntry", key: el.dataset.key!, label: value });
              else renderList();
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
        const entry = state!.history.find((h) => h.key === key);
        if (!entry) return;
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
      const container = overlay.querySelector("#suggestion-list");
      if (!container) return;
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
        </div>
      `;
      overlay.querySelector(".modal-close")?.addEventListener("click", close);
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
    const form = root.querySelector("#add-form") as HTMLFormElement | null;
    const input = root.querySelector("#add-input") as HTMLInputElement | null;
    const preview = root.querySelector("#add-preview-qty") as HTMLElement | null;
    const suggestionsEl = root.querySelector("#suggestions") as HTMLElement | null;
    const categorySelect = root.querySelector("#add-category") as HTMLSelectElement | null;
    if (!form || !input) return;

    input.addEventListener("input", () => {
      const { quantity } = parseFreeText(input.value);
      if (preview) {
        preview.hidden = !quantity;
        preview.textContent = quantity;
      }
      renderTypeahead(input.value);
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (suggestionsEl) suggestionsEl.hidden = true;
      }, 150);
    });
    input.addEventListener("focus", () => renderTypeahead(input.value));

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const rawText = input.value.trim();
      if (!rawText) return;
      const categoryId = categorySelect?.value || null;
      conn.send({ type: "addItem", id: uid(), rawText, categoryId });
      input.value = "";
      if (preview) preview.hidden = true;
      if (suggestionsEl) suggestionsEl.hidden = true;
      input.focus();
    });

    function renderTypeahead(query: string): void {
      if (!suggestionsEl) return;
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
    const el = root.querySelector("#quick-add");
    if (!el || !state) return;
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
    if (!state) return [];
    const activeNames = new Set(state.items.filter((i) => !i.checked).map((i) => i.name.trim().toLowerCase()));
    return [...state.history].filter((h) => !activeNames.has(h.key)).sort((a, b) => alnumCompare(a.label, b.label));
  }

  function addFromHistory(entry: HistoryEntry): void {
    conn.send({ type: "addItem", id: uid(), rawText: entry.label, categoryId: entry.categoryId });
  }

  function renderCategories(): void {
    const container = root.querySelector("#categories") as HTMLElement | null;
    if (!container || !state) return;

    const query = searchQuery.trim().toLowerCase();
    const byCategory = (categoryId: string | null): Item[] =>
      state!.items.filter((i) => i.categoryId === categoryId && (!query || i.name.toLowerCase().includes(query)));
    const sortItems = (items: Item[]): Item[] =>
      [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || a.order - b.order);

    const cats = [...state.categories].sort((a, b) => a.order - b.order);
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

    if (groups.length === 0 && query) {
      container.innerHTML = `<div class="empty-state">Aucun article ne correspond à « ${escapeHtml(searchQuery.trim())} ».</div>`;
      disposeItemDnd?.();
      disposeCategoryDnd?.();
      return;
    }

    if (groups.every((g) => g.items.length === 0)) {
      container.innerHTML = `<div class="empty-state">Ta liste est vide. Ajoute un premier article ci-dessus 👆</div>`;
      disposeItemDnd?.();
      disposeCategoryDnd?.();
      return;
    }

    container.innerHTML = groups
      .map(
        (g) => `
      <section class="category-section${g.id ? " has-color" : ""}" data-category-id="${g.id ?? ""}" ${g.id ? `style="--cat-hue: ${g.hue}"` : ""}>
        ${
          g.showHeader
            ? `<header class="category-header">
                ${g.id ? `<button class="drag-handle category-drag-handle" aria-label="Réordonner la catégorie">${icons.gripVertical}</button>` : `<span class="drag-handle-spacer"></span>`}
                ${g.id ? `<span class="category-dot" aria-hidden="true"></span>` : ""}
                <span class="category-name" data-id="${g.id ?? ""}">${escapeHtml(g.name)}</span>
                <span class="category-count">${g.items.filter((i) => !i.checked).length}</span>
              </header>`
            : ""
        }
        <ul class="item-list" data-category-id="${g.id ?? ""}">
          ${g.items.map(itemRowHtml).join("")}
        </ul>
      </section>`,
      )
      .join("");

    container.querySelectorAll<HTMLInputElement>(".item-check").forEach((cb) => {
      cb.addEventListener("change", () => {
        conn.send({ type: "toggleItem", id: cb.dataset.id!, checked: cb.checked });
        if (cb.checked) navigator.vibrate?.(10);
      });
    });

    container.querySelectorAll<HTMLElement>('[data-action="delete-item"]').forEach((btn) => {
      const item = state!.items.find((i) => i.id === btn.dataset.id);
      if (!item) return;
      wireConfirmClick(btn, {
        armedLabel: `Confirmer la suppression de « ${item.name} »`,
        onConfirm: () => {
          conn.send({ type: "deleteItem", id: item.id });
          pushUndo(`« ${item.name} » supprimé`, () => conn.send({ type: "restoreItems", items: [item] }));
        },
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
  }

  function itemRowHtml(item: Item): string {
    return `
      <li class="item ${item.checked ? "checked" : ""}" data-id="${item.id}">
        <button class="drag-handle item-drag-handle" aria-label="Déplacer">${icons.gripVertical}</button>
        <input type="checkbox" class="item-check" data-id="${item.id}" ${item.checked ? "checked" : ""} />
        <span class="qty-badge ${item.quantity ? "" : "qty-empty"}" data-id="${item.id}">${escapeHtml(item.quantity) || "+"}</span>
        <span class="item-name" data-id="${item.id}">${escapeHtml(item.name)}</span>
        <button class="icon-btn item-delete" data-action="delete-item" data-id="${item.id}" aria-label="Supprimer">${icons.trash}</button>
      </li>
    `;
  }

  function categoryOptionsHtml(categories: Category[], selectedId: string | null = null): string {
    const sorted = [...categories].sort((a, b) => a.order - b.order);
    const optionHtml = (c: Category) => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.name)}</option>`;
    return [`<option value="" ${selectedId === null ? "selected" : ""}>Sans catégorie</option>`, sorted.map(optionHtml).join("")].join("");
  }

  function layoutHtml(s: ListState, isConnected: boolean): string {
    return `
      <div class="list-view">
        <header class="list-header">
          <button class="icon-btn" id="btn-home" aria-label="Accueil">${icons.back}</button>
          <h1 class="list-title" id="list-title">${escapeHtml(s.name)}</h1>
          <span class="conn-dot ${isConnected ? "online" : ""}" id="conn-dot" title="${isConnected ? "Synchronisé" : "Connexion…"}"></span>
          <button class="icon-btn" id="btn-search" aria-label="Rechercher">${icons.search}</button>
          <button class="icon-btn" id="btn-share" aria-label="Partager">${icons.share}</button>
          <button class="icon-btn" id="btn-menu" aria-label="Menu">${icons.more}</button>
          <div class="menu-panel" id="menu-panel" hidden>
            <button type="button" data-action="theme">${themeMenuHtml(getThemePreference())}</button>
            <button type="button" data-action="manage-categories">Gérer les catégories</button>
            <button type="button" data-action="manage-suggestions">Gérer les suggestions</button>
            <button type="button" data-action="export">Exporter (JSON)</button>
            <button type="button" data-action="import">Importer…</button>
            <button type="button" data-action="clear-checked">Vider les articles cochés</button>
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

        <div id="quick-add" class="quick-add"></div>

        <div id="categories" class="categories"></div>

        <input type="file" id="import-file" accept="application/json" hidden />
      </div>
    `;
  }

  function themeMenuHtml(pref: ThemePreference): string {
    return `<span class="menu-item-icon">${THEME_ICON[pref]}</span> Thème : ${themeLabel(pref)}`;
  }

  function updateThemeMenuItem(button: HTMLElement): void {
    button.innerHTML = themeMenuHtml(getThemePreference());
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
    clearUndoStack();
    document.querySelectorAll(".modal-overlay").forEach((el) => el.remove());
  };
}
