import "./style.css";
import { mountHomeView } from "./views/home";
import { mountListView } from "./views/list";
import { applyTheme, getThemePreference } from "./lib/theme";

// Appliqué avant le premier rendu pour éviter un flash de thème clair suivi
// d'un bascule sombre si l'utilisateur a choisi un thème manuel.
applyTheme(getThemePreference());

const app = document.getElementById("app")!;
let cleanup: (() => void) | null = null;

function navigate(path: string, replace = false): void {
  if (location.pathname !== path) {
    if (replace) history.replaceState({}, "", path);
    else history.pushState({}, "", path);
  }
  render();
}

function render(): void {
  cleanup?.();
  cleanup = null;

  const match = location.pathname.match(/^\/l\/([A-Za-z0-9]+)\/?$/);
  if (match) {
    cleanup = mountListView(app, match[1].toUpperCase(), navigate);
  } else {
    cleanup = mountHomeView(app, navigate);
  }
}

window.addEventListener("popstate", render);
render();
