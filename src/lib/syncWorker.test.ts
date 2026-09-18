// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("syncWorker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("sans VITE_SYNC_WORKER_URL (déploiement mono-origine)", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_SYNC_WORKER_URL", "");
    });

    it("apiUrl laisse le chemin relatif", async () => {
      const { apiUrl } = await import("./syncWorker");
      expect(apiUrl("/api/lists")).toBe("/api/lists");
    });

    it("wsUrl construit une URL websocket relative à partir de location", async () => {
      const { wsUrl } = await import("./syncWorker");
      expect(wsUrl("/ws")).toBe(`ws://${location.host}/ws`);
    });

    it("wsUrl utilise wss quand la page est servie en https", async () => {
      vi.stubGlobal("location", { protocol: "https:", host: "koikimanke.example" });
      const { wsUrl } = await import("./syncWorker");
      expect(wsUrl("/ws")).toBe("wss://koikimanke.example/ws");
      vi.unstubAllGlobals();
    });
  });

  describe("avec VITE_SYNC_WORKER_URL (déploiement GitHub Pages)", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_SYNC_WORKER_URL", "https://koikimanke.example.workers.dev/");
    });

    it("apiUrl préfixe le chemin par l'URL du Worker (slash final retiré)", async () => {
      const { apiUrl } = await import("./syncWorker");
      expect(apiUrl("/api/lists")).toBe("https://koikimanke.example.workers.dev/api/lists");
    });

    it("wsUrl convertit https en wss", async () => {
      const { wsUrl } = await import("./syncWorker");
      expect(wsUrl("/ws")).toBe("wss://koikimanke.example.workers.dev/ws");
    });
  });
});
