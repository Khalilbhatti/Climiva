/**
 * Phase 19C, review collection as people use it: a business asks a customer for a review and is given the link once; the customer opens it with no
 * account, rates the work, writes a few words and chooses whether the review may be public (it is private unless they say yes); the business sees the
 * result; the Marketplace profile and its rating follow exactly what is public; and the platform can hide a public review and restore it.
 *
 * Every test makes its own provider and customer, so every number asserted is exact.
 */
import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright/test";
import { Pool } from "pg";
import { adminDb } from "../scripts/db/lib";
import { anonymous, signedIn } from "./assets-helpers";
import { makeProvider } from "./marketplace-helpers";
import { makePlatformAdmin } from "./platform-admin-helpers";
import { captureAction, replay, withFirstArgument } from "./replay";
import { makeCustomer, makeReviewRequest, publicRating, type TestCustomer } from "./review-helpers";
import { NOT_SIGNED_IN, ORIGIN, expect, expectAccessible, test } from "./saas";

test.describe.configure({ timeout: 180_000 });

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
const LINK = new RegExp(`^${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/review/[A-Za-z0-9_-]{43}$`);
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

async function openAs(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const where = address();
  const state = await (await signedIn(email, where)).storageState();
  const context = await browser.newContext({ storageState: state, extraHTTPHeaders: { "x-forwarded-for": where } });
  return { context, page: await context.newPage() };
}

async function openAnonymous(browser: Browser, viewport = { width: 1280, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: NOT_SIGNED_IN, viewport, extraHTTPHeaders: { "x-forwarded-for": address() } });
  return { context, page: await context.newPage() };
}

