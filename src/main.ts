import "./style.css";
import { mountHomeView } from "./views/home";
import { mountListView } from "./views/list";

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
