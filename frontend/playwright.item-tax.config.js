import { defineConfig } from "@playwright/test";
export default defineConfig({
 testDir: "./e2e", testMatch: "item-tax.spec.js", workers: 1,
 use: { baseURL: "http://localhost:5194", launchOptions: process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {} },
 webServer: { command: "npm run dev -- --host 127.0.0.1 --port 5194", url: "http://localhost:5194", reuseExistingServer: true },
});
