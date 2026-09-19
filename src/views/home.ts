import { createList, fetchListState } from "../lib/http";
import { getRecentLists, forgetRecentList, touchRecentList, toggleFavoriteList, type RecentList } from "../lib/storage";
import { escapeHtml } from "../lib/dom";
import { icons } from "../lib/icons";
import { cycleThemePreference, getThemePreference, themeLabel, type ThemePreference } from "../lib/theme";
import { toggleAccessibilityPreference, getAccessibilityPreference, accessibilityLabel } from "../lib/accessibility";
import { PRIVACY_HINT } from "../lib/privacyHint";
import { decodeListFromParam } from "../lib/compactShare";
import type { ImportPayload } from "../lib/importExport";

const THEME_ICON: Record<ThemePreference, string> = { system: icons.themeAuto, light: icons.sun, dark: icons.moon };

export function mountHomeView(root: HTMLElement, navigate: (path: string) => void, importParam: string | null = null): () => void {
  // Lien/QR compact ouvert alors qu'aucune liste particulière n'est en cours
  // (voir src/lib/compactShare.ts, src/main.ts) : pas de liste "actuelle" où
  // fusionner ici (contrairement à mountListView), donc la seule action
  // proposée est d'en créer une nouvelle à partir de l'aperçu — l'utilisateur
  // peut aussi l'ignorer et se comporter comme si le lien n'avait rien eu de
  // spécial. `null` si le paramètre est absent, invalide ou déjà ignoré.
  let pendingImport: ImportPayload | null = importParam ? decodeListFromParam(importParam) : null;

  render();

  function importBannerHtml(data: ImportPayload): string {
    return `
      <section class="card import-banner">
        <h2>Liste partagée reçue</h2>
        <p>
          ${data.items.length} article(s) et ${data.categories.length} catégorie(s)${
            data.name ? ` — « ${escapeHtml(data.name)} »` : ""
          }, en aperçu (pas encore une liste synchronisée).
        </p>
        <div class="stacked-actions">
          <button type="button" class="btn primary" id="import-banner-create">Créer une nouvelle liste avec ce contenu</button>
          <button type="button" class="btn" id="import-banner-dismiss">Ignorer</button>
        </div>
      </section>
    `;
  }

  function recentItemHtml(r: RecentList): string {
    return `
      <li class="recent-item">
        <button type="button" class="icon-btn recent-favorite" data-code="${r.code}" aria-label="${r.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-pressed="${r.favorite ? "true" : "false"}">
          ${r.favorite ? icons.starFilled : icons.star}
        </button>
        <button type="button" class="recent-open" data-code="${r.code}">
          <span class="recent-name">${escapeHtml(r.name)}</span>
        </button>
        <button type="button" class="icon-btn recent-forget" data-code="${r.code}" aria-label="Oublier cette liste">${icons.close}</button>
      </li>`;
  }

  function render(): void {
    const recents = getRecentLists();
    const favorites = recents.filter((r) => r.favorite);
    const others = recents.filter((r) => !r.favorite);
    const theme = getThemePreference();
    const a11y = getAccessibilityPreference();
    root.innerHTML = `
      <div class="home">
        <div class="home-toggles">
          <button type="button" class="icon-btn" id="a11y-toggle" aria-label="Accessibilité : ${accessibilityLabel(a11y)}" title="Accessibilité : ${accessibilityLabel(a11y)}" aria-pressed="${a11y === "on"}">
            ${icons.accessibility}
          </button>
          <button type="button" class="icon-btn" id="theme-toggle" aria-label="Thème : ${themeLabel(theme)}" title="Thème : ${themeLabel(theme)}">
            ${THEME_ICON[theme]}
          </button>
        </div>
        <header class="home-header">
          <div class="logo">${icons.cart}</div>
          <h1>KoiKiManke</h1>
          <p class="tagline">Une liste de courses partagée, synchronisée en direct.</p>
          <p class="tagline privacy-note">${PRIVACY_HINT}</p>
        </header>

        ${pendingImport ? importBannerHtml(pendingImport) : ""}

        ${
          recents.length
            ? `<section class="card">
                <h2>Listes récentes</h2>
                ${
                  favorites.length
                    ? `<h3 class="recent-subheading">Favoris</h3>
                       <ul class="recent-list">${favorites.map(recentItemHtml).join("")}</ul>`
                    : ""
                }
                ${
                  others.length
                    ? `${favorites.length ? '<h3 class="recent-subheading">Autres</h3>' : ""}
                       <ul class="recent-list">${others.map(recentItemHtml).join("")}</ul>`
                    : ""
                }
              </section>`
            : ""
        }

        <section class="card">
          <h2>Nouvelle liste</h2>
          <form id="create-form" class="row">
            <input id="create-name" type="text" placeholder="Nom de la liste (optionnel)" maxlength="60" />
            <button type="submit" class="btn primary">Créer</button>
          </form>
          <p class="add-form-hint">${PRIVACY_HINT}</p>
        </section>

        <section class="card">
          <h2>Rejoindre une liste</h2>
          <form id="join-form" class="row">
            <input id="join-code" type="text" placeholder="Code à 6 caractères" maxlength="10" autocapitalize="characters" />
            <button type="submit" class="btn">Rejoindre</button>
          </form>
          <p id="join-error" class="error" hidden></p>
        </section>
      </div>
    `;

    root.querySelector("#theme-toggle")?.addEventListener("click", () => {
      cycleThemePreference();
      render();
    });
    root.querySelector("#a11y-toggle")?.addEventListener("click", () => {
      toggleAccessibilityPreference();
      render();
    });

    root.querySelector("#create-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const nameInput = root.querySelector("#create-name") as HTMLInputElement;
      const btn = form.querySelector("button") as HTMLButtonElement;
      btn.disabled = true;
      try {
        const state = await createList(nameInput.value.trim() || "Liste de courses");
        touchRecentList(state.code, state.name);
        navigate(`/l/${state.code}`);
      } catch {
        alert("Impossible de créer la liste. Vérifie ta connexion internet.");
        btn.disabled = false;
      }
    });

    root.querySelector("#join-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const input = root.querySelector("#join-code") as HTMLInputElement;
      const errorEl = root.querySelector("#join-error") as HTMLElement;
      const btn = form.querySelector("button") as HTMLButtonElement;
      const code = input.value.trim().toUpperCase();
      errorEl.hidden = true;
      if (!code) return;
      btn.disabled = true;
      try {
        const state = await fetchListState(code);
        if (!state) {
          errorEl.textContent = "Aucune liste ne correspond à ce code.";
          errorEl.hidden = false;
        } else {
          touchRecentList(state.code, state.name);
          navigate(`/l/${state.code}`);
        }
      } catch {
        errorEl.textContent = "Erreur réseau, réessaie.";
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelectorAll<HTMLButtonElement>(".recent-open").forEach((btn) => {
      btn.addEventListener("click", () => navigate(`/l/${btn.dataset.code}`));
    });
    root.querySelectorAll<HTMLButtonElement>(".recent-favorite").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.code) toggleFavoriteList(btn.dataset.code);
        render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>(".recent-forget").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.code) forgetRecentList(btn.dataset.code);
        render();
      });
    });

    root.querySelector("#import-banner-create")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        const created = await createList(pendingImport!.name.trim() || "Liste de courses");
        touchRecentList(created.code, created.name);
        // Le paramètre brut (déjà compressé) est reporté dans l'URL de la
        // nouvelle liste — encodeURIComponent est indispensable ici : la
        // chaîne compressée par lz-string peut contenir un `+` ou un `$`
        // (voir compactShare.ts), qui casseraient sinon le paramètre une fois
        // relu via URLSearchParams (un `+` non encodé y est lu comme un
        // espace). mountListView décode et propose ensuite la même invite
        // fusion/remplacement qu'un fichier JSON importé (voir src/main.ts,
        // src/views/list.ts) — évite de dupliquer ici l'envoi du message
        // importState, qui ne peut de toute façon se faire qu'une fois le
        // WebSocket de cette nouvelle liste établi.
        navigate(`/l/${created.code}?import=${encodeURIComponent(importParam!)}`);
      } catch {
        alert("Impossible de créer la liste. Vérifie ta connexion internet.");
        btn.disabled = false;
      }
    });
    root.querySelector("#import-banner-dismiss")?.addEventListener("click", () => {
      pendingImport = null;
      render();
    });
  }

  return () => {};
}
