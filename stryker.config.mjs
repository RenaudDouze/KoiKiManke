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
  // Périmètre volontairement plus restreint que la couverture 100% de
  // vitest.config.ts (qui, elle, couvre tout le dépôt y compris les vues
  // DOM) : seulement la logique pure, là où un test unitaire ciblé et
  // rapide existe déjà pour tuer chaque mutant (voir `commandRunner`
  // ci-dessus, dont la liste de fichiers doit rester synchronisée avec
  // celle-ci). Un temps passé à étendre ce périmètre à tout src/ (comme
  // OnMangeQuoi ne le fait pas non plus, pour la même raison) a montré en
  // pratique ~2937 mutants et ~3h30 de CI par PR avec le runner "command"
  // (qui relance une commande complète par mutant, sans sélection de tests
  // fine) : un coût jugé disproportionné une fois observé, revenu en
  // arrière au profit de ce périmètre plus restreint mais rapide (~2s par
  // mutant plutôt que ~15-20s).
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
