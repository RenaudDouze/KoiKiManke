// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportListState, parseImportFile } from "./importExport";
import type { ListState } from "../../shared/types";

describe("exportListState", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let captured: { href: string; download: string } | null;

  beforeEach(() => {
    document.body.innerHTML = "";
    captured = null;
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      captured = { href: this.href, download: this.download };
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  function state(overrides: Partial<ListState> = {}): ListState {
    return { code: "ABCDEF", name: "Courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0, ...overrides };
  }

  it("télécharge un JSON nommé par un slug du nom de la liste, puis nettoie l'URL objet", () => {
    exportListState(state({ name: "Courses d'été !" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(captured?.href).toBe("blob:mock-url");
    expect(captured?.download).toMatch(/^courses-d-ete-\d{4}-\d{2}-\d{2}\.json$/);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("retombe sur \"liste\" si le nom ne contient aucun caractère alphanumérique", () => {
    exportListState(state({ name: "!!!" }));
    expect(captured?.download).toMatch(/^liste-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("inclut les articles/catégories/historique mais pas le code (pas un identifiant réutilisable ailleurs)", () => {
    let blobContent = "";
    createObjectURL.mockImplementation((blob: Blob) => {
      // Blob.text() est asynchrone ; on capture la référence pour l'inspecter après coup.
      blob.text().then((text) => {
        blobContent = text;
      });
      return "blob:mock-url";
    });

    exportListState(
      state({
        items: [{ id: "1", name: "Pommes", quantity: "2 kg", categoryId: null, checked: false, order: 0, createdAt: 0, updatedAt: 0 }],
      }),
    );

    return vi.waitFor(() => {
      const parsed = JSON.parse(blobContent);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.code).toBeUndefined();
      expect(typeof parsed.exportedAt).toBe("number");
    });
  });
});

describe("parseImportFile", () => {
  it("parse un export valide et normalise les champs manquants", async () => {
    const file = new File([JSON.stringify({ items: [{ id: "1" }], categories: [] })], "export.json");
    await expect(parseImportFile(file)).resolves.toEqual({ name: "", items: [{ id: "1" }], categories: [], history: [] });
  });

  it("conserve name/history quand présents", async () => {
    const file = new File([JSON.stringify({ name: "Courses", items: [], categories: [], history: [{ key: "x" }] })], "export.json");
    await expect(parseImportFile(file)).resolves.toEqual({ name: "Courses", items: [], categories: [], history: [{ key: "x" }] });
  });

  it("lève une erreur explicite si le contenu n'est pas du JSON valide", async () => {
    const file = new File(["ceci n'est pas du JSON"], "export.json");
    await expect(parseImportFile(file)).rejects.toThrow("Ce fichier n'est pas un JSON valide.");
  });

  it("lève une erreur explicite si le JSON n'est pas un objet (ex: un nombre)", async () => {
    const file = new File(["42"], "export.json");
    await expect(parseImportFile(file)).rejects.toThrow("Ce fichier ne ressemble pas à un export de liste de courses.");
  });

  it("lève une erreur explicite si le JSON est null", async () => {
    const file = new File(["null"], "export.json");
    await expect(parseImportFile(file)).rejects.toThrow("Ce fichier ne ressemble pas à un export de liste de courses.");
  });

  it("lève une erreur explicite si items/categories ne sont pas des tableaux", async () => {
    const file = new File([JSON.stringify({ items: "pas un tableau", categories: [] })], "export.json");
    await expect(parseImportFile(file)).rejects.toThrow("Ce fichier ne ressemble pas à un export de liste de courses.");
  });
});
