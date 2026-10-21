/**
 * Docker side, part 7: the first business goes public, through the real proxy and the real image, on the production database that was empty at the start.
 *
 *   - the owner (the first person ever to sign up) signs in again, sets the Marketplace up with one place, publishes, and is FOUND by a visitor;
 *   - guests book from the profile and each booking carries where it came from (the Marketplace, the listing, and what the visitor had searched for);
 *   - the owner asks the three guests for a review: each became the business's customer by booking (nobody imported or added them), and each link is a
 *     secret shown once, stored only as its SHA-256, good for thirty days and for one use;
 *   - a customer's consent is a box that starts unchecked: only a yes makes a review public, and the rating counts only public reviews;
 *   - a platform administrator (made one only by the command-line tool) hides and restores a review and the rating follows, suspends the listing, and the
 *     listing is gone from search, profile, booking page and sitemap; the business reads the message (never the internal reason) and asks again, and ASKING
 *     DOES NOT LIFT IT; only the administrator's answer does;
 *   - revoking the administrator closes the console at the next request;
 *   - no review link's secret is in the proxy's log or the application's.
 *
 * What it leaves (a published listing, three Marketplace bookings, reviews, an audit trail, one link nobody used) is what the backup drill (08) and the
 * restart tests (09) protect.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "playwright/test";
import { PASSWORD, signUp, waitsForHydration } from "../e2e/saas";
import { compose, composeResult, get, one, sql, stack } from "./stack";

test.describe.configure({ mode: "serial", timeout: 240_000 });

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const secretOf = (link: string) => link.split("/").pop() ?? "";

let state: { email: string; business: string; slug: string };
let owner: BrowserContext;
let ownerPage: Page;
let listing = { id: "", slug: "" };
let adminEmail = "";
let since = "";
const links: string[] = [];

const GUESTS = [
  { name: "Jordan Finder", email: "jordan.finder@example.test", phone: "(303) 555-0142" },
  { name: "Maya Singh", email: "maya.singh@example.test", phone: "(303) 555-0143" },
  { name: "Chris Young", email: "chris.young@example.test", phone: "(303) 555-0144" },
];

const grant = (address: string) => composeResult("run", "--rm", "migrate", "npm", "run", "platform-admin:grant", "--", "--email", address);
const revoke = (address: string) => composeResult("run", "--rm", "migrate", "npm", "run", "platform-admin:revoke", "--", "--email", address);
const asText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

/** A fresh browser session on the stack (nothing carried over from any other). */
async function session(browser: import("playwright/test").Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: stack.origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  return { context, page: waitsForHydration(await context.newPage()) };
}

