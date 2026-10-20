/**
 * Phase 19D, accessibility and responsive qualification of the surfaces a release puts in front of people who did not build it, in one place:
 *
 *   landing · Marketplace · provider profile · booking · Sign up and Log in · set-up (onboarding) · review submission · Platform Admin · the business's
 *   Marketplace management
 *
 * Every customer-facing, sign-in and console surface is held at 390 px: nothing runs off the screen, the structure, names and contrast pass, there is a
 * level-one heading, and the whole page can be walked with the Tab key (every stop is named and the focus moves on and is never stuck). The business's own
 * Marketplace management is a workspace screen: held at the narrowest width the workspace supports (768 px) and at a laptop's, as it always was.
 */
import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { signedIn } from "./assets-helpers";
import { makeProvider, SAMPLE_SERVICES } from "./marketplace-helpers";
import { makeAccount, makePlatformAdmin } from "./platform-admin-helpers";
import { makeCustomer, makeReviewRequest } from "./review-helpers";
import { ORIGIN, expect, expectAccessible, hydrated, test } from "./saas";

test.describe.configure({ timeout: 180_000 });

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

const PHONE = { width: 390, height: 844 };
const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;

async function as(browser: Browser, email: string | null, viewport = PHONE): Promise<{ context: BrowserContext; page: Page }> {
  const where = address();
  // An explicit empty session unless a person is named: the project's signed-in state must not ride along.
  const storageState = email ? await (await signedIn(email, where)).storageState() : { cookies: [], origins: [] };
  const context = await browser.newContext({ baseURL: ORIGIN, storageState, viewport, extraHTTPHeaders: { "x-forwarded-for": where } });
  return { context, page: await context.newPage() };
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Walk the page with Tab: each stop has a name, the focus keeps moving, and it reaches something in the page's main part. */
async function walkByKeyboard(page: Page, label: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: string[] = [];
  let reachedMain = false;
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const name = (element.getAttribute("aria-label") || element.getAttribute("title") || (element as HTMLInputElement).labels?.[0]?.textContent || element.textContent || (element as HTMLImageElement).alt || "").replace(/\s+/g, " ").trim();
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName.toLowerCase(), name, inMain: Boolean(element.closest("main, [role=main]")), visible: rect.width > 0 && rect.height > 0 };
    });
    if (!stop) break; // the end of the page: focus left the document
    expect(stop.name, `${label}: a keyboard stop (${stop.tag}) has no name`).not.toBe("");
    expect(stop.visible, `${label}: focus on something with no size (${stop.name})`).toBe(true);
    stops.push(`${stop.tag}:${stop.name}`);
    if (stop.inMain) reachedMain = true;
    // A date field is one element with several parts (month, day, year, the picker), so Tab stays on it a few times; a keyboard trap would never leave.
    if (stops.length >= 8 && stops.slice(-8).every((item) => item === stops.at(-1))) throw new Error(`${label}: the focus is stuck on ${stops.at(-1)}`);
  }
  expect(stops.length, `${label}: the page has something to tab to`).toBeGreaterThanOrEqual(2);
  expect(new Set(stops).size, `${label}: the focus moves through different things`).toBeGreaterThanOrEqual(2);
  expect(reachedMain, `${label}: the keyboard reaches the main part of the page`).toBe(true);
}

async function holdsAt390(page: Page, label: string, options: { keyboard?: boolean } = {}) {
  expect(await overflow(page), `${label}: runs off the screen`).toBe(0);
  await expect(page.getByRole("heading", { level: 1 }).first(), `${label}: a level-one heading`).toBeVisible();
  await expectAccessible(page);
  if (options.keyboard !== false) await walkByKeyboard(page, label);
}

