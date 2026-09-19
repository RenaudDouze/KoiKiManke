// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { encodeListToParam } from "./lib/compactShare";

type Navigate = (path: string, replace?: boolean) => void;
let capturedNavigate: Navigate | undefined;

const cleanupHome = vi.fn();
const cleanupList = vi.fn();
const mountHomeView = vi.fn((_root: HTMLElement, navigate: Navigate, _importParam: string | null) => {
  capturedNavigate = navigate;
  return cleanupHome;
});
const mountListView = vi.fn((_root: HTMLElement, _code: string, navigate: Navigate, _importParam: string | null) => {
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
    expect(mountHomeView).toHaveBeenCalledWith(app, expect.any(Function), null);
    expect(mountListView).not.toHaveBeenCalled();

    // Naviguer vers /l/CODE pousse l'historique et monte la vue liste, code
    // normalisé en majuscules ; l'ancienne vue est nettoyée au passage.
    capturedNavigate!("/l/abcdef");
    await vi.waitFor(() => expect(mountListView).toHaveBeenCalled());
    expect(location.pathname).toBe("/l/abcdef");
    expect(mountListView).toHaveBeenCalledWith(app, "ABCDEF", expect.any(Function), null);
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
    await vi.waitFor(() => expect(mountListView).toHaveBeenCalledWith(app, "ZZZZZZ", expect.any(Function), null));

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

    // Lien/QR compact (voir src/lib/compactShare.ts) : `?import=...` est
    // retiré de la barre d'adresse dès sa lecture (qu'un rafraîchissement ne
    // redéclenche pas la même invite d'import), et transmis tel quel à la
    // vue montée — chaque vue décode elle-même la valeur (main.ts n'a pas à
    // connaître compactShare.ts au-delà de l'extraction du paramètre brut).
    mountListView.mockClear();
    const encoded = encodeListToParam({ name: "Reçue", items: [], categories: [], history: [] });
    // Construit via URLSearchParams (comme le ferait shareModal.ts/home.ts en
    // pratique), pas une simple concaténation : l'alphabet de lz-string peut
    // contenir un `+`, qu'une concaténation brute romprait (lu comme un
    // espace par URLSearchParams côté lecture, voir compactShare.ts).
    const importUrl = new URL("http://localhost/l/withimport");
    importUrl.searchParams.set("import", encoded);
    history.replaceState({}, "", importUrl.pathname + importUrl.search);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(mountListView).toHaveBeenCalledWith(app, "WITHIMPORT", expect.any(Function), encoded));
    expect(location.search).toBe("");

    // Sans paramètre `import`, l'URL n'est pas touchée par un replaceState
    // superflu (voir consumeImportParam dans src/lib/compactShare.ts) — même
    // spy que plus haut, remis à zéro juste avant.
    mountHomeView.mockClear();
    replaceSpy.mockClear();
    history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(mountHomeView).toHaveBeenCalledWith(app, expect.any(Function), null));
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
