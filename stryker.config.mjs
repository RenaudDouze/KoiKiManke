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
  commandRunner: {
    // Relance uniquement les fichiers de test qui couvrent le périmètre
    // muté ci-dessous (`mutate`), pas `npm test` en entier : le reste de la
    // suite (tout src/, notamment les vues DOM comme list.test.ts, ~140
    // tests) ne peut de toute façon pas tuer un mutant placé dans
    // shared/ ou worker/reducer.ts, donc le relancer à chaque mutant ne
    // fait que payer le coût jsdom (~10s) pour rien. Liste figée à la main
    // (plutôt qu'un glob) pour qu'elle reste synchronisée avec `mutate` :
    // ajouter un fichier à `mutate` sans l'ajouter ici ferait survivre tous
    // ses mutants faute de test lancé contre eux.
    command:
      "npx vitest run shared/quantity.test.ts shared/historyKey.test.ts worker/index.test.ts worker/presence.test.ts worker/crypto.test.ts worker/reducer.test.ts src/lib/color.test.ts src/lib/sort.test.ts",
  },
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
  mutate: [
    "shared/**/*.ts",
    "worker/**/*.ts",
    "src/lib/color.ts",
    "src/lib/sort.ts",
    "!shared/types.ts",
    "!worker/listRoom.ts",
    "!worker/test/**",
    "!**/*.test.ts",
  ],
  ignorePatterns: ["dist", "coverage", "mutation-report", "playwright-report", "test-results", ".wrangler"],
  thresholds: {
    high: 95,
    low: 85,
    break: 80,
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