/** The business asks for a review in its workspace and is shown the link. Returns the link and leaves the modal closed. */
async function askForReview(page: Page, customer: TestCustomer): Promise<string> {
  await page.goto("/reviews");
  await page.getByRole("button", { name: "Request review" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Request a review" });
  await dialog.getByLabel("Customer").selectOption({ label: customer.name });
  await dialog.getByRole("button", { name: "Send review request" }).click();
  const ready = page.getByRole("dialog", { name: "Review link ready" });
  await expect(ready).toBeVisible();
  const link = await ready.getByLabel("Review link").inputValue();
  await ready.getByRole("button", { name: "Done" }).click();
  await expect(ready).toBeHidden();
  return link;
}

const rate = (page: Page, stars: number) => page.getByLabel(`${stars} ${stars === 1 ? "star" : "stars"}`).check({ force: true });
const consent = (page: Page) => page.getByRole("checkbox", { name: /may show my review on its public Climvia Marketplace profile/ });

async function counts(pool: Pool, organizationId: string) {
  return (await pool.query<{ visibility: string; rating: number; review_text: string }>("select visibility, rating, review_text from reviews where organization_id = $1 order by created_at", [organizationId])).rows;
}

/* ───────────────────────────── the whole journey ───────────────────────────── */

test.describe("a review, from the request to the Marketplace", () => {
  test("the business is given the link once; the customer rates and keeps it private; nothing public changes; the business sees it as private", async ({ browser }) => {
    const provider = await makeProvider("revflow", { db: owner.db, pool: owner.pool });
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, "Sarah Mitchell");
    const business = await openAs(browser, provider.business.owner.email);
    const link = await askForReview(business.page, customer);
    expect(link).toMatch(LINK);

    // The request is recorded with a link that is active; the secret itself is not stored anywhere readable.
    const stored = (await owner.pool.query("select token_hash, expires_at, status from review_requests where organization_id = $1", [provider.business.organizationId])).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("recorded");
    expect(link).not.toContain(stored[0].token_hash);
    expect(JSON.stringify(stored[0])).not.toContain(link.split("/").pop()!);
    const panel = business.page.getByRole("list", { name: "Review requests" });
    await expect(panel.getByRole("listitem").filter({ hasText: customer.name })).toContainText("Link active");
    // It is not shown again: not in the page, and not in what the server sends for the page.
    expect(await business.page.content()).not.toContain(link.split("/").pop()!);

    // The customer opens it: no account, no sign-in, nothing of the business's workspace.
    const visitor = await openAnonymous(browser);
    const response = await visitor.page.goto(link);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toMatch(/no-store/);
    expect(await visitor.page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex, nofollow");
    expect(await visitor.page.locator('meta[name="referrer"]').getAttribute("content")).toBe("no-referrer");
    await expect(visitor.page.getByRole("heading", { level: 1, name: `How did ${provider.name} do?` })).toBeVisible();
    await expect(visitor.page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    // The consent is a choice they make: it starts unchecked, and it says exactly what public means.
    await expect(consent(visitor.page)).not.toBeChecked();
    const words = await visitor.page.getByRole("group", { name: "Showing your review publicly" }).innerText();
    expect(words).toContain("Sarah M.");
    expect(words).toMatch(/first name and last initial/);
    expect(words).toMatch(/not\s+anonymous/);
    expect(words).toMatch(/always sees your full review/);
    expect(words).toMatch(/stays private/);
    await expectAccessible(visitor.page);

    // A form with nothing in it says what is missing, to the screen reader too, and sends nothing.
    await visitor.page.getByRole("button", { name: "Send review" }).click();
    await expect(visitor.page.getByRole("alert").filter({ hasText: "Choose a rating from 1 to 5 stars." })).toBeVisible();
    await rate(visitor.page, 4);
    await visitor.page.getByRole("button", { name: "Send review" }).click();
    // A field's mistake is written beside it, the field is marked invalid, and the keyboard is taken to it.
    await expect(visitor.page.getByText("Write a few words about your experience.")).toBeVisible();
    await expect(visitor.page.getByLabel("Your review")).toHaveAttribute("aria-invalid", "true");
    await expect(visitor.page.getByLabel("Your review")).toBeFocused();
    expect(await counts(owner.pool, provider.business.organizationId)).toEqual([]);

    await visitor.page.getByLabel("Your review").fill("Quick and tidy. Explained the problem clearly.");
    await visitor.page.getByRole("button", { name: "Send review" }).click();
    await expect(visitor.page.getByText("Thank you. Your review was sent.")).toBeVisible();
    await expect(visitor.page.getByText(`You kept your review private, so only ${provider.name} can read it.`)).toBeVisible();
    expect(await counts(owner.pool, provider.business.organizationId)).toEqual([{ visibility: "private", rating: 4, review_text: "Quick and tidy. Explained the problem clearly." }]);

    // Nothing on the Marketplace changed.
    expect(await publicRating(owner.pool, provider.slug)).toBeNull();
    const profile = await anonymous(address());
    expect(visibleText(await (await profile.get(`/listings/${provider.slug}`)).text())).not.toContain("Quick and tidy");
    await profile.dispose();

    // The business sees it, marked private, from the customer, with the request answered.
    await business.page.goto("/reviews");
    const card = business.page.getByRole("article", { name: `Review from ${customer.name}` });
    await expect(card).toContainText("Quick and tidy.");
    await expect(card).toContainText("Private");
    await expect(panel.getByRole("listitem").filter({ hasText: customer.name })).toContainText("Review received");
    await expect(panel.getByRole("button", { name: `Get a new review link for ${customer.name}` })).toHaveCount(0);

    // The link has done its one job.
    await visitor.page.goto(link);
    await expect(visitor.page.getByRole("heading", { level: 1, name: "This review has already been sent" })).toBeVisible();
    await expect(visitor.page.getByLabel("Your review")).toHaveCount(0);
    await visitor.context.close();
    await business.context.close();
  });

  test("a customer who says yes makes the review public: the profile shows it under a first name and last initial, the rating counts it, the business sees it as public", async ({ browser }) => {
    const provider = await makeProvider("revpublic", { db: owner.db, pool: owner.pool });
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, "Maya Singh Okafor");
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    const visitor = await openAnonymous(browser);
    await visitor.page.goto(`/review/${request.token}`);
    await expect(visitor.page.getByText("Maya O.")).toBeVisible();
    await rate(visitor.page, 5);
    await visitor.page.getByLabel("Your review").fill("Fixed the unit in an hour. Great service.");
    await consent(visitor.page).check();
    await visitor.page.getByRole("button", { name: "Send review" }).click();
    await expect(visitor.page.getByText(`As you chose, ${provider.name} can show your review on its Climvia Marketplace profile as Maya O.`)).toBeVisible();
    expect(await counts(owner.pool, provider.business.organizationId)).toEqual([{ visibility: "public", rating: 5, review_text: "Fixed the unit in an hour. Great service." }]);
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 5, count: 1 });

    const profile = await openAnonymous(browser);
    await profile.page.goto(`/listings/${provider.slug}`);
    const text = await profile.page.locator("main").innerText();
    expect(text).toContain("Fixed the unit in an hour. Great service.");
    expect(text).toContain("Maya O.");
    expect(text).not.toContain("Maya Singh Okafor");
    expect(text).not.toContain("Singh");
    await profile.page.goto(`/marketplace?q=${provider.token}`);
    await expect(profile.page.getByRole("article", { name: provider.name })).toContainText("5.0 · 1 review");

    const business = await openAs(browser, provider.business.admin.email);
    await business.page.goto("/reviews");
    await expect(business.page.getByRole("article", { name: `Review from ${customer.name}` })).toContainText("Public on Marketplace");
    // The business cannot change that: there is no control for it on the review.
    await business.page.getByRole("link", { name: customer.name }).first().click();
    await expect(business.page.getByRole("main").getByRole("button", { name: /public|private|show|hide/i })).toHaveCount(0);
    await business.context.close();
    await profile.context.close();
    await visitor.context.close();
  });

  test("a link that ran out says so and takes nothing; a new link replaces it and the old one stops working at once", async ({ browser }) => {
    const provider = await makeProvider("revexpire", { db: owner.db, pool: owner.pool });
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, "Dana Lee");
    const old = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id, { expiresIn: "-1 hour" });
    const visitor = await openAnonymous(browser);
    await visitor.page.goto(`/review/${old.token}`);
    await expect(visitor.page.getByRole("heading", { level: 1, name: "This review link has expired" })).toBeVisible();
    await expect(visitor.page.getByText(`Ask ${provider.name} for a new one`)).toBeVisible();
    await expect(visitor.page.getByLabel("Your review")).toHaveCount(0);

    const business = await openAs(browser, provider.business.owner.email);
    await business.page.goto("/reviews");
    const row = business.page.getByRole("list", { name: "Review requests" }).getByRole("listitem").filter({ hasText: customer.name });
    await expect(row).toContainText("Link expired");
    await row.getByRole("button", { name: `Get a new review link for ${customer.name}` }).click();
    const dialog = business.page.getByRole("dialog", { name: "New review link" });
    const link = await dialog.getByLabel("Review link").inputValue();
    expect(link).toMatch(LINK);
    expect(link).not.toContain(old.token);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(row).toContainText("Link active");

    // The old secret is gone: it is now nothing at all. The new one works.
    const gone = await visitor.page.goto(`/review/${old.token}`);
    expect(gone?.status()).toBe(404);
    await visitor.page.goto(link);
    await expect(visitor.page.getByRole("heading", { level: 1, name: `How did ${provider.name} do?` })).toBeVisible();
    await visitor.context.close();
    await business.context.close();
  });

  test("an address that is not a link is the same plain page for every kind of wrong, and carries nothing about any business", async ({ browser }) => {
    const provider = await makeProvider("revwrong", { db: owner.db, pool: owner.pool });
    const visitor = await openAnonymous(browser);
    const api = await anonymous(address());
    for (const path of [`/review/${randomBytes(32).toString("base64url")}`, "/review/short", "/review/%00", `/review/${"a".repeat(43)}`, `/review/${"a".repeat(200)}`, "/review/", "/review/..%2F..%2Fetc%2Fpasswd"]) {
      const response = await api.get(path, { maxRedirects: 0 });
      expect([404, 400, 308, 307], path).toContain(response.status());
      if (response.status() === 404) expect(await response.text(), path).not.toContain(provider.name);
    }
    await visitor.context.close();
    await api.dispose();
  });

  test("a forged submission cannot choose its own visibility, its own request or another business's customer", async ({ browser }) => {
    const mine = await makeProvider("revforge", { db: owner.db, pool: owner.pool });
    const other = await makeProvider("revforgeb", { db: owner.db, pool: owner.pool });
    const customer = await makeCustomer(owner.pool, mine.business.organizationId, "Lee Park");
    const foreign = await makeCustomer(owner.pool, other.business.organizationId, "Foreign Person");
    const request = await makeReviewRequest(owner.pool, mine.business.organizationId, customer.id);
    const visitor = await openAnonymous(browser);
    await visitor.page.goto(`/review/${request.token}`);
    await rate(visitor.page, 3);
    await visitor.page.getByLabel("Your review").fill("Fine.");
    const captured = await captureAction(visitor.page, async () => visitor.page.getByRole("button", { name: "Send review" }).click());
    await expect(visitor.page.getByText("Thank you. Your review was sent.")).toBeVisible();
    expect(await counts(owner.pool, mine.business.organizationId)).toEqual([{ visibility: "private", rating: 3, review_text: "Fine." }]);

    // Replays of the same call, as the customer might be forged: a fresh link each time, each with a different lie.
    const api = await anonymous(address());
    const lies: [string, (args: Record<string, unknown>) => void][] = [
      ["a boolean consent", (args) => (args.showPublicly = true)],
      ["a made-up visibility", (args) => Object.assign(args, { visibility: "public", public: true })],
      ["another business", (args) => Object.assign(args, { organizationId: other.business.organizationId })],
      ["another customer", (args) => Object.assign(args, { customerId: foreign.id, customer: foreign.slug })],
      ["another request", (args) => Object.assign(args, { requestId: request.id, jobId: foreign.id })],
      ["a rating out of range", (args) => (args.rating = "9")],
      ["too many words", (args) => (args.text = "x".repeat(2001))],
    ];
    for (const [lie, change] of lies) {
      const fresh = await makeReviewRequest(owner.pool, mine.business.organizationId, customer.id);
      const body = withFirstArgument(captured, (args) => {
        args.token = fresh.token;
        args.rating = "5";
        args.text = `Forged ${lie}`;
        args.showPublicly = "no";
        change(args);
      });
      const response = await replay(api, captured, body);
      expect(response.status(), lie).toBeLessThan(500);
      const rows = (await owner.pool.query<{ visibility: string; organization_id: string; customer_id: string }>("select visibility, organization_id, customer_id from reviews where request_id = $1", [fresh.id])).rows;
      for (const row of rows) {
        expect(row.visibility, lie).toBe("private");
        expect(row.organization_id, lie).toBe(mine.business.organizationId);
        expect(row.customer_id, lie).toBe(customer.id);
      }
    }
    expect((await owner.pool.query("select count(*)::int as n from reviews where organization_id = $1", [other.business.organizationId])).rows[0].n).toBe(0);
    expect(await publicRating(owner.pool, mine.slug)).toBeNull();
    await api.dispose();
    await visitor.context.close();
  });

  test("on a phone the whole form is usable and nothing runs off the screen; the keyboard can rate, write, choose and send", async ({ browser }) => {
    const provider = await makeProvider("revphone", { db: owner.db, pool: owner.pool });
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, "Chris Young");
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    const visitor = await openAnonymous(browser, { width: 390, height: 844 });
    await visitor.page.goto(`/review/${request.token}`);
    expect(await visitor.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expectAccessible(visitor.page);

    // Keyboard only: into the rating (arrow keys move through the group), the words, the consent, the button.
    await visitor.page.getByLabel("1 star").focus();
    await visitor.page.keyboard.press("ArrowRight");
    await visitor.page.keyboard.press("ArrowRight");
    await visitor.page.keyboard.press("ArrowRight");
    await expect(visitor.page.getByLabel("4 stars")).toBeChecked();
    await visitor.page.keyboard.press("Tab");
    await expect(visitor.page.getByLabel("Your review")).toBeFocused();
    await visitor.page.keyboard.type("Typed with the keyboard.");
    await visitor.page.keyboard.press("Tab");
    await expect(consent(visitor.page)).toBeFocused();
    await expect(consent(visitor.page)).not.toBeChecked();
    await visitor.page.keyboard.press("Space");
    await expect(consent(visitor.page)).toBeChecked();
    await visitor.page.keyboard.press("Space");
    await expect(consent(visitor.page)).not.toBeChecked();
    await visitor.page.keyboard.press("Tab");
    await expect(visitor.page.getByRole("button", { name: "Send review" })).toBeFocused();
    await visitor.page.keyboard.press("Enter");
    await expect(visitor.page.getByText("Thank you. Your review was sent.")).toBeVisible();
    expect(await counts(owner.pool, provider.business.organizationId)).toEqual([{ visibility: "private", rating: 4, review_text: "Typed with the keyboard." }]);
    expect(await visitor.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await visitor.context.close();
  });
});

