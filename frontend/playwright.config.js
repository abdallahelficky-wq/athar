import { defineConfig } from "@playwright/test";

// Chromium is pre-installed at this fixed path in CI/sandbox images that don't have internet
// access to download browsers; explicit executablePath keeps the config working regardless of
// which @playwright/test version is pinned (its own bundled browser build may not match).
const CHROMIUM_PATH = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:5173",
    launchOptions: { executablePath: CHROMIUM_PATH },
  },
  // Reuses whatever dev servers are already running locally (the normal workflow for this
  // project) — only starts fresh ones when nothing is listening on these ports yet.
  webServer: [
    {
      command: "npm run dev",
      cwd: "..",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev",
      cwd: ".",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
