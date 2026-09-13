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
  // Same "pure logic" scope as vitest.config.ts's 100% coverage threshold
  // (see CLAUDE.md) — DOM-heavy view/component code is exercised by the
  // Playwright e2e suite instead, not meaningfully mutation-testable here.
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
  // Baseline observed on this scope: 85.84%. `break` sits a bit below it so
  // routine, honest gaps (equivalent mutants, thin edge cases) don't flake
  // the build, while a real regression in test quality still fails CI.
  thresholds: {
    high: 95,
    low: 85,
    break: 80,
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
