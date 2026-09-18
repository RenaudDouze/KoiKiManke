// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

type Navigate = (path: string, replace?: boolean) => void;
let capturedNavigate: Navigate | undefined;

const cleanupHome = vi.fn();
const cleanupList = vi.fn();
const mountHomeView = vi.fn((_root: HTMLElement, navigate: Navigate) => {
  capturedNavigate = navigate;
  return cleanupHome;
});
const mountListView = vi.fn((_root: HTMLElement, _code: string, navigate: Navigate) => {
  capturedNavigate = navigate;
  return cleanupList;
});

vi.mock("./views/home", () => ({ mountHomeView }));
vi.mock("./views/list", () => ({ mountListView }));

// main.ts est un point d'entrée à effets de bord (aucun export, monté une
// seule fois pour toute la durée du process, aussi bien réel qu'en test) :
// un seul scénario séquentiel plutôt que des `it()` indépendants — Vitest 5
// efface l'historique des mocks avant CHAQUE test (clearMocks: true par
// défaut), ce qui casserait toute assertion à cheval sur plusieurs `it()`
// pour un module qui ne peut être importé (et donc rendu) qu'une seule fois.
describe("main (bootstrap applicatif)", () => {
  it("route entre accueil et vue liste, gère l'historique et les navigations périmées", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState({}, "", "/");
    const app = document.getElementById("app");

    await import("./main");
    await vi.waitFor(() => expect(mountHomeView).toHaveBeenCalled());

    // Chargement initial sur "/" : vue accueil.
    expect(mountHomeView).toHaveBeenCalledTimes(1);
    expect(mountHomeView).toHaveBeenCalledWith(app, expect.any(Function));
    expect(mountListView).not.toHaveBeenCalled();

    // Naviguer vers /l/CODE pousse l'historique et monte la vue liste, code
    // normalisé en majuscules ; l'ancienne vue est nettoyée au passage.
    capturedNavigate!("/l/abcdef");
    await vi.waitFor(() => expect(mountListView).toHaveBeenCalled());
    expect(location.pathname).toBe("/l/abcdef");
    expect(mountListView).toHaveBeenCalledWith(app, "ABCDEF", expect.any(Function));
    expect(cleanupHome).toHaveBeenCalledOnce();

    // replace=true utilise history.replaceState plutôt que pushState.
    const replaceSpy = vi.spyOn(history, "replaceState");
    const pushSpy = vi.spyOn(history, "pushState");
    capturedNavigate!("/", true);
    await vi.waitFor(() => expect(mountHomeView).toHaveBeenCalledTimes(2));
    expect(replaceSpy).toHaveBeenCalledWith({}, "", "/");
    expect(pushSpy).not.toHaveBeenCalled();
    expect(cleanupList).toHaveBeenCalledOnce();

    // Naviguer vers le chemin déjà courant ne touche pas l'historique, mais
    // déclenche quand même un nouveau rendu.
    replaceSpy.mockClear();
    pushSpy.mockClear();
    capturedNavigate!("/");
    await vi.waitFor(() => expect(mountHomeView).toHaveBeenCalledTimes(3));
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();

    // Une navigation navigateur (popstate, ex: bouton précédent) re-render
    // selon le chemin courant.
    history.replaceState({}, "", "/l/zzzzzz");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(mountListView).toHaveBeenCalledWith(app, "ZZZZZZ", expect.any(Function)));

    // Deux popstate synchrones : le premier (liste) reste "en vol" derrière
    // son import() à la demande pendant que le second (accueil), plus
    // récent, s'exécute entièrement — renderToken doit alors faire échouer
    // le premier plutôt que de laisser un rendu périmé s'appliquer.
    mountListView.mockClear();
    mountHomeView.mockClear();
    history.replaceState({}, "", "/l/stale1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(mountHomeView).toHaveBeenCalled());
    expect(mountListView).not.toHaveBeenCalled();

    // Et symétriquement dans l'autre sens (accueil périmé, liste plus récente).
    mountListView.mockClear();
    mountHomeView.mockClear();
    history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    history.replaceState({}, "", "/l/stale2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(mountListView).toHaveBeenCalled());
    expect(mountHomeView).not.toHaveBeenCalled();
  });
});
