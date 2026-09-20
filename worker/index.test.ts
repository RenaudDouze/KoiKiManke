import { describe, it, expect, vi } from "vitest";
import worker from "./index";

type Env = Parameters<typeof worker.fetch>[1];
type IncomingRequest = Parameters<typeof worker.fetch>[0];
type FetchArg = string | Request;
type FakeHandler = (code: string, input: FetchArg, init?: RequestInit) => Promise<Response> | Response;

// workers-types' fetch handler expects `Request<CfProperties>` (incoming,
// with Cloudflare-specific fields like `colo`), while `req(...)`
// produces a plain outgoing `Request` — incompatible types for the same
// runtime object. This helper bridges the two for tests.
function req(url: string, init?: RequestInit): IncomingRequest {
  return new Request(url, init) as unknown as IncomingRequest;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function makeListRoomNamespace(handler: FakeHandler): Env["LIST_ROOM"] {
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: (input: FetchArg, init?: RequestInit) => handler(id, input, init),
    }),
    // Unused by worker/index.ts but part of the real binding's shape.
    idFromString: (id: string) => id,
    newUniqueId: () => "unique",
    jurisdiction: () => namespace,
  };
  return namespace as unknown as Env["LIST_ROOM"];
}

function pathOf(input: FetchArg): string {
  return new URL(typeof input === "string" ? input : input.url).pathname;
}

// Assez du binding R2 réel pour exercer les routes /photos : un Map en
// mémoire indexée par clé d'objet, avec juste ce que worker/index.ts lit
// (body/httpMetadata.contentType) ou écrit (put).
function makeR2Bucket(initial: Record<string, { body: string; contentType: string }> = {}): Env["PHOTOS"] {
  const store = new Map(Object.entries(initial));
  return {
    put: vi.fn(async (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
      const text = new TextDecoder().decode(value);
      store.set(key, { body: text, contentType: options?.httpMetadata?.contentType ?? "" });
    }),
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        body: new Response(entry.body).body,
        httpMetadata: { contentType: entry.contentType },
      };
    }),
  } as unknown as Env["PHOTOS"];
}

function makeEnv(
  listRoomHandler: FakeHandler,
  assetsFetch?: (request: Request) => Promise<Response> | Response,
  photos?: Env["PHOTOS"],
): Env {
  return {
    LIST_ROOM: makeListRoomNamespace(listRoomHandler),
    PHOTOS: photos ?? makeR2Bucket(),
    ASSETS: { fetch: assetsFetch ?? (() => new Response("asset", { status: 200 })) },
  } as unknown as Env;
}

