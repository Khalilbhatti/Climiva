import { defineConfig } from "playwright/test";

const PORT = 3460;

/**
 * Browser tests run against a production build, the same thing that ships.
 * `npm run test:e2e` builds, starts the server on PORT, runs the specs and stops it.
 * The Playwright browser (chromium) must be installed: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },
});
