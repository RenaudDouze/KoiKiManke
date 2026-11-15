// Chaque module est associé aux seuls fichiers de test capables de tuer ses
// mutants : la CI lance un job par module (variable MUTATE, voir
// .github/scripts/mutation-matrix.mjs) et le runner « command » ne relance que
// ces tests-là pour chaque mutant, au lieu de toute la liste.
export const targets = {
  'shared/quantity.ts': ['shared/quantity.test.ts'],
  'shared/historyKey.ts': ['shared/historyKey.test.ts'],
  'shared/photo.ts': ['shared/photo.test.ts'],
  'worker/index.ts': ['worker/index.test.ts'],
  'worker/presence.ts': ['worker/presence.test.ts'],
  'worker/crypto.ts': ['worker/crypto.test.ts'],
  'worker/reducer.ts': ['worker/reducer.test.ts'],
  'worker/photos.ts': ['worker/photos.test.ts'],
  'src/lib/color.ts': ['src/lib/color.test.ts'],
  'src/lib/sort.ts': ['src/lib/sort.test.ts'],
  'src/lib/compactShare.ts': ['src/lib/compactShare.test.ts'],
  'src/lib/accessibilityPreference.ts': ['src/lib/accessibilityPreference.test.ts'],
  'src/lib/basePath.ts': ['src/lib/basePath.test.ts'],
  'src/lib/confirmClick.ts': ['src/lib/confirmClick.test.ts'],
  'src/lib/dnd.ts': ['src/lib/dnd.test.ts'],
  'src/lib/dom.ts': ['src/lib/dom.test.ts'],
  'src/lib/editable.ts': ['src/lib/editable.test.ts'],
  'src/lib/focusTrap.ts': ['src/lib/focusTrap.test.ts'],
  'src/lib/hideCheckedPreference.ts': ['src/lib/hideCheckedPreference.test.ts'],
  'src/lib/http.ts': ['src/lib/http.test.ts'],
  'src/lib/icons.ts': ['src/lib/icons.test.ts'],
  'src/lib/id.ts': ['src/lib/id.test.ts'],
  'src/lib/importExport.ts': ['src/lib/importExport.test.ts'],
  'src/lib/itemSortPreference.ts': ['src/lib/itemSortPreference.test.ts'],
  'src/lib/keyboardInset.ts': ['src/lib/keyboardInset.test.ts'],
  'src/lib/notifications.ts': ['src/lib/notifications.test.ts'],
  'src/lib/presence.ts': ['src/lib/presence.test.ts'],
  'src/lib/privacyHint.ts': ['src/lib/privacyHint.test.ts'],
  'src/lib/storage.ts': ['src/lib/storage.test.ts'],
  'src/lib/swipe.ts': ['src/lib/swipe.test.ts'],
  'src/lib/syncWorker.ts': ['src/lib/syncWorker.test.ts'],
  'src/lib/theme.ts': ['src/lib/theme.test.ts'],
  'src/lib/ws.ts': ['src/lib/ws.test.ts'],
  'src/components/accessibilityModal.ts': ['src/components/accessibilityModal.test.ts'],
  'src/components/qr.ts': ['src/components/qr.test.ts'],
  'src/components/shareModal.ts': ['src/components/shareModal.test.ts'],
  'src/main.ts': ['src/main.test.ts'],
  'src/views/home.ts': ['src/views/home.test.ts'],
  'src/views/list.ts:1-150': ['src/views/list.test.ts'],
  'src/views/list.ts:151-300': ['src/views/list.test.ts'],
  'src/views/list.ts:301-450': ['src/views/list.test.ts'],
  'src/views/list.ts:451-600': ['src/views/list.test.ts'],
  'src/views/list.ts:601-750': ['src/views/list.test.ts'],
  'src/views/list.ts:751-900': ['src/views/list.test.ts'],
  'src/views/list.ts:901-1050': ['src/views/list.test.ts'],
  'src/views/list.ts:1051-1200': ['src/views/list.test.ts'],
  'src/views/list.ts:1201-1350': ['src/views/list.test.ts'],
  'src/views/list.ts:1351-1405': ['src/views/list.test.ts'],
};

const selected = process.env.MUTATE ? process.env.MUTATE.split(',') : Object.keys(targets);
for (const file of selected) {
  if (!targets[file]) throw new Error(`MUTATE : module inconnu ${file}`);
}
const tests = [...new Set(selected.flatMap((file) => targets[file]))];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  // The "vitest" test runner (@stryker-mutator/vitest-runner) silently
  // executes far fewer tests per mutant than it should in this project
  // (observed: ~1 test/mutant instead of the full suite, seemingly related
  // to its Vitest "--related" file-graph heuristic not resolving correctly
  // inside Stryker's sandbox), producing a near-zero, meaningless mutation
  // score. The "command" runner (a fixed `vitest run` invocation per
  // mutant) sidesteps that integration entirely and gives correct results.
  testRunner: "command",
  commandRunner: { command: `npx vitest run ${tests.join(' ')}` },
  coverageAnalysis: "off",
  // Stryker's tsconfig-rewriting preprocessor (needed to relax the sandbox's
  // tsconfig) calls a TypeScript API removed in TypeScript 7
  // (`ts.parseConfigFileTextToJson`), crashing on startup. Pointing it at a
  // file that doesn't exist makes it a no-op — harmless here since the
  // command runner never needs Stryker's own type-checking pass.
  tsconfigFile: "tsconfig.stryker-unused.json",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: {
    fileName: "mutation-report/index.html",
  },
  // Périmètre : tout le code testé de shared/, worker/ et src/, y compris les
  // vues DOM (jsdom). Exclus, comme de la couverture (vitest.config.ts) :
  // shared/types.ts (types seuls) et worker/listRoom.ts (couche Durable
  // Object, couverte par les tests e2e). `src/views/list.ts` est découpé en
  // plages de lignes (`fichier:début-fin`), un job de CI chacune : un seul
  // job durerait plus de 15 minutes. La liste de fichiers du `commandRunner`
  // ci-dessus vient de `targets`, donc reste synchronisée.
  mutate: selected,
  ignorePatterns: ["dist", "coverage", "mutation-report", "playwright-report", "test-results", ".wrangler"],
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
