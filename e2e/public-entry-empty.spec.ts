/**
 * Phase 19C, a product on its first day: a database that was only migrated (no seed), served by a second application server. Nothing is made for the
 * test but what a person does. A visitor finds the landing and an empty Marketplace; the first account is an ordinary one and nothing makes it an
 * administrator; a business owner signs up, sets up, and finds a workspace with no sample record anywhere; they add a Service, a place, publish, and are
 * found; a guest books; a customer reviews through a link; a platform administrator (granted by the command-line tool) hides and restores the review and
 * suspends and lifts the listing; and revoking that administrator closes the console again.
 *
 * Serial, because each step is the state the next begins from. Each worker has a database and a port of its own.
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "playwright/test";
import { adminDb, adminUrl, appUrl, migrateDatabase, recreateDatabase, requireEnv } from "../scripts/db/lib";
import { startServer } from "./assets-helpers";
import { CONSOLE_PATHS, runTool } from "./platform-admin-helpers";
import { completeOnboarding, hydrated, watchConsole } from "./saas";

const PASSWORD = "Correct-horse-9-battery";
let DATABASE = "climvia_p19c_empty";

test.describe.configure({ mode: "serial", timeout: 300_000 });

let server: { origin: string; stop: () => void };
let owner: ReturnType<typeof adminDb>;
let anon: APIRequestContext;

const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
const toolEnv = () => ({ DATABASE_ADMIN_URL: adminUrl(DATABASE), DATABASE_URL: appUrl(DATABASE) });
const rows = async (sql: string, values: unknown[] = []) => (await owner.pool.query(sql, values)).rows;
const count = async (table: string) => Number((await rows(`select count(*)::int as n from ${table}`))[0].n);
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

async function context(browser: Browser, viewport = { width: 1280, height: 900 }): Promise<BrowserContext> {
  // An empty session of its own: the project's signed-in state is for the other server's database and must not ride along (cookies are shared across ports).
  return browser.newContext({ baseURL: server.origin, viewport, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-forwarded-for": address() } });
}
async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  await hydrated(page).catch(() => undefined);
  return response;
}

/** The business the first user makes, and what they and the visitors do afterwards. */
const BUSINESS = `Firstday ${randomBytes(3).toString("hex")} Heating`;
const FIRST = { email: `first-${randomBytes(4).toString("hex")}@example.test`, name: "Pat Newcomer" };
const ADMIN = { email: `ops-${randomBytes(4).toString("hex")}@example.test`, name: "Ops Person" };
let owners: BrowserContext;
let ownerPage: Page;
let ownerProblems: string[];
let listingSlug = "";

test.beforeAll(async ({}, testInfo) => {
  DATABASE = `climvia_p19c_empty_w${testInfo.workerIndex}`;
  await recreateDatabase(DATABASE);
  await migrateDatabase(adminUrl(DATABASE), requireEnv("POSTGRES_APP_PASSWORD"));
  owner = adminDb(adminUrl(DATABASE));
  server = await startServer(3600 + (testInfo.workerIndex % 30), { DATABASE_URL: appUrl(DATABASE), DATABASE_ADMIN_URL: adminUrl(DATABASE) }, "/login");
  anon = await request.newContext({ baseURL: server.origin, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { origin: server.origin, "x-forwarded-for": address() } });
});

test.afterAll(async () => {
  await anon?.dispose();
  await owners?.close();
  server?.stop();
  await owner?.pool.end();
  const maintenance = new Pool({ connectionString: adminUrl("postgres"), max: 1 });
  try {
    await maintenance.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
  } finally {
    await maintenance.end();
  }
});

/* ───────────────────────────── day one, before anyone has signed up ───────────────────────────── */

