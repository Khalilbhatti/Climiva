import { defineConfig } from "playwright/test";

/**
 * The Docker-side tests: a real browser and real requests against the PRODUCTION-SHAPED STACK (docker-compose.production.yml: Caddy, the web app
 * image, PostgreSQL) started from an env file, not against `next start` on the host. They are a separate suite on purpose: `npm run test:e2e`
 * needs no Docker, and these need it, an image built from the working tree and a running stack.
 *
 *   docker compose -f docker-compose.production.yml --env-file .env.trial up -d --build --wait
 *   npm run test:docker
 *
 * The stack's name and ports come from the env file (DOCKER_ENV_FILE, default .env.trial, git-ignored): PUBLIC_HOST, HTTPS_PORT, COMPOSE_PROJECT_NAME.
 * Local certificates come from Caddy's own CA (CADDY_MODE_FILE=./deploy/caddy/mode.local.caddy), so the browser ignores certificate errors and is
 * told where the test names are. NOTHING here asks a public certificate authority for anything.
 *
 * The tests run in one file, in order, on one worker: they build on each other (the first person signs up, then the business grows) and on a
 * database that starts EMPTY. Run them against a stack whose database is new (`down -v` first), or the "empty production database" test fails by design.
 */
import { dockerStack } from "./e2e-docker/stack";

const stack = dockerStack();
// The shared helpers in e2e/ build their addresses from this.
process.env.BETTER_AUTH_URL = stack.origin;

export default defineConfig({
  testDir: "./e2e-docker",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: stack.origin,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: [`--host-resolver-rules=MAP *.${stack.domain} 127.0.0.1, MAP ${stack.publicHost} 127.0.0.1, MAP *.example.test 127.0.0.1`] },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
