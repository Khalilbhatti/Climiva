import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig } from "playwright/test";

// The tests need the same secrets the app does (the database, Better Auth). Node reads `.env` itself.
if (existsSync(".env")) process.loadEnvFile(".env");

const PORT = 3460;
const ORIGIN = `http://localhost:${PORT}`;
/** The suite runs against its own database, recreated, migrated and seeded from nothing on every run (db:test:prepare). */
const TEST_DATABASE = process.env.TEST_DATABASE_NAME ?? "climvia_test";

function inTestDatabase(variable: string): string {
  const value = process.env[variable];
  if (!value) throw new Error(`${variable} is not set. Copy .env.example to .env and fill it in.`);
  const url = new URL(value);
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
}

// Point the app server AND the test workers at the test database, never at the development one.
process.env.DATABASE_URL = inTestDatabase("DATABASE_URL");
process.env.DATABASE_ADMIN_URL = inTestDatabase("DATABASE_ADMIN_URL");
process.env.BETTER_AUTH_URL = ORIGIN;
// Uploaded files go to a directory of the suite's own (recreated with the database by db:test:prepare, which uses the same one), never the
// development one. The server and the workers must agree on it, so it is absolute and set here once.
process.env.ASSET_STORAGE_DRIVER = "local";
process.env.ASSET_LOCAL_DIR = resolve(process.env.TEST_ASSET_DIR ?? join(".data", "assets-test"));

/**
 * Browser tests run against a production build, the same thing that ships.
 * `npm run test:e2e` prepares the test database, builds, starts the server on PORT, runs the specs and stops it.
 * The Playwright browser (chromium) must be installed: `npx playwright install chromium`, and PostgreSQL must be
 * reachable at the address in `.env` (`docker compose up -d`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: ORIGIN,
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npm run db:test:prepare && npm run build && npm run start -- -p ${PORT}`,
    url: `${ORIGIN}/login`,
    timeout: 360_000,
    reuseExistingServer: !process.env.CI,
  },
});