test("a migrated database with nothing in it: the landing, the Marketplace and the doors work, and there is no administrator, listing or review", async () => {
  for (const table of ["auth_user", "organizations", "organization_memberships", "platform_admins", "marketplace_listings", "reviews", "review_requests", "bookings", "customers", "services", "sites"]) expect(await count(table), table).toBe(0);

  const landing = await anon.get("/");
  expect(landing.status()).toBe(200);
  expect(visibleText(await landing.text())).toContain("Find HVAC service. Run the business behind it.");
  const marketplace = await anon.get("/marketplace");
  expect(marketplace.status()).toBe(200);
  expect(visibleText(await marketplace.text())).toContain("No providers are listed yet");
  const sitemap = await (await anon.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`<loc>${server.origin}/</loc>`);
  expect(sitemap).not.toContain("/listings/");
  for (const path of ["/login", "/signup"]) expect((await anon.get(path)).status(), path).toBe(200);
  expect((await anon.get(`/review/${randomBytes(32).toString("base64url")}`)).status()).toBe(404);
  expect((await anon.get("/listings/anything")).status()).toBe(404);
  for (const path of CONSOLE_PATHS) expect((await anon.get(path, { maxRedirects: 0 })).status(), path).toBe(307);
  expect((await anon.get("/overview", { maxRedirects: 0 })).status()).toBe(307);
  // Nothing was made by looking.
  for (const table of ["auth_user", "organizations", "auth_session"]) expect(await count(table), table).toBe(0);
});

