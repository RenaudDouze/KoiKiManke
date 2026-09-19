import "./style.css";
import { applyTheme, getThemePreference } from "./lib/theme";
import { applyAccessibilityPreference, getAccessibilityPreference } from "./lib/accessibilityPreference";
import { appPath, routePath } from "./lib/basePath";
import { consumeImportParam } from "./lib/compactShare";

// Appliqué avant le premier rendu pour éviter un flash de thème clair suivi
// d'un bascule sombre si l'utilisateur a choisi un thème manuel.
applyTheme(getThemePreference());
applyAccessibilityPreference(getAccessibilityPreference());

const app = document.getElementById("app")!;
let cleanup: (() => void) | null = null;
// Incrémenté à chaque render() : si une navigation plus récente a démarré
// pendant qu'un chunk se chargeait, la réponse obsolète ne doit ni monter sa
// vue ni écraser `cleanup` de la navigation qui l'a entre-temps remplacée.
let renderToken = 0;

function navigate(path: string, replace = false): void {
  const target = appPath(path);
  if (location.pathname !== target) {
    if (replace) history.replaceState({}, "", target);
    else history.pushState({}, "", target);
  }
  render();
}

// Vues chargées à la demande (import() dynamique) plutôt qu'importées en
// tête de fichier : l'accueil et la vue liste ne sont jamais nécessaires en
// même temps, inutile de faire payer le code de l'une à qui ne visite que
// l'autre. L'ancienne vue reste affichée le temps du chargement (cleanup()
// n'est appelé qu'une fois la nouvelle prête), donc pas d'écran vide.
async function render(): Promise<void> {
  const token = ++renderToken;
  const match = routePath().match(/^\/l\/([A-Za-z0-9]+)\/?$/);

  // Lien/QR compact (voir src/lib/compactShare.ts) : `?import=...` est retiré
  // de l'URL dès sa lecture, qu'il soit valide ou non, pour qu'un
  // rafraîchissement de page ne redéclenche pas la même invite d'import.
  // Chaque vue décode elle-même la valeur brute (main.ts reste un routeur
  // minimal, sans logique métier propre à l'import) — voir mountListView /
  // mountHomeView.
  const url = new URL(location.href);
  const importParam = consumeImportParam(url);
  if (importParam !== null) history.replaceState({}, "", url.toString());

  if (match) {
    const { mountListView } = await import("./views/list");
    if (token !== renderToken) return;
    cleanup?.();
    cleanup = mountListView(app, match[1].toUpperCase(), navigate, importParam);
  } else {
    const { mountHomeView } = await import("./views/home");
    if (token !== renderToken) return;
    cleanup?.();
    cleanup = mountHomeView(app, navigate, importParam);
  }
}

window.addEventListener("popstate", render);
render();
