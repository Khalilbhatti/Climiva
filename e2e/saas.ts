/**
 * Helpers for the specs that exercise accounts, businesses and tenant isolation (as opposed to the module specs, which
 * only need to be signed in as the owner of their worker's Apex copy, see fixtures.ts).
 */
import { randomBytes } from "node:crypto";
import { request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from "playwright/test";
import { Pool } from "pg";
import { structuralIssues, unnamedControls } from "./a11y-lint";
import { findLowContrast } from "./contrast";
import { expect, signInOverHttp, test as base, waitForHydration, waitsForHydration } from "./fixtures";

export const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://localhost:3460";
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "";

/** The standing development users (scripts/db/seed-lib.ts), by the role they play in these specs. */
export const SEED = {
  /** Apex owner. Belongs to Apex only. */
  alex: "alex.morgan@apex.test",
  /** Apex member: may view Settings, not change them. */
  jamie: "jamie.rivera@apex.test",
  /** Northstar owner. Belongs to Northstar only. */
  taylor: "taylor.brooks@northstar.test",
  /** Admin in both Apex and Northstar. */
  casey: "casey.nguyen@climvia.test",
} as const;
export type SeedUser = keyof typeof SEED;

export const NOT_SIGNED_IN = { cookies: [], origins: [] };

/** An address no one is registered under, valid but never reused. */
export const newEmail = (label = "person") => `${label}-${Date.now().toString(36)}${randomBytes(3).toString("hex")}@example.test`;
export const PASSWORD = "Correct-horse-1";

type Session = { context: BrowserContext; page: Page; problems: string[] };

type SaasFixtures = {
  /** Open a browser context signed in as one of the seed users, with its own client address and a console watcher. */
  openAs: (who: SeedUser) => Promise<Session>;
  /** An API client signed in as a seed user (or nobody), for checking raw responses. */
  apiAs: (who: SeedUser | null) => Promise<APIRequestContext>;
  /** A direct connection with the owner role, for looking at what the application stored. */
  db: Pool;
};

/** Collect console errors, warnings and uncaught exceptions on a page the default guard does not cover. */
export function watchConsole(page: Page, ignore: RegExp[] = []): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = `[${message.type()}] ${message.text()}`;
    if ((message.type() === "error" || message.type() === "warning") && !ignore.some((pattern) => pattern.test(text))) problems.push(text);
  });
  page.on("pageerror", (error) => problems.push(`[pageerror] ${error.message}`));
  return problems;
}

export const test = base.extend<SaasFixtures>({
  openAs: async ({ browser, clientAddresses }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (who) => {
      const address = clientAddresses();
      const storageState = await signInOverHttp(SEED[who], SEED_PASSWORD, address);
      const context = await newContext(browser, storageState, address);
      opened.push(context);
      const page = waitsForHydration(await context.newPage());
      return { context, page, problems: watchConsole(page) };
    });
    await Promise.all(opened.map((context) => context.close()));
  },

  apiAs: async ({ clientAddresses }, use) => {
    const opened: APIRequestContext[] = [];
    await use(async (who) => {
      const address = clientAddresses();
      const storageState = who ? await signInOverHttp(SEED[who], SEED_PASSWORD, address) : NOT_SIGNED_IN;
      const api = await playwrightRequest.newContext({ baseURL: ORIGIN, storageState, extraHTTPHeaders: { "x-forwarded-for": address, origin: ORIGIN } });
      opened.push(api);
      return api;
    });
    await Promise.all(opened.map((api) => api.dispose()));
  },

  db: async ({}, use) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
    await use(pool);
    await pool.end();
  },
});

export { expect };

async function newContext(browser: Browser, storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>, address: string) {
  return browser.newContext({ baseURL: ORIGIN, viewport: { width: 1440, height: 900 }, storageState, extraHTTPHeaders: { "x-forwarded-for": address } });
}

/** The business name button in the top bar (the workspace switcher). */
export const switcher = (page: Page) => page.getByTitle("Switch workspace");

/** Fill in and submit the Sign up form. Ends on the set-up page. */
export async function signUp(page: Page, details: { name?: string; email?: string; password?: string } = {}) {
  const email = details.email ?? newEmail("owner");
  await openForm(page, "/signup");
  await page.getByLabel(/^Full name/).fill(details.name ?? "Pat Newcomer");
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(details.password ?? PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await hydrated(page);
  return email;
}

export type NewBusiness = { name: string; phone?: string; email?: string; street?: string; city?: string; state?: string; zip?: string };

/** Walk through the five set-up steps with valid details and create the workspace. Ends on the new workspace's Overview. */
export async function completeOnboarding(page: Page, business: NewBusiness) {
  await hydrated(page);
  await page.getByLabel(/^Business name/).fill(business.name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/^Phone/).fill(business.phone ?? "(303) 555-0188");
  await page.getByLabel(/^Email/).fill(business.email ?? "hello@newbiz.test");
  await page.getByLabel(/^Street address/).fill(business.street ?? "12 Aspen Way");
  await page.getByLabel(/^City/).fill(business.city ?? "Denver");
  await page.getByLabel(/^State/).selectOption(business.state ?? "CO");
  await page.getByLabel(/^ZIP code/).fill(business.zip ?? "80203");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/^Time zone/).selectOption("America/Denver");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review and create your workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workspace Overview" })).toBeVisible();
  await hydrated(page);
}

export { waitsForHydration };
export const toast = (page: Page) => page.getByRole("status");

/** The same structural and contrast standard every workspace route is held to (accessibility.spec.ts). */
export async function expectAccessible(page: Page) {
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.lang), "html lang").toBe("en");
  expect((await page.title()).trim().length, "page title").toBeGreaterThan(0);
  expect(await unnamedControls(page), "controls without a name").toEqual([]);
  expect(await structuralIssues(page), "structure").toEqual([]);
  expect(await findLowContrast(page), "contrast").toEqual([]);
}

/** The form alert on a page (not Next's empty route announcer, which has the same role). */
export const formAlert = (page: Page) => page.locator("form [role='alert'], main [role='alert']").first();

/**
 * Wait until the page's scripts have taken over. A server-rendered form can be typed into before that, and React then
 * resets the field to its initial value, so a test that fills a form right after navigating waits for this first.
 */
export async function hydrated(page: Page) {
  await waitForHydration(page);
}

/** Open a page that starts with a form and wait until it can be filled in. */
export async function openForm(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

/** Choose another workspace in the switcher and wait for the page load that follows, by the new name appearing. */
export async function switchWorkspace(page: Page, name: string | RegExp) {
  await switcher(page).click();
  await page.getByRole("region", { name: "Workspaces" }).getByRole("button", { name }).click();
  await expect(switcher(page)).toContainText(name);
  await hydrated(page);
}