test("the first platform administrator: an ordinary account, made one only by the command-line tool, in through the console's own door, out when revoked", async ({ browser }) => {
  // Signing up with every kind of forged claim makes an ordinary account.
  const signup = await anon.post("/api/auth/sign-up/email", { data: { email: ADMIN.email, password: PASSWORD, name: ADMIN.name, role: "super_admin", platformAdmin: true, isPlatformAdmin: true, granted_via: "cli" } });
  expect(signup.ok(), await signup.text()).toBe(true);
  expect(await count("platform_admins")).toBe(0);
  expect(await count("organization_memberships")).toBe(0);

  const ctx = await context(browser);
  const page = await ctx.newPage();
  await visit(page, "/platform-admin/login");
  await page.getByLabel(/^Email/).fill(ADMIN.email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`${server.origin}/platform-admin`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  expect((await page.request.get("/platform-admin", { maxRedirects: 0 })).status()).toBe(404);

  const granted = runTool("grant", ["--email", ADMIN.email], toolEnv());
  expect(granted.code, granted.stderr).toBe(0);
  await visit(page, "/platform-admin");
  await expect(page.getByRole("heading", { level: 1, name: "Platform overview" })).toBeVisible();
  await expect(page.getByText("No business has signed up yet")).toBeVisible();
  await visit(page, "/platform-admin/organizations");
  await expect(page.getByText("No organizations yet")).toBeVisible();
  await visit(page, "/platform-admin/marketplace");
  await expect(page.getByText("No Marketplace listings yet")).toBeVisible();
  await visit(page, "/platform-admin/reviews");
  await expect(page.getByText("No reviews yet")).toBeVisible();

  const revoked = runTool("revoke", ["--email", ADMIN.email], toolEnv());
  expect(revoked.code, revoked.stderr).toBe(0);
  for (const path of CONSOLE_PATHS) expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  await ctx.close();
  expect((await rows("select action from platform_audit_events order by occurred_at, id")).map((row) => row.action)).toEqual(["platform_admin.granted", "platform_admin.revoked"]);
  // Granted again for the steps that need the console; the account is the same one and the history stays.
  expect(runTool("grant", ["--email", ADMIN.email], toolEnv()).code).toBe(0);
});

/* ───────────────────────────── the first business ───────────────────────────── */

test("a first owner: landing, List Your Business, sign up, set up, and a workspace with no sample record, no administrator and nothing public", async ({ browser }) => {
  owners = await context(browser);
  ownerPage = await owners.newPage();
  ownerProblems = watchConsole(ownerPage);
  await visit(ownerPage, "/");
  await expect(ownerPage.getByRole("heading", { level: 1, name: "Find HVAC service. Run the business behind it." })).toBeVisible();
  await ownerPage.getByRole("main").getByRole("link", { name: "List Your Business" }).first().click();
  await expect(ownerPage).toHaveURL(`${server.origin}/signup`);
  await hydrated(ownerPage);
  await ownerPage.getByLabel(/^Full name/).fill(FIRST.name);
  await ownerPage.getByLabel(/^Email/).fill(FIRST.email);
  await ownerPage.getByLabel(/^Password/).fill(PASSWORD);
  await ownerPage.getByRole("button", { name: "Create account" }).click();
  await expect(ownerPage).toHaveURL(`${server.origin}/onboarding`);
  await completeOnboarding(ownerPage, { name: BUSINESS });
  await expect(ownerPage).toHaveURL(`${server.origin}/overview`);

  // The new owner has one business and one role: owner. Nothing made them an administrator, and nothing was copied in.
  const person = (await rows("select id from auth_user where email = $1", [FIRST.email]))[0];
  expect(await rows("select role, status from organization_memberships where user_id = $1", [person.id])).toEqual([{ role: "owner", status: "active" }]);
  expect(await count("platform_admins where revoked_at is null")).toBe(1);
  expect((await rows("select count(*)::int as n from platform_admins where user_id = $1", [person.id]))[0].n).toBe(0);
  const org = (await rows("select id, name, fixture_set, slug from organizations"))[0];
  expect(org).toMatchObject({ name: BUSINESS, fixture_set: null });
  for (const table of ["customers", "services", "bookings", "jobs", "quotes", "invoices", "payments", "maintenance_plans", "reviews", "review_requests", "marketing_campaigns", "marketplace_listings", "site_domains"]) {
    expect(await count(`${table} where organization_id = '${org.id}'`), table).toBe(0);
  }
  // The one person on the Team is the owner themself: no colleague, no technician, nobody made up.
  expect(await rows("select user_id, name from team_members where organization_id = $1", [org.id])).toEqual([{ user_id: person.id, name: FIRST.name }]);
  expect(await rows("select count(*)::int as n from organizations where fixture_set is not null")).toEqual([{ n: 0 }]);
  expect(await rows("select count(*)::int as n from sites where organization_id = $1 and status = 'published'", [org.id])).toEqual([{ n: 0 }]);

  // The first screen is a welcome with things to do, not a report of numbers that do not exist.
  await expect(ownerPage.getByRole("heading", { level: 2, name: "Your workspace is ready" })).toBeVisible();
  const steps = ownerPage.getByRole("list", { name: "Next steps" });
  await expect(steps.getByRole("link")).toHaveCount(5);
  for (const [name, href] of [["Add your services", "/services"], ["Set up your team", "/team"], ["Check your business hours", "/settings/hours"], ["Customize your website", "/website"], ["Publish your Marketplace listing", "/marketplace-listing"]] as const) {
    await expect(steps.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
  }
  const text = await ownerPage.locator("main").innerText();
  expect(text).not.toMatch(/Apex|Northstar|Sarah Mitchell|Alex Morgan|NaN|undefined|\$\d/);
  expect(ownerProblems).toEqual([]);
  // The workspace is closed to the console, and the console to the owner.
  expect((await ownerPage.request.get("/platform-admin", { maxRedirects: 0 })).status()).toBe(404);
  // The Marketplace still has nobody on it.
  expect(visibleText(await (await anon.get("/marketplace")).text())).toContain("No providers are listed yet");
});

test("every workspace page of a business with nothing in it is a valid zero state: a heading, no sample record, no invented figure, no console error", async () => {
  const pages = ["/overview", "/bookings", "/schedule", "/jobs", "/customers", "/services", "/team", "/quotes-invoices", "/payments", "/maintenance-plans", "/website", "/marketplace-listing", "/reviews", "/marketing", "/analytics", "/settings"];
  for (const path of pages) {
    const response = await visit(ownerPage, path);
    expect(response?.status(), path).toBe(200);
    await expect(ownerPage.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
    const text = await ownerPage.locator("main").innerText();
    expect(text, path).not.toMatch(/Apex|Northstar|Sarah Mitchell|David Chen|Alex Morgan|Jamie Rivera|JB-204|BK-104\d|INV-\d{4}|QT-\d{4}/);
    expect(text, path).not.toMatch(/NaN|undefined|\[object|Infinity|null/);
    expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
  }
  expect(ownerProblems).toEqual([]);
  // Specific zero states a new owner should be able to act on.
  await visit(ownerPage, "/customers");
  await expect(ownerPage.getByText(/No customers yet|Add your first customer|no customers/i).first()).toBeVisible();
  await visit(ownerPage, "/reviews");
  await expect(ownerPage.getByText("No reviews yet")).toBeVisible();
  await expect(ownerPage.getByRole("list", { name: "Review requests" })).toHaveCount(0);
  await visit(ownerPage, "/marketplace-listing");
  await expect(ownerPage.getByRole("link", { name: "Set up listing" }).first()).toBeVisible();
});

test("the owner adds one Service, sets up the Marketplace with a place, publishes, and is found; a guest books; the business sees where it came from", async ({ browser }) => {
  // One Service, through the screen's own steps.
  await visit(ownerPage, "/services");
  await ownerPage.getByRole("button", { name: "Add service" }).first().click();
  const wizard = ownerPage.getByRole("dialog", { name: "Add new service" });
  await wizard.getByLabel("Service name").fill("Furnace Tune-Up");
  await wizard.getByLabel("Customer-facing description").fill("A yearly check of your furnace.");
  await wizard.getByRole("button", { name: /^Next: Booking/ }).click();
  await wizard.getByRole("radio", { name: /^Instant booking/ }).check();
  await wizard.getByRole("button", { name: /^Next: Pricing/ }).click();
  await wizard.getByLabel("Fee amount (USD)").or(wizard.getByLabel("Price (USD)")).fill("89");
  await wizard.getByRole("button", { name: /^Next: Availability/ }).click();
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  await wizard.getByRole("button", { name: "Add service" }).click();
  await expect(wizard).toBeHidden();
  await expect(ownerPage.getByRole("table", { name: "Services" }).locator("tbody tr")).toHaveCount(1);
  expect(await count("services")).toBe(1);

  // The Marketplace: set up, one place, publish.
  await visit(ownerPage, "/marketplace-listing/edit?setup=1");
  const areas = ownerPage.getByRole("region", { name: "Service areas" });
  await areas.getByLabel("City", { exact: true }).fill("Denver");
  await areas.getByLabel("State", { exact: true }).selectOption("CO");
  await areas.getByRole("button", { name: "Add area" }).click();
  await ownerPage.getByRole("button", { name: "Save & publish listing" }).click();
  await expect(ownerPage.locator('div[role="status"]').filter({ hasText: "Marketplace listing published." })).toBeVisible();
  const listing = (await rows("select id, public_slug, status from marketplace_listings"))[0];
  expect(listing.status).toBe("published");
  listingSlug = listing.public_slug;
  expect(await count("marketplace_service_areas")).toBe(1);

  // A visitor finds it by what it offers and where, and nothing else is on the Marketplace.
  const visitor = await context(browser);
  const page = await visitor.newPage();
  await visit(page, `/marketplace?q=furnace&location=denver-co`);
  await expect(page.getByRole("heading", { level: 2, name: "1 provider" })).toBeVisible();
  const card = page.getByRole("article", { name: BUSINESS });
  await expect(card).toContainText("Furnace Tune-Up");
  await expect(card).toContainText("No reviews yet");
  expect(visibleText(await (await anon.get("/sitemap.xml")).text())).toContain(`/listings/${listingSlug}`);

  // A guest books the Service from the profile.
  await card.getByRole("link", { name: BUSINESS, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/listings/${listingSlug}`));
  await expect(page.getByRole("link", { name: "List your business" }).first()).toBeVisible();
  await visit(page, `/listings/${listingSlug}/book/furnace-tune-up`);
  const weekday = (() => {
    const date = new Date(Date.now() + 4 * 86_400_000);
    while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  })();
  await page.getByLabel("Date", { exact: true }).fill(weekday);
  await page.getByRole("radio", { name: /^11:30 AM/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/^Full name/).fill("Jordan Visitor");
  await page.getByLabel(/^Phone number/).fill("(303) 555-0142");
  await page.getByLabel(/^Email address/).fill("jordan.visitor@example.test");
  await page.getByLabel(/^Service address/).fill("5 Aspen Way, Denver, CO 80203");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
  const booking = (await rows("select b.status, b.source, b.contact_name, c.name as customer_name, b.marketplace_listing_id from bookings b left join customers c on c.organization_id = b.organization_id and c.id = b.customer_id"))[0];
  // The guest became the business's first customer (drizzle/0030), with nobody having imported or added one.
  expect(booking).toMatchObject({ status: "confirmed", source: "Marketplace", contact_name: null, customer_name: "Jordan Visitor", marketplace_listing_id: listing.id });
  expect(await count("customers")).toBe(1);
  await visitor.close();

  // The business sees it, and where it came from.
  await visit(ownerPage, "/bookings?tab=upcoming");
  const bookingRow = ownerPage.getByRole("table", { name: "Upcoming bookings" }).locator("tbody tr", { hasText: "Jordan Visitor" });
  await expect(bookingRow).toContainText("Furnace Tune-Up");
  await expect(bookingRow).toContainText("Marketplace");
  await visit(ownerPage, "/marketplace-listing");
  await expect(ownerPage.getByText("Marketplace bookings").first()).toBeVisible();
  expect(ownerProblems).toEqual([]);
});

/* ───────────────────────────── reviews, and the platform's hand on them ───────────────────────────── */

test("a customer reviews through a link and chooses; the rating follows; the administrator hides and restores; both choices behave", async ({ browser }) => {
  // The business has two customers and nobody imported either: the guest who booked (made a customer by the booking itself), and one it adds by hand here.
  await visit(ownerPage, "/customers");
  await ownerPage.getByRole("button", { name: "Add customer" }).click();
  const adding = ownerPage.getByRole("dialog", { name: "Add customer" });
  await adding.getByLabel(/^Full name/).fill("Maya Singh");
  await adding.getByLabel("Email address").fill("maya.singh@example.test");
  await adding.getByLabel("Phone number").fill("(303) 555-0177");
  await adding.getByRole("button", { name: "Add customer" }).click();
  await expect(ownerPage).toHaveURL(/\/customers\/maya-singh$/);
  await expect(ownerPage.getByRole("heading", { level: 1, name: "Maya Singh" })).toBeVisible();
  expect((await rows("select name from customers order by position")).map((row) => row.name)).toEqual(["Jordan Visitor", "Maya Singh"]);

  // The business asks each of them, through its own screen, and is given each link once.
  const ask = async (name: string) => {
    await visit(ownerPage, "/reviews");
    await ownerPage.getByRole("button", { name: "Request review" }).first().click();
    const dialog = ownerPage.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel("Customer").selectOption({ label: name });
    await dialog.getByRole("button", { name: "Send review request" }).click();
    const ready = ownerPage.getByRole("dialog", { name: "Review link ready" });
    const given = await ready.getByLabel("Review link").inputValue();
    expect(given).toMatch(new RegExp(`^${server.origin.replace(/[.]/g, "\\.")}/review/[A-Za-z0-9_-]{43}$`));
    await ready.getByRole("button", { name: "Done" }).click();
    return given;
  };
  const link = await ask("Maya Singh");
  const secondLink = await ask("Jordan Visitor");

  // The first customer says yes; the second keeps theirs private.
  const guest = await context(browser);
  const page = await guest.newPage();
  const rate = (stars: number) => page.getByLabel(`${stars} ${stars === 1 ? "star" : "stars"}`).check({ force: true });
  await visit(page, new URL(link).pathname);
  await rate(5);
  await page.getByLabel("Your review").fill("Showed up on time and fixed the furnace.");
  await expect(page.getByRole("checkbox", { name: /may show my review/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /may show my review/ }).check();
  await page.getByRole("button", { name: "Send review" }).click();
  await expect(page.getByText("Thank you. Your review was sent.")).toBeVisible();
  await visit(page, new URL(secondLink).pathname);
  await rate(2);
  await page.getByLabel("Your review").fill("It took two visits.");
  await page.getByRole("button", { name: "Send review" }).click();
  await expect(page.getByText(/You kept your review private/)).toBeVisible();
  expect(await rows("select rating, visibility from reviews order by rating")).toEqual([{ rating: 2, visibility: "private" }, { rating: 5, visibility: "public" }]);

  // The Marketplace counts only the public one.
  await visit(page, `/marketplace?q=${encodeURIComponent(BUSINESS.split(" ")[1])}`);
  await expect(page.getByRole("article", { name: BUSINESS })).toContainText("5.0 · 1 review");
  await visit(page, `/listings/${listingSlug}`);
  expect(await page.locator("main").innerText()).toContain("Showed up on time and fixed the furnace.");
  expect(await page.locator("main").innerText()).not.toContain("It took two visits.");
  expect(await page.locator("main").innerText()).toContain("Maya S.");

  // The administrator hides it, the rating goes, and restoring brings it back.
  const consoleContext = await context(browser);
  const console = await consoleContext.newPage();
  await visit(console, "/platform-admin/login");
  await console.getByLabel(/^Email/).fill(ADMIN.email);
  await console.getByLabel(/^Password/).fill(PASSWORD);
  await console.getByRole("button", { name: "Log in" }).click();
  await console.waitForURL(`${server.origin}/platform-admin`);
  await visit(console, "/platform-admin/reviews");
  const target = console.getByRole("row").filter({ hasText: "Showed up on time" });
  await target.getByText("Hide from Marketplace…").click();
  await target.getByRole("button", { name: "Hide review" }).click();
  await expect(console.getByRole("status").filter({ hasText: "The review is hidden from the Marketplace." })).toBeVisible();
  await visit(page, `/marketplace?q=${encodeURIComponent(BUSINESS.split(" ")[1])}`);
  await expect(page.getByRole("article", { name: BUSINESS })).toContainText("No reviews yet");
  await visit(page, `/listings/${listingSlug}`);
  expect(await page.locator("main").innerText()).not.toContain("Showed up on time");
  await visit(console, "/platform-admin/reviews?visibility=hidden");
  await console.getByRole("button", { name: "Restore" }).click();
  await expect(console.getByRole("status").filter({ hasText: "The review is shown on the Marketplace again" })).toBeVisible();
  await visit(page, `/marketplace?q=${encodeURIComponent(BUSINESS.split(" ")[1])}`);
  await expect(page.getByRole("article", { name: BUSINESS })).toContainText("5.0 · 1 review");
  expect((await rows("select action from platform_audit_events where target_kind = 'review' order by occurred_at, id")).map((row) => row.action)).toEqual(["review.hidden", "review.restored"]);
  await guest.close();
  await consoleContext.close();
});

test("the administrator suspends the listing; the business reads why and asks again; the administrator answers; the listing comes back only when allowed", async ({ browser }) => {
  const consoleContext = await context(browser);
  const console = await consoleContext.newPage();
  await visit(console, "/platform-admin/login");
  await console.getByLabel(/^Email/).fill(ADMIN.email);
  await console.getByLabel(/^Password/).fill(PASSWORD);
  await console.getByRole("button", { name: "Log in" }).click();
  await console.waitForURL(`${server.origin}/platform-admin`);
  await visit(console, "/platform-admin/marketplace");
  const row = console.getByRole("row").filter({ hasText: BUSINESS });
  await row.getByText("Suspend…").click();
  await row.getByLabel("Internal reason (optional)").fill("INTERNAL-FIRSTDAY");
  await row.getByLabel("Message to the business (optional)").fill("Please add the places you serve.");
  await row.getByRole("button", { name: "Suspend listing" }).click();
  await expect(console.getByRole("status").filter({ hasText: "The listing is suspended." })).toBeVisible();

  const visitor = await anon.get(`/listings/${listingSlug}`, { maxRedirects: 0 });
  expect(visitor.status()).toBe(404);
  expect(visibleText(await (await anon.get("/marketplace")).text())).toContain("No providers are listed yet");
  expect(await (await anon.get("/sitemap.xml")).text()).not.toContain("/listings/");

  await visit(ownerPage, "/marketplace-listing");
  const notice = ownerPage.getByRole("status").filter({ hasText: "Climvia has suspended your Marketplace listing" });
  await expect(notice).toContainText("Please add the places you serve.");
  expect(await ownerPage.content()).not.toContain("INTERNAL-FIRSTDAY");
  await ownerPage.getByLabel(/Ask Climvia to review this suspension/).fill("Added Denver and Aurora.");
  await ownerPage.getByRole("button", { name: "Ask Climvia to review" }).click();
  await expect(notice).toContainText("You asked Climvia to review this suspension");

  await visit(console, "/platform-admin/marketplace");
  await expect(console.getByRole("row").filter({ hasText: BUSINESS })).toContainText("Review requested");
  await console.getByRole("row").filter({ hasText: BUSINESS }).getByRole("button", { name: "Allow again" }).click();
  await expect(console.getByRole("status").filter({ hasText: "The listing is allowed again." })).toBeVisible();
  expect((await anon.get(`/listings/${listingSlug}`, { maxRedirects: 0 })).status()).toBe(200);
  await visit(ownerPage, "/marketplace-listing");
  await expect(ownerPage.getByRole("status").filter({ hasText: "Climvia has suspended your Marketplace listing" })).toHaveCount(0);
  expect((await rows("select action from platform_audit_events where target_kind = 'marketplace_listing' order by occurred_at, id")).map((row) => row.action)).toEqual([
    "marketplace_listing.suspended",
    "marketplace_listing.review_requested",
    "marketplace_listing.unsuspended",
    "marketplace_listing.review_resolved",
  ]);
  await consoleContext.close();
  expect(ownerProblems).toEqual([]);
});

test("signing out, from the workspace, ends the owner's session everywhere and leaves the Marketplace open", async () => {
  await visit(ownerPage, "/overview");
  await ownerPage.getByRole("button", { name: /Alex|Pat|account|profile/i }).first().click().catch(() => undefined);
  const logout = ownerPage.getByRole("menuitem", { name: "Log out" }).or(ownerPage.getByRole("button", { name: "Log out" }));
  await logout.first().click();
  await expect(ownerPage).toHaveURL(`${server.origin}/login`);
  for (const path of ["/overview", "/customers", "/platform-admin"]) {
    const response = await ownerPage.request.get(path, { maxRedirects: 0 });
    expect([307, 404], path).toContain(response.status());
  }
  expect((await ownerPage.request.get("/marketplace")).status()).toBe(200);
  expect(await (await ownerPage.request.get("/api/session-state")).json()).toEqual({ signedIn: false, workspace: false, platformAdmin: false });
});
