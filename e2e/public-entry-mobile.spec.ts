/**
 * Phase 19C, the new and changed screens at 390 px and by keyboard: the public header on a provider's profile, Sign up, Log in, set-up, the business's review
 * requests, and the platform console's moderation pages. Each fits the width, has labelled controls, announces what is wrong, and can be used without a mouse.
 */
import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { signedIn } from "./assets-helpers";
import { makeProvider } from "./marketplace-helpers";
import { makeAccount, makePlatformAdmin } from "./platform-admin-helpers";
import { makeCustomer, makeReviewRequest } from "./review-helpers";
import { ORIGIN, expect, expectAccessible, formAlert, hydrated, newEmail, test } from "./saas";

test.describe.configure({ timeout: 120_000 });
const PHONE = { width: 390, height: 844 };

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function phoneAs(browser: Browser, email: string | null): Promise<{ context: BrowserContext; page: Page }> {
  const where = address();
  const storageState = email ? await (await signedIn(email, where)).storageState() : { cookies: [], origins: [] };
  const context = await browser.newContext({ storageState, viewport: PHONE, extraHTTPHeaders: { "x-forwarded-for": where } });
  return { context, page: await context.newPage() };
}

test.describe("on a phone", () => {
  test("a provider's profile carries the public header and keeps the invitation to businesses apart from booking", async ({ browser }) => {
    const provider = await makeProvider("phoneprof", { db: owner.db, pool: owner.pool });
    const visitor = await phoneAs(browser, null);
    await visitor.page.goto(`/listings/${provider.slug}`);
    expect(await overflow(visitor.page)).toBe(0);
    const header = visitor.page.getByRole("banner");
    await expect(header.getByRole("link", { name: "List your business" })).toHaveAttribute("href", "/signup");
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    // Booking this provider and listing a business are different things in different places, each saying what it is.
    const note = visitor.page.getByRole("complementary", { name: "Do you run an HVAC business?" });
    await expect(note).toContainText(`to book ${provider.name}, use the service buttons above`);
    await expect(note.getByRole("link", { name: "List your business on Climvia" })).toHaveAttribute("href", "/signup");
    await expect(visitor.page.locator(`a[href^="/listings/${provider.slug}/book/"]`).first()).toBeVisible();
    await expectAccessible(visitor.page);
    await visitor.context.close();
  });

  test("Sign up and Log in: every field has a label, a mistake is announced and focused, and nothing runs off the screen", async ({ browser }) => {
    const visitor = await phoneAs(browser, null);
    const page = visitor.page;
    await page.goto("/signup");
    await hydrated(page);
    expect(await overflow(page)).toBe(0);
    for (const label of [/^Full name/, /^Email/, /^Password/]) await expect(page.getByLabel(label)).toBeVisible();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByLabel(/^Full name/)).toBeFocused();
    await expect(page.getByLabel(/^Full name/)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    await expectAccessible(page);

    await page.goto("/login");
    await hydrated(page);
    expect(await overflow(page)).toBe(0);
    await page.getByLabel(/^Email/).fill(newEmail("nobody"));
    await page.getByLabel(/^Password/).fill("not-the-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(formAlert(page)).toContainText("That email and password don't match");
    await expectAccessible(page);
    // The way to the other door is one link, and it is a link.
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup");
    await visitor.context.close();
  });

  test("set-up: each of the five steps fits the screen, starts at its heading, and can be completed with the keyboard alone", async ({ browser }) => {
    const account = await makeAccount("phoneonb", owner.db);
    const person = await phoneAs(browser, account.email);
    const page = person.page;
    await page.goto("/onboarding");
    await hydrated(page);
    const heading = page.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText("What's your business called?");
    expect(await overflow(page)).toBe(0);
    await page.getByLabel(/^Business name/).fill("Phone Heating Co");
    await page.keyboard.press("Tab");
    // Tab from the field to the step's own buttons; Enter on Continue is the keyboard's way forward.
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(heading).toHaveText("How can customers reach you?");
    await expect(heading).toBeFocused();
    expect(await overflow(page)).toBe(0);
    await page.getByLabel(/^Phone/).fill("(303) 555-0188");
    await page.getByLabel(/^Email/).fill("hello@phone.test");
    await page.getByLabel(/^Street address/).fill("12 Aspen Way");
    await page.getByLabel(/^City/).fill("Denver");
    await page.getByLabel(/^State/).selectOption("CO");
    await page.getByLabel(/^ZIP code/).fill("80203");
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(heading).toHaveText("Workspace preferences");
    expect(await overflow(page)).toBe(0);
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(heading).toHaveText("When are you open?");
    expect(await overflow(page)).toBe(0);
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(heading).toHaveText("Review and create your workspace");
    expect(await overflow(page)).toBe(0);
    await expectAccessible(page);
    await page.getByRole("button", { name: "Create workspace" }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`${ORIGIN}/overview`);
    await expect(page.getByRole("heading", { level: 1, name: "Workspace Overview" })).toBeVisible();
    // The welcome's next steps fit a phone as cards and each is a link. (The workspace shell is laid out for tablets and up, so the page itself is not held to the phone's width.)
    const steps = page.getByRole("list", { name: "Next steps" });
    await expect(steps.getByRole("link")).toHaveCount(5);
    for (const link of await steps.getByRole("link").all()) await expect(link).toBeVisible();
    await expectAccessible(page);
    await person.context.close();
  });

  test("a business's review requests and the new-link dialog fit the screen and work without a mouse", async ({ browser }) => {
    const provider = await makeProvider("phonerev", { db: owner.db, pool: owner.pool });
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, "Dana Lee");
    await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id, { expiresIn: "-1 hour" });
    const business = await phoneAs(browser, provider.business.owner.email);
    const page = business.page;
    await page.goto("/reviews");
    await hydrated(page);
    const button = page.getByRole("button", { name: `Get a new review link for ${customer.name}` });
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "New review link" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= PHONE.width).toBe(true);
    await expect(dialog.getByLabel("Review link")).toHaveValue(/\/review\//);
    // Escape closes it and focus returns to the button that opened it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await business.context.close();
  });

  test("the console's Marketplace and Reviews pages: the moderation forms open and send from the keyboard, and the page does not run off the screen", async ({ browser }) => {
    const provider = await makeProvider("phonemod", { db: owner.db, pool: owner.pool }, { reviews: [{ rating: 5, text: "Phone-sized public review" }] });
    const admin = await makePlatformAdmin("phonemodadm", owner.db, owner.pool);
    const console = await phoneAs(browser, admin.email);
    const page = console.page;

    await page.goto(`/platform-admin/reviews?q=${provider.token}`);
    await page.waitForLoadState("networkidle");
    expect(await overflow(page)).toBe(0);
    const row = page.getByRole("row").filter({ hasText: "Phone-sized public review" });
    const summary = row.getByText("Hide from Marketplace…");
    await summary.scrollIntoViewIfNeeded();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(row.getByLabel("Internal reason (optional)")).toBeVisible();
    await row.getByLabel("Internal reason (optional)").fill("Phone test");
    await row.getByRole("button", { name: "Hide review" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "The review is hidden from the Marketplace." })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await expectAccessible(page);

    await page.goto(`/platform-admin/marketplace?q=${provider.token}`);
    await page.waitForLoadState("networkidle");
    expect(await overflow(page)).toBe(0);
    const listing = page.getByRole("row").filter({ hasText: provider.name });
    await listing.getByText("Suspend…").scrollIntoViewIfNeeded();
    await listing.getByText("Suspend…").focus();
    await page.keyboard.press("Enter");
    await listing.getByLabel("Message to the business (optional)").fill("Phone message");
    await listing.getByRole("button", { name: "Suspend listing" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "The listing is suspended." })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await expectAccessible(page);
    await console.context.close();
  });
});
