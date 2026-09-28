import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:"./e2e",testMatch:"public-brand.spec.js",workers:1,use:{baseURL:"http://localhost:5197",launchOptions:{executablePath:process.env.CHROME_EXECUTABLE}},webServer:{command:"npm run dev -- --host 127.0.0.1 --port 5197",url:"http://localhost:5197",reuseExistingServer:true}});
