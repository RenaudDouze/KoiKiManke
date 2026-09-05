import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    cloudflare(),
    // VitePWA isn't aware of @cloudflare/vite-plugin's separate worker
    // build environment, so it also drops registerSW.js/manifest.webmanifest
    // next to the compiled Worker script (dist/<name>/) in addition to
    // dist/client/ where they belong. Harmless: wrangler deploy only reads
    // index.js (the `main` field) and the dist/client assets directory from
    // that folder, never those two stray files, and neither ends up bundled
    // inside index.js itself (verified after every dependency bump).
    VitePWA({
      registerType: "autoUpdate",
      // Sert le manifest/service worker uniquement pour le build du client :
      // le plugin Cloudflare gère un environment "worker" séparé que VitePWA
      // ne doit pas toucher.
      manifest: {
        name: "Notre Liste de Courses",
        short_name: "Courses",
        description: "Liste de courses partagée, synchronisée en temps réel.",
        lang: "fr",
        start_url: "/",
        display: "standalone",
        background_color: "#f4f6f3",
        theme_color: "#1f8a53",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // L'app est une SPA à une seule route ; le reste (API, WebSocket)
        // ne doit jamais être servi depuis le cache.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
