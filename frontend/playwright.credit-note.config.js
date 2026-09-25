import { defineConfig } from "@playwright/test";
export default defineConfig({
 testDir: "./e2e", testMatch: "credit-note.spec.js", workers: 1,
 use: { baseURL: "http://localhost:5193", launchOptions: process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {} },
 webServer: { command: "npm run dev -- --host 127.0.0.1 --port 5193", url: "http://localhost:5193", reuseExistingServer: true },
});
