// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createList, fetchListState, photoUrl, uploadItemPhoto } from "./http";
import type { ListState } from "../../shared/types";

const sampleState: ListState = {
  code: "ABCDEF",
  name: "Courses",
  items: [],
  categories: [],
  history: [],
  createdAt: 0,
  updatedAt: 0,
};

describe("createList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("poste le nom et renvoie l'état de la liste créée", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sampleState) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createList("Courses");

    expect(result).toEqual(sampleState);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lists",
      expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Courses" }) }),
    );
  });

  it("lève une erreur si la réponse n'est pas ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(createList("Courses")).rejects.toThrow("Impossible de créer la liste.");
  });
});

describe("fetchListState", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renvoie l'état de la liste pour un code existant", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(sampleState) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchListState("ABCDEF");

    expect(result).toEqual(sampleState);
    expect(fetchMock).toHaveBeenCalledWith("/api/lists/ABCDEF");
  });

  it("encode le code dans l'URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(sampleState) });
    vi.stubGlobal("fetch", fetchMock);

    await fetchListState("A B/C");

    expect(fetchMock).toHaveBeenCalledWith("/api/lists/A%20B%2FC");
  });

  it("renvoie null pour un code inconnu (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchListState("ZZZZZZ")).resolves.toBeNull();
  });

  it("lève une erreur réseau pour toute autre réponse non ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchListState("ABCDEF")).rejects.toThrow("Erreur réseau.");
  });
});

describe("photoUrl", () => {
  it("construit l'URL de la photo à partir du code et de l'id", () => {
    expect(photoUrl("ABCDEF", "the-id")).toBe("/api/lists/ABCDEF/photos/the-id");
  });

  it("encode le code et l'id", () => {
    expect(photoUrl("A B", "i d")).toBe("/api/lists/A%20B/photos/i%20d");
  });
});

describe("uploadItemPhoto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("poste le fichier avec son content-type et renvoie l'id renvoyé par le serveur", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: "new-id" }) });
    vi.stubGlobal("fetch", fetchMock);
    const file = new Blob(["fake-bytes"], { type: "image/png" });

    const id = await uploadItemPhoto("ABCDEF", file);

    expect(id).toBe("new-id");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lists/ABCDEF/photos",
      expect.objectContaining({ method: "POST", headers: { "content-type": "image/png" }, body: file }),
    );
  });

  it("lève une erreur si la réponse n'est pas ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(uploadItemPhoto("ABCDEF", new Blob(["x"], { type: "image/png" }))).rejects.toThrow("Impossible d'envoyer la photo.");
  });
});
