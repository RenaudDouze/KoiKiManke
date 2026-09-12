import "./style.css";
import { applyTheme, getThemePreference } from "./lib/theme";
import { applyAccessibility, getAccessibilityPreference } from "./lib/accessibility";
import { appPath, routePath } from "./lib/basePath";

// Appliqué avant le premier rendu pour éviter un flash de thème clair suivi
// d'un bascule sombre si l'utilisateur a choisi un thème manuel.
applyTheme(getThemePreference());
applyAccessibility(getAccessibilityPreference());

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

  if (match) {
    const { mountListView } = await import("./views/list");
    if (token !== renderToken) return;
    cleanup?.();
    cleanup = mountListView(app, match[1].toUpperCase(), navigate);
  } else {
    const { mountHomeView } = await import("./views/home");
    if (token !== renderToken) return;
    cleanup?.();
    cleanup = mountHomeView(app, navigate);
  }
}

window.addEventListener("popstate", render);
render();