/* ───────────────────────────── a custom domain has no review page ───────────────────────────── */

test.describe("the review page belongs to the platform", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("a link opened on a customer's own name, or with a forged forwarded host, is not a review page, and cannot be answered there", async () => {
    const provider = await makeProvider("revhost", { db: owner.db, pool: owner.pool });
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    const { rawRequest, uniqueHost, insertActiveClaim } = await import("./domain-helpers");
    const host = uniqueHost("rev");
    await insertActiveClaim(owner.pool, provider.business.organizationId, host);
    const port = new URL(ORIGIN).port;
    const custom = await rawRequest(ORIGIN, `/review/${request.token}`, { host: `${host}:${port}` });
    expect(custom.status).toBe(404);
    expect(custom.body).not.toContain("How did");
    // The platform's page, with a customer's name claimed in a header the client chose: still the platform's, and it works.
    const forged = await rawRequest(ORIGIN, `/review/${request.token}`, { headers: { "x-forwarded-host": host } });
    expect(forged.status).toBe(200);
    expect(visibleText(forged.body)).toContain(`How did ${provider.name} do?`);
  });
});

/* ───────────────────────────── the platform hides and restores ───────────────────────────── */

test.describe("the platform moderates a public review", () => {
  test("hiding takes it off the profile, out of the rating and out of the search; the business keeps it and is told; restoring puts it all back", async ({ browser }) => {
    const provider = await makeProvider("revmod", { db: owner.db, pool: owner.pool });
    const admin = await makePlatformAdmin("revmodadm", owner.db, owner.pool);
    const people = [await makeCustomer(owner.pool, provider.business.organizationId, "Ann Lee"), await makeCustomer(owner.pool, provider.business.organizationId, "Bob Ray")];
    const visitor = await openAnonymous(browser);
    for (const [index, customer] of people.entries()) {
      const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
      await visitor.page.goto(`/review/${request.token}`);
      await rate(visitor.page, index === 0 ? 5 : 3);
      await visitor.page.getByLabel("Your review").fill(index === 0 ? "Five star words." : "Three star words.");
      await consent(visitor.page).check();
      await visitor.page.getByRole("button", { name: "Send review" }).click();
      await expect(visitor.page.getByText("Thank you. Your review was sent.")).toBeVisible();
    }
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 4, count: 2 });

    const console = await openAs(browser, admin.email);
    await console.page.goto(`/platform-admin/reviews?q=${provider.token}`);
    await expect(console.page.getByRole("table", { name: "Reviews" }).getByRole("row")).toHaveCount(3);
    const five = console.page.getByRole("row").filter({ hasText: "Five star words." });
    await expect(five).toContainText("Public");
    await five.getByText("Hide from Marketplace…").click();
    await five.getByLabel("Internal reason (optional)").fill("Names a competitor");
    await five.getByRole("button", { name: "Hide review" }).click();
    await expect(console.page.getByRole("status").filter({ hasText: "The review is hidden from the Marketplace." })).toBeVisible();
    await expect(console.page.getByRole("row").filter({ hasText: "Five star words." })).toContainText("Hidden by the platform");
    await expect(console.page.getByRole("row").filter({ hasText: "Five star words." })).toContainText("Names a competitor");

    // The visitor's profile and search follow at once.
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 3, count: 1 });
    await visitor.page.goto(`/listings/${provider.slug}`);
    const text = await visitor.page.locator("main").innerText();
    expect(text).not.toContain("Five star words.");
    expect(text).toContain("Three star words.");
    expect(text).not.toContain("Names a competitor");
    await visitor.page.goto(`/marketplace?q=${provider.token}`);
    await expect(visitor.page.getByRole("article", { name: provider.name })).toContainText("3.0 · 1 review");

    // The business is told which review, not why, and its own record is intact.
    const business = await openAs(browser, provider.business.owner.email);
    await business.page.goto("/reviews");
    const mine = business.page.getByRole("article", { name: "Review from Ann Lee" });
    await expect(mine).toContainText("Five star words.");
    await expect(mine).toContainText("Hidden from Marketplace by Climvia");
    expect(await business.page.content()).not.toContain("Names a competitor");

    // Restoring.
    await console.page.goto(`/platform-admin/reviews?q=${provider.token}&visibility=hidden`);
    await expect(console.page.getByRole("table", { name: "Reviews" }).getByRole("row")).toHaveCount(2);
    await console.page.getByRole("button", { name: "Restore" }).click();
    await expect(console.page.getByRole("status").filter({ hasText: "The review is shown on the Marketplace again" })).toBeVisible();
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 4, count: 2 });
    await visitor.page.goto(`/listings/${provider.slug}`);
    expect(await visitor.page.locator("main").innerText()).toContain("Five star words.");
    await business.page.goto("/reviews");
    await expect(business.page.getByRole("article", { name: "Review from Ann Lee" })).toContainText("Public on Marketplace");

    // A private review has nothing to hide, and the console says so.
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, people[0].id);
    await visitor.page.goto(`/review/${request.token}`);
    await rate(visitor.page, 1);
    await visitor.page.getByLabel("Your review").fill("Private one star.");
    await visitor.page.getByRole("button", { name: "Send review" }).click();
    await expect(visitor.page.getByText("Thank you. Your review was sent.")).toBeVisible();
    await console.page.goto(`/platform-admin/reviews?q=${provider.token}&visibility=private`);
    const privateRow = console.page.getByRole("row").filter({ hasText: "Private one star." });
    await expect(privateRow).toContainText("Private reviews are not on the Marketplace.");
    await expect(privateRow.getByText("Hide from Marketplace…")).toHaveCount(0);
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 4, count: 2 });
    await expectAccessible(console.page);
    await business.context.close();
    await console.context.close();
    await visitor.context.close();
  });

  test("the console's review pages are for administrators only, and a business's owner cannot hide a review by asking", async ({ browser }) => {
    const provider = await makeProvider("revmodb", { db: owner.db, pool: owner.pool }, { reviews: [{ rating: 5, text: "Standing public review" }] });
    const reviewId = (await owner.pool.query<{ id: string }>("select id from reviews where organization_id = $1", [provider.business.organizationId])).rows[0].id;
    const business = await openAs(browser, provider.business.owner.email);
    expect((await business.page.request.get("/platform-admin/reviews", { maxRedirects: 0 })).status()).toBe(404);
    // A forged post of the console's form, from a signed-in business owner.
    const admin = await makePlatformAdmin("revmodbadm", owner.db, owner.pool);
    const console = await openAs(browser, admin.email);
    await console.page.goto(`/platform-admin/reviews?q=${provider.token}`);
    const captured = await captureAction(console.page, async () => {
      const row = console.page.getByRole("row").filter({ hasText: "Standing public review" });
      await row.getByText("Hide from Marketplace…").click();
      await row.getByRole("button", { name: "Hide review" }).click();
    });
    await expect(console.page.getByRole("status").filter({ hasText: "The review is hidden from the Marketplace." })).toBeVisible();
    expect(await publicRating(owner.pool, provider.slug)).toBeNull();
    // Restore it as the administrator, then try the captured hide as the business's owner and as nobody.
    await owner.pool.query("delete from platform_review_moderation where review_id = $1", [reviewId]);
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 5, count: 1 });
    const asOwner = await signedIn(provider.business.owner.email, address());
    const asNobody = await anonymous(address());
    for (const api of [asOwner, asNobody]) {
      const response = await replay(api, captured, undefined, { maxRedirects: 0 });
      expect([303, 307, 404, 401, 403, 200]).toContain(response.status());
      expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 5, count: 1 });
    }
    expect((await owner.pool.query("select count(*)::int as n from platform_review_moderation where review_id = $1", [reviewId])).rows[0].n).toBe(0);
    await asOwner.dispose();
    await asNobody.dispose();
    await business.context.close();
    await console.context.close();
  });
});