function listExistsHandler(): FakeHandler {
  return (_code, input) =>
    pathOf(input) === "/state"
      ? Response.json({ code: "ABCDEF", name: "Courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 })
      : new Response("unused", { status: 200 });
}

describe("POST /api/lists (création)", () => {
  it("crée une liste et renvoie son état JSON", async () => {
    const handler: FakeHandler = (code, input) => {
      if (pathOf(input) === "/state") return new Response("not found", { status: 404 });
      if (pathOf(input) === "/init") {
        return Response.json({ code, name: "Ma liste", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 });
      }
      throw new Error(`unexpected path ${pathOf(input)}`);
    };
    const env = makeEnv(handler);
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST", body: JSON.stringify({ name: "Ma liste" }) }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await readJson(res);
    expect(body.name).toBe("Ma liste");
  });

  it("tolère un corps de requête absent ou invalide", async () => {
    const handler: FakeHandler = (code, input) => {
      if (pathOf(input) === "/state") return new Response("not found", { status: 404 });
      return Response.json({ code, name: "Liste de courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 });
    };
    const env = makeEnv(handler);
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), env);
    expect(res.status).toBe(200);
  });

  it("régénère un code tant que le précédent est déjà pris, jusqu'à 5 essais", async () => {
    let stateChecks = 0;
    const handler: FakeHandler = (code, input) => {
      if (pathOf(input) === "/state") {
        stateChecks += 1;
        // Toujours "pris" : force la boucle de retry à aller au bout.
        return new Response("taken", { status: 200 });
      }
      return Response.json({ code, name: "Liste de courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 });
    };
    const env = makeEnv(handler);
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), env);
    expect(stateChecks).toBe(5);
    // Malgré 5 collisions, on appelle quand même /init avec le dernier code généré.
    expect(res.status).toBe(200);
  });

  it("s'arrête au premier code libre (404 sur /state)", async () => {
    let stateChecks = 0;
    const handler: FakeHandler = (code, input) => {
      if (pathOf(input) === "/state") {
        stateChecks += 1;
        return stateChecks === 1 ? new Response("taken", { status: 200 }) : new Response("not found", { status: 404 });
      }
      return Response.json({ code, name: "Liste de courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 });
    };
    const env = makeEnv(handler);
    await worker.fetch(req("https://app.example/api/lists", { method: "POST" }), env);
    expect(stateChecks).toBe(2);
  });
});

describe("GET /api/lists/:code", () => {
  it("renvoie l'état d'une liste existante", async () => {
    const handler: FakeHandler = () =>
      Response.json({ code: "ABCDEF", name: "Courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 });
    const env = makeEnv(handler);
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef"), env);
    expect(res.status).toBe(200);
    expect((await readJson(res)).name).toBe("Courses");
  });

  it("uppercase le code avant de router vers le Durable Object", async () => {
    const received: string[] = [];
    const handler: FakeHandler = (code) => {
      received.push(code);
      return Response.json({ code, name: "x", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 });
    };
    const env = makeEnv(handler);
    await worker.fetch(req("https://app.example/api/lists/abcdef"), env);
    expect(received).toEqual(["ABCDEF"]);
  });

  it("renvoie 404 pour un code inconnu", async () => {
    const handler: FakeHandler = () => new Response("not found", { status: 404 });
    const env = makeEnv(handler);
    const res = await worker.fetch(req("https://app.example/api/lists/ZZZZZZ"), env);
    expect(res.status).toBe(404);
  });

  it("renvoie 404 pour une méthode non gérée sur ce chemin (ex: DELETE)", async () => {
    const env = makeEnv(() => {
      throw new Error("le Durable Object ne devrait pas être appelé");
    });
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef", { method: "DELETE" }), env);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/lists/:code/ws", () => {
  it("transmet la requête d'origine telle quelle au Durable Object", async () => {
    // A real 101 (WebSocket upgrade) response can only be constructed by the
    // Workers runtime itself — Node's Response constructor rejects it. That
    // actual upgrade handshake is exercised by the Playwright e2e suite
    // against a live `vite dev` instance instead; this test only checks that
    // the router forwards the exact same request object untouched.
    let receivedInput: FetchArg | null = null;
    const handler: FakeHandler = (_code, input) => {
      receivedInput = input;
      return new Response(null, { status: 200 });
    };
    const env = makeEnv(handler);
    const request = req("https://app.example/api/lists/abcdef/ws", { headers: { Upgrade: "websocket" } });
    const res = await worker.fetch(request, env);
    expect(res.status).toBe(200);
    expect(receivedInput).toBe(request);
  });
});

describe("CORS (client cross-origine, ex: GitHub Pages)", () => {
  it("répond au préflight OPTIONS sur /api/* sans toucher le Durable Object", async () => {
    const env = makeEnv(() => {
      throw new Error("le Durable Object ne devrait pas être appelé");
    });
    const res = await worker.fetch(req("https://app.example/api/lists", { method: "OPTIONS" }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("ajoute les en-têtes CORS aux réponses JSON de l'API", async () => {
    const handler: FakeHandler = () =>
      Response.json({ code: "ABCDEF", name: "Courses", items: [], categories: [], history: [], createdAt: 0, updatedAt: 0 });
    const env = makeEnv(handler);
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef"), env);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("ajoute les en-têtes CORS au 404 générique de l'API", async () => {
    const env = makeEnv(() => new Response("not found", { status: 404 }));
    const res = await worker.fetch(req("https://app.example/api/nope"), env);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("POST /api/lists/:code/photos (upload)", () => {
  it("stocke la photo dans R2 et renvoie son id", async () => {
    const photos = makeR2Bucket();
    const env = makeEnv(listExistsHandler(), undefined, photos);
    const res = await worker.fetch(
      req("https://app.example/api/lists/abcdef/photos", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([1, 2, 3]),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(typeof body.id).toBe("string");
    expect(photos.put).toHaveBeenCalledWith(
      `ABCDEF/${body.id}`,
      expect.anything(),
      expect.objectContaining({ httpMetadata: { contentType: "image/png" } }),
    );
  });

  it("renvoie 404 si la liste n'existe pas", async () => {
    const handler: FakeHandler = () => new Response("not found", { status: 404 });
    const env = makeEnv(handler);
    const res = await worker.fetch(
      req("https://app.example/api/lists/abcdef/photos", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([1]) }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("renvoie 415 pour un type MIME non autorisé", async () => {
    const env = makeEnv(listExistsHandler());
    const res = await worker.fetch(
      req("https://app.example/api/lists/abcdef/photos", {
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: new Uint8Array([1]),
      }),
      env,
    );
    expect(res.status).toBe(415);
  });

  it("renvoie 413 pour un corps vide", async () => {
    const env = makeEnv(listExistsHandler());
    const res = await worker.fetch(
      req("https://app.example/api/lists/abcdef/photos", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([]) }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it("renvoie 413 au-delà de la taille maximale autorisée", async () => {
    const env = makeEnv(listExistsHandler());
    const res = await worker.fetch(
      req("https://app.example/api/lists/abcdef/photos", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(9 * 1024 * 1024),
      }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it("ajoute les en-têtes CORS à la réponse", async () => {
    const env = makeEnv(listExistsHandler());
    const res = await worker.fetch(
      req("https://app.example/api/lists/abcdef/photos", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([1]) }),
      env,
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("GET /api/lists/:code/photos/:photoId (lecture)", () => {
  it("renvoie les octets stockés avec leur content-type", async () => {
    const photos = makeR2Bucket({ "ABCDEF/photo1": { body: "fake-bytes", contentType: "image/webp" } });
    const env = makeEnv(() => new Response("unused"), undefined, photos);
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef/photos/photo1"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(await res.text()).toBe("fake-bytes");
  });

  it("pose un cache-control long et immuable", async () => {
    const photos = makeR2Bucket({ "ABCDEF/photo1": { body: "x", contentType: "image/png" } });
    const env = makeEnv(() => new Response("unused"), undefined, photos);
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef/photos/photo1"), env);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("retombe sur application/octet-stream si l'objet n'a pas de content-type stocké", async () => {
    const photos = {
      get: vi.fn(async () => ({ body: new Response("x").body, httpMetadata: undefined })),
    } as unknown as Env["PHOTOS"];
    const env = makeEnv(() => new Response("unused"), undefined, photos);
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef/photos/photo1"), env);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("renvoie 404 si l'objet n'existe pas dans R2", async () => {
    const env = makeEnv(() => new Response("unused"));
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef/photos/ghost"), env);
    expect(res.status).toBe(404);
  });

  it("ajoute les en-têtes CORS à la réponse", async () => {
    const photos = makeR2Bucket({ "ABCDEF/photo1": { body: "x", contentType: "image/png" } });
    const env = makeEnv(() => new Response("unused"), undefined, photos);
    const res = await worker.fetch(req("https://app.example/api/lists/abcdef/photos/photo1"), env);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("routes non gérées", () => {
  it("renvoie 404 pour un chemin /api/* inconnu", async () => {
    const env = makeEnv(() => new Response("not found", { status: 404 }));
    const res = await worker.fetch(req("https://app.example/api/nope"), env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("délègue tout le reste aux assets statiques", async () => {
    const assetsFetch = vi.fn((request: Request) => new Response(`served:${new URL(request.url).pathname}`));
    const env = makeEnv(() => new Response("unused"), assetsFetch);
    const request = req("https://app.example/l/ABCDEF");
    const res = await worker.fetch(request, env);
    expect(assetsFetch).toHaveBeenCalledWith(request);
    expect(await res.text()).toBe("served:/l/ABCDEF");
  });
});
