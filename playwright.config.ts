import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// This sandbox pre-installs Chromium outside Playwright's own cache; CI
// installs its own via `playwright install --with-deps chromium`, so only
// override the executable when the local one is actually present.
const localChromium = "/opt/pw-browsers/chromium";
const executablePath = existsSync(localChromium) ? localChromium : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    // 60s was too tight on GitHub Actions' shared runners: cold `npm run
    // dev` (Vite + the Cloudflare Worker environment via workerd) reliably
    // took longer there than on a local machine, failing every run with
    // "Timed out waiting ... from config.webServer" regardless of what the
    // PR actually changed (confirmed: reproduced identically on plain
    // GitHub Actions version bumps, and locally the same command starts
    // well under 60s).
    timeout: 120_000,
    // TEMPORARY diagnostics: Playwright hides the dev server's stdout by
    // default (only stderr is shown), so the CI-only timeout above gave us
    // zero insight into what `npm run dev` was actually doing while it
    // hung. Force both streams to the job log to find out.
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});
