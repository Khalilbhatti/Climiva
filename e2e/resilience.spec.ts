/**
 * No silent fallback. When something the workspace depends on fails, the person sees an honest error or Log in, never the
 * sample business's records standing in for the real thing. This starts a second copy of the production server
 * (port 3458, this project's own) whose database address points nowhere.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { CUSTOMERS } from "../src/data/customers";
import { business } from "../src/data/fixtures";
import { expect, NOT_SIGNED_IN, test, waitsForHydration } from "./saas";

const PORT = 3458;
const ORIGIN = `http://localhost:${PORT}`;
const SAMPLE = [business.name, business.phone, ...CUSTOMERS.map((customer) => customer.name)];

let server: ChildProcess | undefined;

async function isUp() {
  try {
    return (await fetch(`${ORIGIN}/login`)).status === 200;
  } catch {
    return false;
  }
}

test.describe("the database is unreachable", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    server = spawn("npx", ["next", "start", "-p", String(PORT)], {
      shell: true,
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL: "postgres://climvia_app:not-the-password@127.0.0.1:1/climvia_test", BETTER_AUTH_URL: ORIGIN },
    });
    for (let attempt = 0; attempt < 90 && !(await isUp()); attempt++) await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await isUp(), "the second server started").toBe(true);
  });

  test.afterAll(() => {
    if (!server?.pid) return;
    // Only the process this spec started, and its children.
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
  });

  test("a signed-in visitor gets an error page, never the sample business", async ({ browser, workerTenant }) => {
    const context = await browser.newContext({ storageState: workerTenant.storageState, baseURL: ORIGIN });
    const page = waitsForHydration(await context.newPage());
    const response = await page.goto("/customers");
    expect(response?.status()).toBe(500);
    const html = await page.content();
    for (const value of SAMPLE) expect(html, value).not.toContain(value);
    await expect(page.getByRole("heading", { name: "We couldn't load Climvia" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await context.close();
  });

  test("the same on the customer-facing previews and on an unknown address", async ({ browser, workerTenant }) => {
    const context = await browser.newContext({ storageState: workerTenant.storageState, baseURL: ORIGIN });
    const page = waitsForHydration(await context.newPage());
    for (const path of ["/website/preview", "/marketplace/preview", "/no-such-page", "/"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeGreaterThanOrEqual(500 - (path === "/no-such-page" ? 96 : 0));
      for (const value of SAMPLE) expect(await page.content(), `${path}: ${value}`).not.toContain(value);
    }
    await context.close();
  });

  test("a visitor with no session is still sent to Log in, and Log in still opens", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGIN, storageState: NOT_SIGNED_IN });
    const redirected = await api.get("/customers", { maxRedirects: 0 });
    expect(redirected.status()).toBe(307);
    expect(redirected.headers().location).toContain("/login");
    expect((await api.get("/login")).status()).toBe(200);
    await api.dispose();
  });

  test("a sign-in cannot succeed without the database", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGIN, storageState: NOT_SIGNED_IN, extraHTTPHeaders: { origin: ORIGIN, "x-forwarded-for": "fd00:dead:beef::1" } });
    const response = await api.post("/api/auth/sign-in/email", { data: { email: "alex.morgan@apex.test", password: process.env.SEED_PASSWORD } });
    expect(response.ok()).toBe(false);
    expect((await api.storageState()).cookies.filter((cookie) => cookie.name.endsWith("session_token"))).toEqual([]);
    await api.dispose();
  });
});
