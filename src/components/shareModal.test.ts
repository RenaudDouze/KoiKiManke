// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openShareModal } from "./shareModal";
import { decodeListFromParam } from "../lib/compactShare";
import type { ImportPayload } from "../lib/importExport";

vi.mock("./qr", () => ({
  renderQrSvg: vi.fn(async (text: string) => `<svg data-text="${text}"></svg>`),
}));

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function samplePayload(overrides: Partial<ImportPayload> = {}): ImportPayload {
  return {
    name: "Courses",
    items: [{ id: "i1", name: "Pommes", quantity: "2 kg", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
    categories: [],
    history: [],
    ...overrides,
  };
}

function open(
  actions?: Partial<{ onExport: () => void; onImportFile: (file: File) => void }>,
  payload: ImportPayload = samplePayload(),
) {
  const onExport = actions?.onExport ?? vi.fn();
  const onImportFile = actions?.onImportFile ?? vi.fn();
  openShareModal("ABCDEF", "Courses", payload, { onExport, onImportFile });
  return { onExport, onImportFile };
}

describe("openShareModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (navigator as unknown as Record<string, unknown>).clipboard;
    delete (navigator as unknown as Record<string, unknown>).share;
  });

  it("affiche le code, le nom (échappé) et le lien de partage", () => {
    open();
    document.title = "";
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;

    expect(overlay.querySelector("h2")?.textContent).toBe('Partager « Courses »');
    expect(overlay.querySelector(".share-code")?.textContent).toBe("ABCDEF");
    expect(overlay.querySelector(".share-link")?.textContent).toContain("/l/ABCDEF");
  });

  it("échappe un nom de liste contenant du HTML", () => {
    openShareModal("ABCDEF", "<img src=x>", samplePayload(), { onExport: vi.fn(), onImportFile: vi.fn() });
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;

    expect(overlay.querySelector("h2")?.innerHTML).not.toContain("<img");
    expect(overlay.querySelector("h2")?.textContent).toContain("<img src=x>");
  });

  it("charge le QR code de façon asynchrone et l'insère dans le conteneur dédié", async () => {
    open();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;
    expect(overlay.querySelector("#qr-wrap")?.innerHTML).toBe("");

    await vi.waitFor(() => expect(overlay.querySelector("#qr-wrap")?.innerHTML).toContain("<svg"));
  });

  it("place le focus dans la modale à l'ouverture (piège de focus)", () => {
    open();
    const modal = document.querySelector(".modal") as HTMLElement;

    expect(document.activeElement).toBe(modal);
  });

  it("Échap ferme la modale et retire l'écouteur clavier", () => {
    open();
    expect(document.querySelector(".modal-overlay")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("une touche autre qu'Échap ne ferme pas la modale", () => {
    open();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(document.querySelector(".modal-overlay")).not.toBeNull();
  });

  it("cliquer sur l'overlay (en dehors de la modale) la ferme", () => {
    open();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;

    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("cliquer à l'intérieur de la modale ne la ferme pas", () => {
    open();
    const modal = document.querySelector(".modal") as HTMLElement;

    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".modal-overlay")).not.toBeNull();
  });

  it("le bouton de fermeture ferme la modale", () => {
    open();
    const closeBtn = document.querySelector(".modal-close") as HTMLButtonElement;

    closeBtn.click();

    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("« Copier le lien » copie l'URL et affiche une confirmation temporaire", async () => {
    open();
    const btn = document.querySelector("#copy-link") as HTMLButtonElement;

    btn.click();
    await flushPromises();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/l/ABCDEF"));
    expect(btn.textContent).toBe("Copié !");

    vi.advanceTimersByTime(1200);
    expect(btn.textContent).toBe("Copier le lien");
  });

  it("« Copier le code » copie le code et affiche une confirmation temporaire", async () => {
    open();
    const btn = document.querySelector("#copy-code") as HTMLButtonElement;

    btn.click();
    await flushPromises();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCDEF");
    expect(btn.textContent).toBe("Copié !");

    vi.advanceTimersByTime(1200);
    expect(btn.textContent).toBe("Copier le code");
  });

  it("ignore silencieusement un presse-papiers indisponible (ancien navigateur / pas de https)", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    open();
    const btn = document.querySelector("#copy-link") as HTMLButtonElement;

    expect(() => btn.click()).not.toThrow();
    await flushPromises();

    expect(btn.textContent).toBe("Copié !");
  });

  it("propose le partage natif quand navigator.share est disponible", () => {
    Object.defineProperty(navigator, "share", { value: vi.fn().mockResolvedValue(undefined), configurable: true });
    open();

    expect(document.querySelector("#native-share")).not.toBeNull();
  });

  it("n'affiche pas le partage natif si navigator.share est absent", () => {
    open();

    expect(document.querySelector("#native-share")).toBeNull();
  });

  it("le partage natif appelle navigator.share avec le titre et l'URL", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    open();

    (document.querySelector("#native-share") as HTMLButtonElement).click();
    await flushPromises();

    expect(share).toHaveBeenCalledWith({ title: "Courses", url: expect.stringContaining("/l/ABCDEF") });
  });

  it("une annulation du partage natif (rejet) est ignorée silencieusement", async () => {
    const share = vi.fn().mockRejectedValue(new Error("cancelled"));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    open();

    expect(() => (document.querySelector("#native-share") as HTMLButtonElement).click()).not.toThrow();
    await flushPromises();

    expect(share).toHaveBeenCalledOnce();
  });

  it("« Exporter » ferme la modale et déclenche l'export", () => {
    const { onExport } = open();

    (document.querySelector("#share-export") as HTMLButtonElement).click();

    expect(onExport).toHaveBeenCalledOnce();
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("« Importer… » déclenche le sélecteur de fichier caché", () => {
    open();
    const fileInput = document.querySelector("#share-import-file") as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    (document.querySelector("#share-import") as HTMLButtonElement).click();

    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it("choisir un fichier ferme la modale et transmet le fichier importé", () => {
    const { onImportFile } = open();
    const fileInput = document.querySelector("#share-import-file") as HTMLInputElement;
    const file = new File(["{}"], "liste.json", { type: "application/json" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });

    fileInput.dispatchEvent(new Event("change"));

    expect(onImportFile).toHaveBeenCalledWith(file);
    expect(fileInput.value).toBe("");
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("un changement du sélecteur de fichier sans fichier choisi ne fait rien", () => {
    const { onImportFile } = open();
    const fileInput = document.querySelector("#share-import-file") as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { value: [], configurable: true });

    fileInput.dispatchEvent(new Event("change"));

    expect(onImportFile).not.toHaveBeenCalled();
    expect(document.querySelector(".modal-overlay")).not.toBeNull();
  });

  describe("lien/QR compact", () => {
    it("est replié par défaut", () => {
      open();
      const section = document.querySelector("#compact-share") as HTMLElement;
      expect(section.hidden).toBe(true);
      expect(document.querySelector("#toggle-compact-share")?.getAttribute("aria-expanded")).toBe("false");
    });

    it("un premier clic sur la bascule le déplie, génère le lien et son QR (décodable)", async () => {
      const payload = samplePayload({ name: "Ma liste" });
      open(undefined, payload);
      // Attend que le premier QR (lien direct) soit résolu avant de déclencher
      // le second (import("./qr") concurrent sinon, voir renderQrInto) : deux
      // dynamic import() de la même spécification avant résolution du premier
      // ne partagent pas forcément le même mock dans cet environnement de test.
      await vi.waitFor(() => expect(document.querySelector("#qr-wrap")?.innerHTML).toContain("<svg"));
      const toggle = document.querySelector("#toggle-compact-share") as HTMLButtonElement;

      toggle.click();

      const section = document.querySelector("#compact-share") as HTMLElement;
      expect(section.hidden).toBe(false);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      const link = document.querySelector("#compact-link")?.textContent ?? "";
      expect(link).toContain("?import=");
      expect(link).not.toContain("/l/ABCDEF");
      const encoded = new URL(link).searchParams.get("import")!;
      expect(decodeListFromParam(encoded)).toEqual(payload);

      await vi.waitFor(() => expect(document.querySelector("#compact-qr-wrap")?.innerHTML).toContain("<svg"));
      expect(document.querySelector("#compact-qr-wrap")?.innerHTML).toContain(link);
    });

    it("un second clic replie la section sans recalculer le lien", async () => {
      open();
      const toggle = document.querySelector("#toggle-compact-share") as HTMLButtonElement;
      toggle.click();
      await flushPromises();
      const link = document.querySelector("#compact-link")?.textContent;

      toggle.click();
      expect((document.querySelector("#compact-share") as HTMLElement).hidden).toBe(true);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");

      toggle.click();
      expect((document.querySelector("#compact-share") as HTMLElement).hidden).toBe(false);
      expect(document.querySelector("#compact-link")?.textContent).toBe(link);
    });

    it("« Copier le lien compact » copie le lien et affiche une confirmation temporaire", async () => {
      open();
      (document.querySelector("#toggle-compact-share") as HTMLButtonElement).click();
      const link = document.querySelector("#compact-link")?.textContent;
      const btn = document.querySelector("#copy-compact-link") as HTMLButtonElement;

      btn.click();
      await flushPromises();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link);
      expect(btn.textContent).toBe("Copié !");

      vi.advanceTimersByTime(1200);
      expect(btn.textContent).toBe("Copier le lien compact");
    });

    it("« Copier le lien compact » ne fait rien tant que la section n'a jamais été dépliée", async () => {
      open();

      (document.querySelector("#copy-compact-link") as HTMLButtonElement).click();
      await flushPromises();

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });
});
