import type { Category, HistoryEntry, Item, ListState } from "../../shared/types";
import { parseFreeText } from "../../shared/quantity";
import { ListConnection } from "../lib/ws";
import { fetchListState } from "../lib/http";
import { cacheListState, getCachedListState, touchRecentList } from "../lib/storage";
import { uid } from "../lib/id";
import { escapeHtml } from "../lib/dom";
import { startEdit } from "../lib/editable";
import { enableDragReorder } from "../lib/dnd";
import { openShareModal } from "../components/shareModal";
import { exportListState, parseImportFile } from "../lib/importExport";

export function mountListView(root: HTMLElement, code: string, navigate: (path: string) => void): () => void {
  let state: ListState | null = getCachedListState(code);
  let connected = false;
  let loading = state === null;
  let notFound = false;
  let loadError = false;
  let disposeItemDnd: (() => void) | null = null;
  let disposeCategoryDnd: (() => void) | null = null;
  let shellMounted = false;
  const conn = new ListConnection(code);

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

    panel?.querySelector('[data-action="manage-categories"]')?.addEventListener("click", openCategoryManager);
    panel?.querySelector('[data-action="export"]')?.addEventListener("click", () => {
      if (state) exportListState(state);
    });
    panel?.querySelector('[data-action="clear-checked"]')?.addEventListener("click", () => {
      conn.send({ type: "clearChecked" });
    });

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
      <div class="modal">
        <button class="icon-btn modal-close" aria-label="Fermer">✕</button>
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
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
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
    const render = () => {
      overlay.innerHTML = `
        <div class="modal">
          <button class="icon-btn modal-close" aria-label="Fermer">✕</button>
          <h2>Catégories</h2>
          <ul class="manage-category-list">
            ${[...state!.categories]
              .sort((a, b) => a.order - b.order)
              .map(
                (c) => `
              <li data-id="${c.id}">
                <span class="cat-name" data-id="${c.id}">${escapeHtml(c.name)}</span>
                <button class="icon-btn" data-action="del" data-id="${c.id}" aria-label="Supprimer">🗑</button>
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
      overlay.querySelectorAll<HTMLElement>('[data-action="del"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          if (confirm("Supprimer cette catégorie ? Les articles seront déplacés vers « Sans catégorie ».")) {
            conn.send({ type: "deleteCategory", id: btn.dataset.id! });
          }
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
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    const unsubscribe = conn.onState(() => render());
    document.body.appendChild(overlay);
    render();
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
    return [...state.history]
      .filter((h) => !activeNames.has(h.key))
      .sort((a, b) => b.useCount - a.useCount || b.lastUsed - a.lastUsed);
  }

  function addFromHistory(entry: HistoryEntry): void {
    conn.send({ type: "addItem", id: uid(), rawText: entry.label, categoryId: entry.categoryId });
  }

  function renderCategories(): void {
    const container = root.querySelector("#categories") as HTMLElement | null;
    if (!container || !state) return;

    const byCategory = (categoryId: string | null): Item[] => state!.items.filter((i) => i.categoryId === categoryId);
    const sortItems = (items: Item[]): Item[] =>
      [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || a.order - b.order);

    const cats = [...state.categories].sort((a, b) => a.order - b.order);
    type Group = { id: string | null; name: string; items: Item[]; showHeader: boolean };
    const groups: Group[] = cats.map((c) => ({ id: c.id, name: c.name, items: sortItems(byCategory(c.id)), showHeader: true }));
    const uncategorized = sortItems(byCategory(null));
    if (cats.length === 0) {
      groups.unshift({ id: null, name: "Articles", items: uncategorized, showHeader: false });
    } else if (uncategorized.length > 0) {
      groups.push({ id: null, name: "Sans catégorie", items: uncategorized, showHeader: true });
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
      <section class="category-section" data-category-id="${g.id ?? ""}">
        ${
          g.showHeader
            ? `<header class="category-header">
                ${g.id ? `<button class="drag-handle category-drag-handle" aria-label="Réordonner la catégorie">⠿</button>` : `<span class="drag-handle-spacer"></span>`}
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
      });
    });

    container.querySelectorAll<HTMLElement>('[data-action="delete-item"]').forEach((btn) => {
      btn.addEventListener("click", () => conn.send({ type: "deleteItem", id: btn.dataset.id! }));
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
        <button class="drag-handle item-drag-handle" aria-label="Déplacer">⠿</button>
        <input type="checkbox" class="item-check" data-id="${item.id}" ${item.checked ? "checked" : ""} />
        <span class="qty-badge ${item.quantity ? "" : "qty-empty"}" data-id="${item.id}">${escapeHtml(item.quantity) || "+"}</span>
        <span class="item-name" data-id="${item.id}">${escapeHtml(item.name)}</span>
        <button class="icon-btn item-delete" data-action="delete-item" data-id="${item.id}" aria-label="Supprimer">✕</button>
      </li>
    `;
  }

  function categoryOptionsHtml(categories: Category[]): string {
    return [`<option value="">Sans catégorie</option>`]
      .concat(
        [...categories]
          .sort((a, b) => a.order - b.order)
          .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`),
      )
      .join("");
  }

  function layoutHtml(s: ListState, isConnected: boolean): string {
    return `
      <div class="list-view">
        <header class="list-header">
          <button class="icon-btn" id="btn-home" aria-label="Accueil">←</button>
          <h1 class="list-title" id="list-title">${escapeHtml(s.name)}</h1>
          <span class="conn-dot ${isConnected ? "online" : ""}" id="conn-dot" title="${isConnected ? "Synchronisé" : "Connexion…"}"></span>
          <button class="icon-btn" id="btn-share" aria-label="Partager">🔗</button>
          <button class="icon-btn" id="btn-menu" aria-label="Menu">⋮</button>
          <div class="menu-panel" id="menu-panel" hidden>
            <button type="button" data-action="manage-categories">Gérer les catégories</button>
            <button type="button" data-action="export">Exporter (JSON)</button>
            <button type="button" data-action="import">Importer…</button>
            <button type="button" data-action="clear-checked">Vider les articles cochés</button>
          </div>
        </header>

        <form id="add-form" class="add-form">
          <div class="add-row">
            <div class="add-input-wrap">
              <input id="add-input" type="text" placeholder="Ajouter un article… (ex: 2 kg pommes)" autocomplete="off" />
              <span id="add-preview-qty" class="qty-badge qty-preview" hidden></span>
            </div>
            <select id="add-category" aria-label="Catégorie">
              ${categoryOptionsHtml(s.categories)}
            </select>
            <button type="submit" class="btn primary add-submit" aria-label="Ajouter">+</button>
          </div>
          <ul id="suggestions" class="suggestions" hidden></ul>
        </form>

        <div id="quick-add" class="quick-add"></div>

        <div id="categories" class="categories"></div>

        <input type="file" id="import-file" accept="application/json" hidden />
      </div>
    `;
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
    document.querySelectorAll(".modal-overlay").forEach((el) => el.remove());
  };
}
