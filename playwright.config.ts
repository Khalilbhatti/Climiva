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
// Custom domains: the test server answers DNS questions from files the tests write (one per name), so no test depends on the internet. The
// canonical scheme is http because the tests are served over http, and a routing target is set so the instructions can be checked.
process.env.DOMAIN_DNS_RESOLVER = "fixture";
process.env.DOMAIN_DNS_FIXTURE_DIR = resolve(process.env.TEST_DNS_DIR ?? join(".data", "dns-test"));
process.env.CUSTOM_DOMAIN_URL_SCHEME = "http";
process.env.CUSTOM_DOMAIN_TARGET = "sites.climvia.com";
// A deployment that answers on a domain of its own besides the host of BETTER_AUTH_URL: the specs of the host rules use the product's own as the example.
// A deployment on one host lists none (the Docker suite runs that way), and the specs of the rules cover it.
process.env.APP_HOSTS = "climvia.com";
// The certificate-authorization endpoint (/internal/tls-allow) answers only a caller that holds this secret; the specs that ask it read it from here.
process.env.TLS_ASK_TOKEN = "test-tls-ask-token-0123456789abcdef0123456789abcdef";

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
