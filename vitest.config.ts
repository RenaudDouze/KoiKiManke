import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // See worker/test/cloudflareWorkersShim.ts.
      "cloudflare:workers": path.resolve(import.meta.dirname, "worker/test/cloudflareWorkersShim.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["shared/**/*.test.ts", "worker/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // src/ est couvert au fur et à mesure (fichier par fichier, en PR
      // séparées) plutôt qu'en un seul glob src/**/*.ts : chaque nouveau
      // fichier n'est ajouté ici qu'une fois ses tests écrits, pour ne
      // jamais faire passer le seuil 100% sous zéro entre deux PR.
      include: [
        "shared/**/*.ts",
        "worker/**/*.ts",
        "src/main.ts",
        "src/views/home.ts",
        "src/views/list.ts",
        "src/lib/color.ts",
        "src/lib/sort.ts",
        "src/lib/id.ts",
        "src/lib/dom.ts",
        "src/lib/privacyHint.ts",
        "src/lib/syncWorker.ts",
        "src/lib/basePath.ts",
        "src/lib/http.ts",
        "src/lib/icons.ts",
        "src/components/qr.ts",
        "src/components/shareModal.ts",
        "src/lib/theme.ts",
        "src/lib/accessibilityPreference.ts",
        "src/lib/itemSortPreference.ts",
        "src/lib/hideCheckedPreference.ts",
        "src/lib/notifications.ts",
        "src/lib/editable.ts",
        "src/lib/focusTrap.ts",
        "src/lib/confirmClick.ts",
        "src/lib/presence.ts",
        "src/lib/storage.ts",
        "src/lib/importExport.ts",
        "src/lib/compactShare.ts",
        "src/lib/dnd.ts",
        "src/lib/swipe.ts",
        "src/lib/ws.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "worker/test/**",
        // Type-only file (interfaces + one trivial re-exported constant),
        // nothing meaningful to unit-test.
        "shared/types.ts",
        // The Durable Object's own glue (storage, WebSocket hibernation) —
        // deliberately not unit-tested (would need a real Workers runtime
        // to be meaningful); exercised instead by the Playwright e2e suite
        // against a live `vite dev` instance. All of its actual logic lives
        // in reducer.ts, which is fully unit-tested.
        "worker/listRoom.ts",
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