/** The next weekdays after today, distinct, so each guest books a day of their own. */
function weekdays(count: number): string[] {
  const days: string[] = [];
  const date = new Date(Date.now() + 3 * 86_400_000);
  while (days.length < count) {
    if (![0, 6].includes(date.getUTCDay())) days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

async function bookAs(page: Page, guest: (typeof GUESTS)[number], day: string) {
  await page.getByLabel("Date", { exact: true }).fill(day);
  await page.getByRole("radio", { name: /^11:30 AM/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/^Full name/).fill(guest.name);
  await page.getByLabel(/^Phone number/).fill(guest.phone);
  await page.getByLabel(/^Email address/).fill(guest.email);
  await page.getByLabel(/^Service address/).fill("5 Aspen Way, Denver, CO 80203");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
}

const marketplaceCard = (page: Page) => page.getByRole("article", { name: state.business });

/**
 * Sign-in is rate limited per client address (three in ten seconds, and everything here reaches the stack from one address), so a person signing in right
 * after others is told to wait, which is the limit working. The journey waits out the window rather than meeting it.
 */
let lastAuth = 0;
async function outsideTheWindow() {
  const wait = 10_500 - (Date.now() - lastAuth);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastAuth = Date.now();
}

/** Sign in to the console's own door, and say what the page says if it does not open. */
async function signInToConsole(page: Page) {
  await outsideTheWindow();
  await page.goto("/platform-admin/login");
  await page.getByLabel(/^Email/).fill(adminEmail);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/platform-admin$/, { timeout: 15_000 }).catch(async () => {
    throw new Error(`the console did not open for the administrator; the page says: ${(await page.locator("[role=alert], [role=status]").allInnerTexts()).join(" | ") || "nothing"}`);
  });
}

test.beforeAll(async ({ browser }) => {
  state = JSON.parse(readFileSync(".data/docker-state.json", "utf8"));
  since = new Date(Date.now() - 5000).toISOString();
  ({ context: owner, page: ownerPage } = await session(browser));
});
test.afterAll(async () => {
  await owner.close();
});

test("the owner signs in again with the real form and finds the workspace, with the Marketplace still empty of them", async () => {
  await outsideTheWindow();
  await ownerPage.goto("/login");
  await ownerPage.getByLabel(/^Email/).fill(state.email);
  await ownerPage.getByLabel(/^Password/).fill(PASSWORD);
  await ownerPage.getByRole("button", { name: "Log in" }).click();
  await expect(ownerPage).toHaveURL(/\/overview$/);
  expect(Number(one("select count(*) from marketplace_listings"))).toBe(0);
  expect(asText((await get(stack.publicHost, "/marketplace")).body)).toContain("No providers are listed yet");
});

test("the owner sets the Marketplace up with a place, publishes, and a visitor finds the business by what it offers and where", async ({ browser }) => {
  await ownerPage.goto("/marketplace-listing/edit?setup=1");
  const areas = ownerPage.getByRole("region", { name: "Service areas" });
  await areas.getByLabel("City", { exact: true }).fill("Denver");
  await areas.getByLabel("State", { exact: true }).selectOption("CO");
  await areas.getByRole("button", { name: "Add area" }).click();
  await ownerPage.getByRole("button", { name: "Save & publish listing" }).click();
  await expect(ownerPage.locator('div[role="status"]').filter({ hasText: "Marketplace listing published." })).toBeVisible();
  const row = sql("select id, public_slug, status from marketplace_listings")[0];
  expect(row[2]).toBe("published");
  listing = { id: row[0], slug: row[1] };
  expect(Number(one("select count(*) from marketplace_service_areas"))).toBe(1);

  const visitor = await session(browser);
  await visitor.page.goto("/marketplace/services/docker-tune-up/denver-co");
  await expect(visitor.page.getByRole("heading", { level: 2, name: "1 provider" })).toBeVisible();
  await expect(marketplaceCard(visitor.page)).toContainText("Docker Tune-up");
  await expect(marketplaceCard(visitor.page)).toContainText("No reviews yet");
  expect((await get(stack.publicHost, "/sitemap.xml")).body).toContain(`${stack.origin}/listings/${listing.slug}`);
  await visitor.context.close();
});

test("guests book from the profile and every booking says where it came from: the Marketplace, the listing, and what the visitor had searched for", async ({ browser }) => {
  const days = weekdays(GUESTS.length);
  for (const [index, guest] of GUESTS.entries()) {
    const visitor = await session(browser);
    const page = visitor.page;
    if (index === 0) {
      // Found through the search, then through the card to the profile and the Service: the search travels with the visitor.
      await page.goto("/marketplace/services/docker-tune-up/denver-co");
      await marketplaceCard(page).getByRole("link", { name: state.business, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/listings/${listing.slug}`));
      await expect(page.getByRole("link", { name: "List your business" }).first()).toBeVisible();
      await page.locator(`a[href*="/listings/${listing.slug}/book/docker-tune-up"]`).first().click();
    } else {
      await page.goto(`/listings/${listing.slug}/book/docker-tune-up`);
    }
    await bookAs(page, guest, days[index]);
    await visitor.context.close();
  }
  // Each guest became the business's customer by booking: the booking is theirs and carries no contact name of its own.
  const rows = sql("select coalesce(c.name, b.contact_name), b.source, (b.marketplace_listing_id is not null), coalesce(b.discovery_service, ''), coalesce(b.discovery_location, '') from bookings b left join customers c on c.organization_id = b.organization_id and c.id = b.customer_id where b.source = 'Marketplace' order by b.created_at");
  expect(rows.map((row) => row[0])).toEqual(GUESTS.map((guest) => guest.name));
  for (const row of rows) expect([row[1], row[2]]).toEqual(["Marketplace", "t"]);
  expect(one(`select count(*) from bookings where marketplace_listing_id = '${listing.id}'`)).toBe("3");
  // The one that came through the search remembers it; one that arrived at the profile's own address does not make anything up.
  expect([rows[0][3], rows[0][4]]).toEqual(["docker-tune-up", "denver-co"]);
  expect([rows[1][3], rows[1][4]]).toEqual(["", ""]);

  await ownerPage.goto("/bookings?tab=upcoming");
  const table = ownerPage.getByRole("table", { name: "Upcoming bookings" });
  for (const guest of GUESTS) await expect(table.locator("tbody tr", { hasText: guest.name })).toContainText("Marketplace");
});

test("the owner asks the three guests for a review: each link is shown once, is a 256-bit secret stored only as its SHA-256, and lasts thirty days", async () => {
  // Nobody imported anyone: each guest is the business's customer because they booked, once, with the booking pointing at them and carrying nothing of its own.
  for (const guest of GUESTS) {
    expect(sql(`select c.name, c.phone, count(b.id) from customers c join bookings b on b.organization_id = c.organization_id and b.customer_id = c.id where c.email_key = '${guest.email}' group by c.name, c.phone`)).toEqual([[guest.name, guest.phone, "1"]]);
  }
  expect(Number(one(`select count(*) from customers where email_key in (${GUESTS.map((guest) => `'${guest.email}'`).join(", ")})`))).toBe(GUESTS.length);
  await ownerPage.goto("/customers");
  for (const guest of GUESTS) await expect(ownerPage.getByRole("table", { name: "Customers" }).locator("tbody tr", { hasText: guest.name })).toBeVisible();
  await ownerPage.goto("/reviews");
  for (const guest of GUESTS) {
    await ownerPage.getByRole("button", { name: "Request review" }).first().click();
    const dialog = ownerPage.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel("Customer").selectOption({ label: guest.name });
    await dialog.getByRole("button", { name: "Send review request" }).click();
    const ready = ownerPage.getByRole("dialog", { name: "Review link ready" });
    const link = await ready.getByLabel("Review link").inputValue();
    expect(link).toMatch(new RegExp(`^${stack.origin.replace(/[.]/g, "\\.")}/review/[A-Za-z0-9_-]{43}$`));
    links.push(link);
    await ready.getByRole("button", { name: "Done" }).click();
    await expect(ready).toBeHidden();
  }
  expect(new Set(links).size).toBe(3);
  for (const link of links) {
    const secret = secretOf(link);
    expect(sql(`select count(*) from review_requests where token_hash = '${sha256(secret)}'`)).toEqual([["1"]]);
    // The secret itself is nowhere in the table, in any column.
    expect(Number(one(`select count(*) from review_requests r where r::text like '%${secret}%'`))).toBe(0);
  }
  const days = sql("select round(extract(epoch from (expires_at - requested_at)) / 86400, 1) from review_requests");
  expect(days.map((row) => Number(row[0]))).toEqual([30, 30, 30]);
  // The business sees its requests and where each link stands, but never a link again.
  const requests = ownerPage.getByRole("list", { name: "Review requests" });
  await expect(requests.getByText("Link active")).toHaveCount(3);
  expect(await ownerPage.content()).not.toContain(secretOf(links[0]));
});

test("a customer's consent is a box that starts unchecked: a yes makes the review public, anything else keeps it private, and a link works once", async ({ browser }) => {
  const rate = (page: Page, stars: number) => page.getByLabel(`${stars} ${stars === 1 ? "star" : "stars"}`).check({ force: true });

  const yes = await session(browser);
  await yes.page.goto(new URL(links[0]).pathname);
  await rate(yes.page, 5);
  await yes.page.getByLabel("Your review").fill("Showed up on time and tuned the furnace.");
  await expect(yes.page.getByRole("checkbox", { name: /may show my review/ })).not.toBeChecked();
  await yes.page.getByRole("checkbox", { name: /may show my review/ }).check();
  await yes.page.getByRole("button", { name: "Send review" }).click();
  await expect(yes.page.getByText("Thank you. Your review was sent.")).toBeVisible();

  const no = await session(browser);
  await no.page.goto(new URL(links[1]).pathname);
  await rate(no.page, 2);
  await no.page.getByLabel("Your review").fill("It took two visits.");
  await no.page.getByRole("button", { name: "Send review" }).click();
  await expect(no.page.getByText(/You kept your review private/)).toBeVisible();

  expect(sql("select rating, visibility from reviews order by rating")).toEqual([["2", "private"], ["5", "public"]]);
  // A used link is used: it shows that, and a second answer from it writes nothing.
  for (const used of [yes, no]) {
    await used.page.goto(new URL(links[used === yes ? 0 : 1]).pathname);
    await expect(used.page.getByRole("heading", { name: "This review has already been sent" })).toBeVisible();
  }
  expect(Number(one("select count(*) from reviews"))).toBe(2);
  expect(sql("select count(*) from review_requests where status = 'completed'")).toEqual([["2"]]);
  await yes.context.close();
  await no.context.close();

  // The link nobody has opened is still open, and the review page it leads to is not indexed, cached or sent on.
  const open = await get(stack.publicHost, new URL(links[2]).pathname);
  expect(open.status).toBe(200);
  expect(open.body).toMatch(/noindex/);
  expect(String(open.headers["cache-control"])).toMatch(/no-store|no-cache|private/);
  expect(open.body).toContain('name="referrer" content="no-referrer"');
});

test("the Marketplace counts only the public review, under a first name and last initial, and never shows the private one", async ({ browser }) => {
  const visitor = await session(browser);
  await visitor.page.goto("/marketplace/services/docker-tune-up/denver-co");
  await expect(marketplaceCard(visitor.page)).toContainText("5.0 · 1 review");
  await visitor.page.goto(`/listings/${listing.slug}`);
  const text = await visitor.page.locator("main").innerText();
  expect(text).toContain("Showed up on time and tuned the furnace.");
  expect(text).toContain("Jordan F.");
  expect(text).not.toContain("It took two visits.");
  expect(text).not.toContain("Maya");
  await visitor.context.close();
});

test("an ordinary account is made an administrator only by the command-line tool, and the console is theirs only while it lasts", async ({ browser }) => {
  const person = await session(browser);
  await outsideTheWindow();
  adminEmail = await signUp(person.page, { name: "Ops Person" });
  expect(Number(one(`select count(*) from platform_admins a join auth_user u on u.id = a.user_id where u.email = '${adminEmail}'`))).toBe(0);
  await person.page.goto("/platform-admin");
  await expect(person.page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  const granted = grant(adminEmail);
  expect(granted.code, granted.out).toBe(0);
  await person.context.close();
});

test("the administrator hides the public review and the rating follows; restoring it brings the rating back; the business keeps the review throughout", async ({ browser }) => {
  const admin = await session(browser);
  const console = admin.page;
  await signInToConsole(console);

  await console.goto("/platform-admin/reviews");
  const target = console.getByRole("row").filter({ hasText: "Showed up on time" });
  await target.getByText("Hide from Marketplace…").click();
  await target.getByLabel("Internal reason (optional)").fill("INTERNAL-REVIEW-REASON");
  await target.getByRole("button", { name: "Hide review" }).click();
  await expect(console.getByRole("status").filter({ hasText: "The review is hidden from the Marketplace." })).toBeVisible();

  const visitor = await session(browser);
  await visitor.page.goto("/marketplace/services/docker-tune-up/denver-co");
  await expect(marketplaceCard(visitor.page)).toContainText("No reviews yet");
  await visitor.page.goto(`/listings/${listing.slug}`);
  expect(await visitor.page.locator("main").innerText()).not.toContain("Showed up on time");
  expect(await visitor.page.content()).not.toContain("INTERNAL-REVIEW-REASON");
  // The business still has it (and is told which one is hidden, not why).
  await ownerPage.goto("/reviews");
  await expect(ownerPage.locator("main")).toContainText("Showed up on time");
  await expect(ownerPage.locator("main")).toContainText("Hidden from Marketplace by Climvia");
  expect(await ownerPage.content()).not.toContain("INTERNAL-REVIEW-REASON");
  expect(Number(one("select count(*) from reviews"))).toBe(2);

  await console.goto("/platform-admin/reviews?visibility=hidden");
  await console.getByRole("button", { name: "Restore" }).click();
  await expect(console.getByRole("status").filter({ hasText: "The review is shown on the Marketplace again" })).toBeVisible();
  await visitor.page.goto("/marketplace/services/docker-tune-up/denver-co");
  await expect(marketplaceCard(visitor.page)).toContainText("5.0 · 1 review");
  await visitor.context.close();
  await admin.context.close();
});

test("a suspended listing disappears from search, profile, booking page and sitemap; the business reads the message, asks again, and asking does not lift it", async ({ browser }) => {
  const admin = await session(browser);
  const console = admin.page;
  await signInToConsole(console);
  await console.goto("/platform-admin/marketplace");
  const row = console.getByRole("row").filter({ hasText: state.business });
  await row.getByText("Suspend…").click();
  await row.getByLabel("Internal reason (optional)").fill("INTERNAL-SUSPENSION-REASON");
  await row.getByLabel("Message to the business (optional)").fill("Please add the places you serve.");
  await row.getByRole("button", { name: "Suspend listing" }).click();
  await expect(console.getByRole("status").filter({ hasText: "The listing is suspended." })).toBeVisible();

  const gone = async () => {
    expect((await get(stack.publicHost, `/listings/${listing.slug}`)).status).toBe(404);
    expect((await get(stack.publicHost, `/listings/${listing.slug}/book/docker-tune-up`)).status).toBe(404);
    expect(asText((await get(stack.publicHost, "/marketplace/services/docker-tune-up/denver-co")).body)).not.toContain(state.business);
    expect(asText((await get(stack.publicHost, "/marketplace")).body)).toContain("No providers are listed yet");
    expect((await get(stack.publicHost, "/sitemap.xml")).body).not.toContain("/listings/");
  };
  await gone();

  await ownerPage.goto("/marketplace-listing");
  const notice = ownerPage.getByRole("status").filter({ hasText: "Climvia has suspended your Marketplace listing" });
  await expect(notice).toContainText("Please add the places you serve.");
  expect(await ownerPage.content()).not.toContain("INTERNAL-SUSPENSION-REASON");
  await ownerPage.getByLabel(/Ask Climvia to review this suspension/).fill("Added Denver and Aurora.");
  await ownerPage.getByRole("button", { name: "Ask Climvia to review" }).click();
  await expect(notice).toContainText("You asked Climvia to review this suspension");
  // The business asked; it did not lift anything. Only the platform's answer does.
  await gone();
  expect(sql("select state, review_state from platform_listing_moderation")).toEqual([["suspended", "requested"]]);
  // And the business cannot publish its way out of it either: hiding its listing and publishing it again leaves the suspension where it was.
  await ownerPage.goto("/marketplace-listing/edit");
  await ownerPage.getByRole("button", { name: "Hide listing" }).first().click();
  await ownerPage.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Hide listing" }).click();
  await expect.poll(() => one("select status from marketplace_listings")).toBe("hidden");
  await ownerPage.getByRole("button", { name: "Publish listing" }).first().click();
  await expect.poll(() => one("select status from marketplace_listings")).toBe("published");
  await gone();
  expect(sql("select state, review_state from platform_listing_moderation")).toEqual([["suspended", "requested"]]);

  await console.goto("/platform-admin/marketplace");
  await expect(console.getByRole("row").filter({ hasText: state.business })).toContainText("Review requested");
  await console.getByRole("row").filter({ hasText: state.business }).getByRole("button", { name: "Allow again" }).click();
  await expect(console.getByRole("status").filter({ hasText: "The listing is allowed again." })).toBeVisible();
  expect((await get(stack.publicHost, `/listings/${listing.slug}`)).status).toBe(200);
  expect((await get(stack.publicHost, `/listings/${listing.slug}/book/docker-tune-up`)).status).toBe(200);
  expect((await get(stack.publicHost, "/sitemap.xml")).body).toContain(`/listings/${listing.slug}`);
  await ownerPage.goto("/marketplace-listing");
  await expect(ownerPage.getByRole("status").filter({ hasText: "Climvia has suspended your Marketplace listing" })).toHaveCount(0);
  await admin.context.close();
});

test("revoking the administrator closes the console at the next request, and every step is on the audit trail", async () => {
  const revoked = revoke(adminEmail);
  expect(revoked.code, revoked.out).toBe(0);
  const fresh = await get(stack.publicHost, "/platform-admin/marketplace");
  expect(fresh.status).toBe(307);
  const actions = sql("select action from platform_audit_events order by occurred_at, id").map((row) => row[0]);
  for (const expected of ["platform_admin.granted", "review.hidden", "review.restored", "marketplace_listing.suspended", "marketplace_listing.review_requested", "marketplace_listing.unsuspended", "marketplace_listing.review_resolved", "platform_admin.revoked"]) {
    expect(actions, expected).toContain(expected);
  }
  expect(actions.at(-1)).toBe("platform_admin.revoked");
});

test("no review link's secret is in the proxy's log or the application's, and the proxy wrote the address as REDACTED", async () => {
  // Everything written since this part began: every page the owner, the customers and the administrator opened, with the headers their browsers sent.
  const proxy = compose("logs", "--no-log-prefix", "--since", since, "proxy");
  const app = compose("logs", "--no-log-prefix", "--since", since, "app");
  for (const link of links) {
    const secret = secretOf(link);
    expect(proxy, "the proxy's log").not.toContain(secret);
    expect(app, "the application's log").not.toContain(secret);
  }
  expect(proxy).toContain("/review/REDACTED");
});

test("what this leaves for the backup drill and the restart tests", async () => {
  expect(sql("select status from marketplace_listings")).toEqual([["published"]]);
  writeFileSync(".data/docker-release.json", JSON.stringify({ listingId: listing.id, listingSlug: listing.slug, adminEmail, usedLinks: [links[0], links[1]], activeLink: links[2] }));
  expect(Number(one("select count(*) from platform_audit_events"))).toBeGreaterThanOrEqual(8);
});
