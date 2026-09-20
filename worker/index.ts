import { ListRoom } from "./listRoom";
import { generatePhotoId, photoObjectKey } from "./photos";
import { isAllowedPhotoType, MAX_PHOTO_BYTES } from "../shared/photo";

export { ListRoom };

interface Env {
  LIST_ROOM: DurableObjectNamespace<ListRoom>;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
}

// Ambiguous characters (0/O, 1/I) are excluded so codes are easy to read aloud
// or copy from a screen.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return out;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

// Autorise l'appel depuis une origine différente (client servi par GitHub
// Pages, Worker sur un domaine *.workers.dev distinct) : sans ces en-têtes,
// le navigateur bloquerait les requêtes JSON avant même qu'elles partent.
// Sans objet pour la connexion WebSocket (jamais soumise au CORS/preflight
// par les navigateurs), donc pas ajoutés sur cette route.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

async function jsonPassthrough(res: Response): Promise<Response> {
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/lists" && request.method === "POST") {
      const body = await request.json<{ name?: string }>().catch(() => ({}) as { name?: string });

      let code = generateCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const stub = env.LIST_ROOM.get(env.LIST_ROOM.idFromName(code));
        const existing = await stub.fetch("https://list.internal/state");
        if (existing.status === 404) break;
        code = generateCode();
      }

      const stub = env.LIST_ROOM.get(env.LIST_ROOM.idFromName(code));
      const res = await stub.fetch("https://list.internal/init", {
        method: "POST",
        body: JSON.stringify({ code, name: body.name }),
        headers: { "content-type": "application/json" },
      });
      return jsonPassthrough(res);
    }

    const listMatch = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{4,10})(\/ws)?$/);
    if (listMatch) {
      const code = normalizeCode(listMatch[1]);
      const isWs = Boolean(listMatch[2]);
      const stub = env.LIST_ROOM.get(env.LIST_ROOM.idFromName(code));

      if (isWs) {
        // Forward the original request untouched: the WebSocket upgrade
        // handshake relies on headers the runtime attaches internally.
        return stub.fetch(request);
      }

      if (request.method === "GET") {
        const res = await stub.fetch("https://list.internal/state");
        return jsonPassthrough(res);
      }
    }

    // Upload de la photo d'un article : stocké dans le bucket R2 dédié
    // (jamais dans le ListState lui-même, voir shared/photo.ts) — le Worker
    // écrit/lit directement le bucket, sans passer par le Durable Object
    // (dont le rôle se limite à l'état synchronisé en temps réel), mais
    // vérifie d'abord que la liste existe pour ne pas servir de stockage de
    // fichiers anonyme sans rapport avec une liste réelle.
    const photoUploadMatch = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{4,10})\/photos$/);
    if (photoUploadMatch && request.method === "POST") {
      const code = normalizeCode(photoUploadMatch[1]);
      const stub = env.LIST_ROOM.get(env.LIST_ROOM.idFromName(code));
      const existing = await stub.fetch("https://list.internal/state");
      if (existing.status === 404) return new Response("Liste introuvable.", { status: 404, headers: CORS_HEADERS });

      const contentType = request.headers.get("content-type");
      if (!isAllowedPhotoType(contentType)) {
        return new Response("Type de fichier non pris en charge.", { status: 415, headers: CORS_HEADERS });
      }
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) {
        return new Response("Photo trop volumineuse.", { status: 413, headers: CORS_HEADERS });
      }
      const id = generatePhotoId();
      await env.PHOTOS.put(photoObjectKey(code, id), bytes, { httpMetadata: { contentType: contentType! } });
      return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json", ...CORS_HEADERS } });
    }

    const photoMatch = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{4,10})\/photos\/([A-Za-z0-9_-]{1,64})$/);
    if (photoMatch && request.method === "GET") {
      const code = normalizeCode(photoMatch[1]);
      const object = await env.PHOTOS.get(photoObjectKey(code, photoMatch[2]));
      if (!object) return new Response("Photo introuvable.", { status: 404, headers: CORS_HEADERS });
      return new Response(object.body, {
        status: 200,
        headers: {
          "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
          // Remplacer une photo en pose toujours une nouvelle sous un nouvel
          // id plutôt que de muter l'objet existant (voir photoId dans
          // worker/reducer.ts) : un cache long et immuable est donc sûr.
          "cache-control": "public, max-age=31536000, immutable",
          ...CORS_HEADERS,
        },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
