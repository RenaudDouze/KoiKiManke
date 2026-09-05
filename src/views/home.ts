import { createList, fetchListState } from "../lib/http";
import { getRecentLists, forgetRecentList, touchRecentList } from "../lib/storage";
import { escapeHtml } from "../lib/dom";

export function mountHomeView(root: HTMLElement, navigate: (path: string) => void): () => void {
  render();

  function render(): void {
    const recents = getRecentLists();
    root.innerHTML = `
      <div class="home">
        <header class="home-header">
          <div class="logo">🛒</div>
          <h1>Notre Liste de Courses</h1>
          <p class="tagline">Une liste de courses partagée, synchronisée en direct.</p>
        </header>

        <section class="card">
          <h2>Nouvelle liste</h2>
          <form id="create-form" class="row">
            <input id="create-name" type="text" placeholder="Nom de la liste (optionnel)" maxlength="60" />
            <button type="submit" class="btn primary">Créer</button>
          </form>
        </section>

        <section class="card">
          <h2>Rejoindre une liste</h2>
          <form id="join-form" class="row">
            <input id="join-code" type="text" placeholder="Code à 6 caractères" maxlength="10" autocapitalize="characters" />
            <button type="submit" class="btn">Rejoindre</button>
          </form>
          <p id="join-error" class="error" hidden></p>
        </section>

        ${
          recents.length
            ? `<section class="card">
                <h2>Listes récentes</h2>
                <ul class="recent-list">
                  ${recents
                    .map(
                      (r) => `
                    <li class="recent-item">
                      <button type="button" class="recent-open" data-code="${r.code}">
                        <span class="recent-name">${escapeHtml(r.name)}</span>
                        <span class="recent-code">${r.code}</span>
                      </button>
                      <button type="button" class="icon-btn recent-forget" data-code="${r.code}" aria-label="Oublier cette liste">✕</button>
                    </li>`,
                    )
                    .join("")}
                </ul>
              </section>`
            : ""
        }
      </div>
    `;

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
    root.querySelectorAll<HTMLButtonElement>(".recent-forget").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.code) forgetRecentList(btn.dataset.code);
        render();
      });
    });
  }

  return () => {};
}