test.describe("at 390 px", () => {
  test("the landing, the Marketplace, a provider's profile, its booking page, Sign up and Log in", async ({ browser }) => {
    const provider = await makeProvider("relaccess", { db: owner.db, pool: owner.pool }, { areas: [{ city: "Denver", state: "CO" }], reviews: [{ rating: 5, text: "Quick and tidy." }] });
    const visitor = await as(browser, null);
    const page = visitor.page;
    for (const [label, path] of [
      ["the landing", "/"],
      ["the Marketplace", `/marketplace?q=${provider.token}`],
      ["a provider's profile", `/listings/${provider.slug}`],
      ["the booking page", `/listings/${provider.slug}/book/${SAMPLE_SERVICES.repair}`],
      ["Sign up", "/signup"],
      ["Log in", "/login"],
    ] as const) {
      const response = await page.goto(path);
      expect(response?.status(), label).toBe(200);
      await holdsAt390(page, label);
    }
    await visitor.context.close();
  });

  test("a form fails in words a person can act on: Sign up and Log in announce the mistake and move the focus to it", async ({ browser }) => {
    const visitor = await as(browser, null);
    const page = visitor.page;
    await page.goto("/signup");
    await hydrated(page);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    await expect(page.getByLabel(/^Full name/)).toBeFocused();
    await expect(page.getByLabel(/^Full name/)).toHaveAttribute("aria-invalid", "true");
    expect(await overflow(page)).toBe(0);
    await expectAccessible(page);
    await visitor.context.close();
  });

  test("set-up: the first step, and the last, fit the screen and can be walked by keyboard", async ({ browser }) => {
    const account = await makeAccount("relonb", owner.db);
    const person = await as(browser, account.email);
    const page = person.page;
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("What's your business called?");
    expect(await overflow(page)).toBe(0);
    await expectAccessible(page);
    await walkByKeyboard(page, "set-up");
    await person.context.close();
  });

  test("review submission: a customer's form is a labelled, keyboard-complete page that fits, and a link that has run out says so in words", async ({ browser }) => {
    const provider = await makeProvider("relreview", { db: owner.db, pool: owner.pool });
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, "Dana Lee");
    const open = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    const spent = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id, { expiresIn: "-1 hour" });
    const visitor = await as(browser, null);
    const page = visitor.page;
    await page.goto(`/review/${open.token}`);
    await hydrated(page);
    await holdsAt390(page, "the review form");
    for (const label of ["1 star", "5 stars"]) await expect(page.getByLabel(label)).toHaveCount(1);
    await expect(page.getByLabel("Your review")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /may show my review/ })).not.toBeChecked();
    // Submitting nothing explains itself and puts the focus on the first thing to fix.
    await page.getByRole("button", { name: "Send review" }).click();
    await expect(page.locator("form").getByText(/rating/i).filter({ hasText: /choose|select|pick|give/i }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => { const active = document.activeElement; return Boolean(active && active.closest("form") && active.tagName !== "BODY" && !(active.tagName === "BUTTON" && active.textContent?.includes("Send review"))); })).toBe(true);
    expect(await overflow(page)).toBe(0);
    await page.goto(`/review/${spent.token}`);
    await expect(page.getByRole("heading", { name: "This review link has expired" })).toBeVisible();
    await holdsAt390(page, "an expired review link", { keyboard: false });
    await visitor.context.close();
  });

  test("Platform Admin: its sign-in and every console page fit the screen, are named, and can be walked by keyboard", async ({ browser }) => {
    const admin = await makePlatformAdmin("relconsole", owner.db, owner.pool);
    const anonymous = await as(browser, null);
    await anonymous.page.goto("/platform-admin/login");
    await holdsAt390(anonymous.page, "the console's sign-in");
    await anonymous.context.close();

    const person = await as(browser, admin.email);
    const page = person.page;
    for (const path of ["/platform-admin", "/platform-admin/organizations", "/platform-admin/users", "/platform-admin/marketplace", "/platform-admin/reviews", "/platform-admin/system"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await page.waitForLoadState("networkidle");
      await holdsAt390(page, path);
    }
    await person.context.close();
  });
});

test.describe("the business's Marketplace management, at the narrowest width the workspace supports", () => {
  test("the listing, its editor and its preview hold at 768 and at 1280, are named and can be walked by keyboard", async ({ browser }) => {
    const provider = await makeProvider("relmanage", { db: owner.db, pool: owner.pool }, { areas: [{ city: "Denver", state: "CO" }] });
    for (const viewport of [{ width: 768, height: 900 }, { width: 1280, height: 900 }]) {
      const person = await as(browser, provider.business.owner.email, viewport);
      const page = person.page;
      for (const path of ["/marketplace-listing", "/marketplace-listing/edit", "/marketplace-listing/preview"]) {
        const response = await page.goto(path);
        expect(response?.status(), `${path} at ${viewport.width}`).toBe(200);
        await expect(page.getByRole("heading", { level: 1 }).first(), `${path} at ${viewport.width}`).toBeVisible();
        expect(await overflow(page), `${path} at ${viewport.width}: runs off the screen`).toBe(0);
        await expectAccessible(page);
        if (path !== "/marketplace-listing/preview") await walkByKeyboard(page, `${path} at ${viewport.width}`);
      }
      await person.context.close();
    }
  });
});
