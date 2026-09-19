/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  // The "vitest" test runner (@stryker-mutator/vitest-runner) silently
  // executes far fewer tests per mutant than it should in this project
  // (observed: ~1 test/mutant instead of the full suite, seemingly related
  // to its Vitest "--related" file-graph heuristic not resolving correctly
  // inside Stryker's sandbox), producing a near-zero, meaningless mutation
  // score. The "command" runner (plain `npm test` per mutant) sidesteps
  // that integration entirely and gives correct results, at the cost of
  // one full test-suite spawn per mutant instead of Stryker's smarter
  // per-mutant test selection.
  testRunner: "command",
  commandRunner: {
    command: "npm test",
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
  // Même périmètre que la couverture 100% de vitest.config.ts (voir
  // CLAUDE.md) : shared/ + worker/ + tout src/ (y compris les vues/
  // composants DOM, chacun testé à 100% avec ses collaborateurs mockés).
  // Coûteux avec le runner "command" ci-dessus (toute la suite `npm test`
  // relancée à chaque mutant), mais délibéré : voir la discussion dans la
  // session ayant introduit cette extension.
  mutate: [
    "shared/**/*.ts",
    "worker/**/*.ts",
    "src/**/*.ts",
    "!shared/types.ts",
    "!worker/listRoom.ts",
    "!worker/test/**",
    "!**/*.test.ts",
  ],
  ignorePatterns: ["dist", "coverage", "mutation-report", "playwright-report", "test-results", ".wrangler"],
  // Seuils à recalibrer après une première exécution complète sur ce
  // périmètre élargi (le score de référence de 85.84% ne portait que sur
  // shared/worker/color.ts/sort.ts) — laissés inchangés pour l'instant afin
  // de ne pas fixer un seuil de rupture arbitraire avant d'avoir un score
  // observé sur le nouveau périmètre.
  thresholds: {
    high: 95,
    low: 85,
    break: 80,
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
