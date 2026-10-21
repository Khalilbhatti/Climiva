/**
 * Phase 19E, customers as people meet them: a business adds a customer by hand, and a guest's booking makes (or finds) the business's customer, so a new
 * business can ask for a review without anyone importing a record.
 *
 * Every test makes its own business, so every count asserted is exact. The rule that matches a booking to a customer is held at the database
 * (customer-acquisition-database.spec.ts); this file holds what a person sees, and what the Add customer action does when it is asked wrongly.
 */
import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Locator, Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { anonymous, makeBusiness, signedIn } from "./assets-helpers";
import { freshPhone } from "./booking-people";
import { makeProvider, SAMPLE_SERVICES } from "./marketplace-helpers";
import { makePlatformAdmin } from "./platform-admin-helpers";
import { captureAction, replay, withFirstArgument } from "./replay";
import { NOT_SIGNED_IN, ORIGIN, expect, expectAccessible, hydrated, test } from "./saas";

test.describe.configure({ timeout: 180_000 });

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

const handles = () => ({ db: owner.db, pool: owner.pool });
const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
const token = () => randomBytes(3).toString("hex");

async function openAs(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const where = address();
  const state = await (await signedIn(email, where)).storageState();
  const context = await browser.newContext({ storageState: state, extraHTTPHeaders: { "x-forwarded-for": where } });
  return { context, page: await context.newPage() };
}

async function openAnonymous(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": address() } });
  return { context, page: await context.newPage() };
}

const customersOf = async (organizationId: string) =>
  (await owner.pool.query<{ slug: string; name: string; phone: string | null; email: string | null; preferred_contact: string }>("select slug, name, phone, email, preferred_contact from customers where organization_id = $1 order by position", [organizationId])).rows;

/** Distinct weekdays, from four days ahead, in the real calendar (a business made by a test has no fixed clock). */
function weekdays(count: number): string[] {
  const days: string[] = [];
  const date = new Date(Date.now() + 4 * 86_400_000);
  while (days.length < count) {
    if (![0, 6].includes(date.getUTCDay())) days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

/** A guest books the instant Service on a provider's profile. */
async function bookAsGuest(page: Page, listingSlug: string, guest: { name: string; phone: string; email: string }, day: string) {
  await page.goto(`/listings/${listingSlug}/book/${SAMPLE_SERVICES.tuneUp}`);
  await hydrated(page);
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

async function fillCustomer(dialog: Locator, who: { name?: string; email?: string; phone?: string }) {
  if (who.name !== undefined) await dialog.getByLabel(/^Full name/).fill(who.name);
  if (who.email !== undefined) await dialog.getByLabel("Email address").fill(who.email);
  if (who.phone !== undefined) await dialog.getByLabel("Phone number").fill(who.phone);
}

/* ───────────────────────────── adding by hand ───────────────────────────── */

test.describe("Add customer, on a business that has none", () => {
  test("the owner of a brand-new business adds the first customer: it is on the list, its page opens, and nothing was imported", async ({ browser }) => {
    const business = await makeBusiness("custadd", owner.db);
    expect(await customersOf(business.organizationId)).toEqual([]);
    const { context, page } = await openAs(browser, business.owner.email);
    await page.goto("/customers");
    await hydrated(page);
    await expect(page.getByRole("heading", { name: "No customers yet" })).toBeVisible();
    // One primary action, in the empty state; the header waits for the first customer.
    await expect(page.getByRole("button", { name: "Add customer" })).toHaveCount(1);
    await expectAccessible(page);

    await page.getByRole("button", { name: "Add customer" }).click();
    const dialog = page.getByRole("dialog", { name: "Add customer" });
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
    await fillCustomer(dialog, { name: "  Dana Lee ", email: "Dana.Lee@Example.test", phone: "555.010.0100" });
    await dialog.getByRole("button", { name: "Add customer" }).click();

    await expect(page).toHaveURL(/\/customers\/dana-lee$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dana Lee" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Dana Lee was added to your customers." })).toBeVisible();
    // Stored the way Settings stores a phone; the email as typed; the business is the caller's; the customer asks to be texted because there is a phone.
    expect(await customersOf(business.organizationId)).toEqual([{ slug: "dana-lee", name: "Dana Lee", phone: "(555) 010-0100", email: "Dana.Lee@Example.test", preferred_contact: "SMS" }]);
    // The page of a customer with no service location yet says so, instead of showing an empty list.
    await expect(page.getByText("(555) 010-0100").first()).toBeVisible();
    await expect(page.getByText("Dana.Lee@Example.test").first()).toBeVisible();
    await expect(page.getByText("No service location is on record yet.")).toBeVisible();
    await expect(page.getByText("No property on file")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("link", { name: /Properties & equipment/ }).click();
    await expect(page.getByRole("heading", { name: "No service locations yet" })).toBeVisible();

    // The list now has them, and the header carries the action.
    await page.goto("/customers");
    await hydrated(page);
    await expect(page.getByRole("heading", { name: "No customers yet" })).toHaveCount(0);
    const row = page.getByRole("table", { name: "Customers" }).locator("tbody tr", { hasText: "Dana Lee" });
    await expect(row).toBeVisible();
    await expect(page.getByRole("button", { name: "Add customer" })).toHaveCount(1);
    // Search finds them by the phone they gave, however it is typed.
    await page.getByLabel("Search customers", { exact: true }).fill("010-0100");
    await expect(row).toBeVisible();
    await context.close();
  });

  test("the form says what is wrong in words, puts the focus on the first thing to fix, and stores nothing until it is right; a second customer with the same email is refused", async ({ browser }) => {
    const business = await makeBusiness("custform", owner.db);
    const { context, page } = await openAs(browser, business.owner.email);
    await page.goto("/customers");
    await hydrated(page);
    await page.getByRole("button", { name: "Add customer" }).click();
    const dialog = page.getByRole("dialog", { name: "Add customer" });

    await dialog.getByRole("button", { name: "Add customer" }).click();
    await expect(dialog.getByText("Enter the customer's name.")).toBeVisible();
    await expect(dialog.getByText("Enter an email address or a phone number.")).toHaveCount(2);
    await expect(dialog.getByLabel(/^Full name/)).toBeFocused();
    await expect(dialog.getByLabel(/^Full name/)).toHaveAttribute("aria-invalid", "true");

    await fillCustomer(dialog, { name: "Pat Morgan", email: "not-an-email", phone: "12" });
    await dialog.getByRole("button", { name: "Add customer" }).click();
    await expect(dialog.getByText("Enter a valid email address.")).toBeVisible();
    await expect(dialog.getByText(/at least seven digits/)).toBeVisible();
    await expect(dialog.getByLabel("Email address")).toBeFocused();

    // A way of reaching them must exist for the channel chosen.
    await fillCustomer(dialog, { email: "", phone: "(555) 010-0200" });
    await dialog.getByLabel("Preferred contact").selectOption("Email");
    await dialog.getByRole("button", { name: "Add customer" }).click();
    await expect(dialog.getByText("Add an email address to contact this customer by email.")).toBeVisible();
    expect(await customersOf(business.organizationId)).toEqual([]);

    await dialog.getByLabel("Preferred contact").selectOption("Phone");
    await dialog.getByRole("button", { name: "Add customer" }).click();
    await expect(page).toHaveURL(/\/customers\/pat-morgan$/);
    expect(await customersOf(business.organizationId)).toEqual([{ slug: "pat-morgan", name: "Pat Morgan", phone: "(555) 010-0200", email: null, preferred_contact: "Phone" }]);
    // No email on file: the page does not offer a link to nothing.
    await expect(page.getByText("No email on file")).toBeVisible();
    await expect(page.locator('a[href="mailto:"]')).toHaveCount(0);

    // The same email as an existing customer, however it is typed: refused in words on the field, and the dialog stays.
    await page.goto("/customers");
    await hydrated(page);
    await page.getByRole("button", { name: "Add customer" }).click();
    const again = page.getByRole("dialog", { name: "Add customer" });
    await fillCustomer(again, { name: "Pat Morgan", email: "pat@example.test", phone: "(555) 010-0201" });
    await again.getByRole("button", { name: "Add customer" }).click();
    await expect(page).toHaveURL(/\/customers\/pat-morgan-2$/);
    await page.goto("/customers");
    await hydrated(page);
    await page.getByRole("button", { name: "Add customer" }).click();
    const third = page.getByRole("dialog", { name: "Add customer" });
    await fillCustomer(third, { name: "Someone Else", email: "  PAT@Example.TEST " });
    await third.getByRole("button", { name: "Add customer" }).click();
    await expect(third.getByText("A customer with this email address is already on your list.")).toBeVisible();
    await expect(third.getByLabel("Email address")).toBeFocused();
    await expect(third).toBeVisible();
    expect((await customersOf(business.organizationId)).map((customer) => customer.slug)).toEqual(["pat-morgan", "pat-morgan-2"]);
    await context.close();
  });

  test("an admin adds a customer; a member sees the list and nothing to add one with, and is told why when the list is empty", async ({ browser }) => {
    const business = await makeBusiness("custrole", owner.db);
    const member = await openAs(browser, business.member.email);
    await member.page.goto("/customers");
    await hydrated(member.page);
    await expect(member.page.getByRole("heading", { name: "No customers yet" })).toBeVisible();
    await expect(member.page.getByText("Only an owner or admin can add customers.")).toBeVisible();
    await expect(member.page.getByRole("button", { name: "Add customer" })).toHaveCount(0);

    const admin = await openAs(browser, business.admin.email);
    await admin.page.goto("/customers");
    await hydrated(admin.page);
    await admin.page.getByRole("button", { name: "Add customer" }).click();
    const dialog = admin.page.getByRole("dialog", { name: "Add customer" });
    await fillCustomer(dialog, { name: "Admin Added", email: `admin-added-${token()}@example.test` });
    await dialog.getByRole("button", { name: "Add customer" }).click();
    await expect(admin.page).toHaveURL(/\/customers\/admin-added$/);
    // Email only: the customer is written to rather than texted.
    expect((await customersOf(business.organizationId))[0]).toMatchObject({ phone: null, preferred_contact: "Email" });

    // The member now sees the list, still without the action.
    await member.page.reload();
    await hydrated(member.page);
    await expect(member.page.getByRole("table", { name: "Customers" }).locator("tbody tr", { hasText: "Admin Added" })).toBeVisible();
    await expect(member.page.getByRole("button", { name: "Add customer" })).toHaveCount(0);
    await member.context.close();
    await admin.context.close();
  });
});

/* ───────────────────────────── the action, asked wrongly ───────────────────────────── */

test.describe("the Add customer action takes its business, its role and its public reference from the server", () => {
  async function captured(browser: Browser, business: Awaited<ReturnType<typeof makeBusiness>>) {
    const { context, page } = await openAs(browser, business.owner.email);
    await page.goto("/customers");
    await hydrated(page);
    await page.getByRole("button", { name: "Add customer" }).click();
    const dialog = page.getByRole("dialog", { name: "Add customer" });
    await fillCustomer(dialog, { name: "Captured Person", email: `captured-${token()}@example.test`, phone: "(555) 010-0300" });
    const call = await captureAction(page, () => dialog.getByRole("button", { name: "Add customer" }).click());
    await expect(page).toHaveURL(/\/customers\/captured-person$/);
    await context.close();
    return call;
  }

  test("nobody signed out, no member, no platform administrator who is not in the business, and nobody naming another business can add a customer; the owner's own forged fields change nothing", async ({ browser }) => {
    const business = await makeBusiness("custact", owner.db);
    const other = await makeBusiness("custoth", owner.db);
    const admin = await makePlatformAdmin("custpa", owner.db, owner.pool);
    const call = await captured(browser, business);
    expect((await customersOf(business.organizationId)).map((customer) => customer.slug)).toEqual(["captured-person"]);

    const attempt = (name: string, extra: Record<string, unknown> = {}) => withFirstArgument(call, (argument) => Object.assign(argument, { name, email: `${name.toLowerCase().replace(/\W+/g, "-")}-${token()}@example.test`, phone: freshPhone() }, extra));

    // No session.
    const nobody = await anonymous(address());
    expect(await (await replay(nobody, call, attempt("Signed Out"))).text()).not.toContain('"ok":true');
    // A member of the business.
    const member = await signedIn(business.member.email, address());
    expect(await (await replay(member, call, attempt("Member Added"))).text()).toContain("Only an owner or admin can add customers.");
    // A platform administrator is not a member of a business because of it.
    const platform = await signedIn(admin.email, address());
    expect(await (await replay(platform, call, attempt("Platform Added"))).text()).not.toContain('"ok":true');
    // Another business's owner has no say here: their session works for THEIR business, wherever the call is sent.
    const stranger = await signedIn(other.owner.email, address());
    const fromStranger = await (await replay(stranger, call, attempt("Stranger Added", { organizationId: business.organizationId, organization_id: business.organizationId }))).text();
    expect(fromStranger).toContain('"ok":true');
    expect((await customersOf(business.organizationId)).map((customer) => customer.slug)).toEqual(["captured-person"]);
    expect((await customersOf(other.organizationId)).map((customer) => customer.name)).toEqual(["Stranger Added"]);

    // The owner naming another business, a public reference, an id, a position or the key columns: the customer is the owner's own business's and the server chose every one of those.
    const owned = await signedIn(business.owner.email, address());
    const forged = await (await replay(owned, call, attempt("Forged Fields", { organizationId: other.organizationId, organization_id: other.organizationId, orgId: other.organizationId, id: "taken", slug: "forged-slug", customerId: "x", position: 1, emailKey: "a@b.c", phoneKey: "1234567", type: "commercial" }))).text();
    expect(forged).toContain('"ok":true');
    const mine = await customersOf(business.organizationId);
    expect(mine.map((customer) => customer.slug)).toEqual(["captured-person", "forged-fields"]);
    expect(await customersOf(other.organizationId)).toHaveLength(1);

    // Malformed: not an object, wrong kinds, too long, a channel that does not exist, nothing to reach them by.
    const before = (await customersOf(business.organizationId)).length;
    for (const body of [
      JSON.stringify([]),
      JSON.stringify([null]),
      JSON.stringify(["Dana"]),
      JSON.stringify([[{ name: "Array" }]]),
      attempt("Number Phone", { phone: 5550100 }),
      attempt("A".repeat(81)),
      attempt("Huge", { name: "H".repeat(10_000) }),
      attempt("Bad Channel", { preferredContact: "Pigeon" }),
      attempt("Markup <b>", {}),
      attempt("Nothing To Reach", { email: "", phone: "" }),
      attempt("Bad Email", { email: "no-at-sign" }),
      attempt("Short Phone", { phone: "12345", email: "" }),
    ]) {
      const answer = await (await replay(owned, call, body)).text();
      expect(answer, body.slice(0, 80)).not.toContain('"ok":true');
    }
    expect(await customersOf(business.organizationId)).toHaveLength(before);
    for (const client of [nobody, member, platform, stranger, owned]) await client.dispose();
  });

  test("the same email sent ten times at once, by owners and admins alike, makes one customer", async ({ browser }) => {
    const business = await makeBusiness("custrace", owner.db);
    const call = await captured(browser, business);
    const owned = await signedIn(business.owner.email, address());
    const adminClient = await signedIn(business.admin.email, address());
    const shared = `race-${token()}@example.test`;
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        replay(index % 2 === 0 ? owned : adminClient, call, withFirstArgument(call, (argument) => Object.assign(argument, { name: `Racer ${index}`, email: index % 3 === 0 ? shared.toUpperCase() : shared, phone: freshPhone() }))).then((response) => response.text()),
      ),
    );
    expect(answers.filter((text) => text.includes('"ok":true'))).toHaveLength(1);
    expect(answers.filter((text) => text.includes("already on your list"))).toHaveLength(9);
    expect((await customersOf(business.organizationId)).filter((customer) => customer.email?.toLowerCase() === shared)).toHaveLength(1);
    await owned.dispose();
    await adminClient.dispose();
  });
});

/* ───────────────────────────── a guest's booking ───────────────────────────── */

test.describe("a guest who books becomes the business's customer", () => {
  test("from a Marketplace profile: the customer appears with nobody adding it, a second booking finds the same one, the review can be asked for, and another business sees nothing", async ({ browser }) => {
    const provider = await makeProvider("custmk", handles(), { areas: [{ city: "Denver", state: "CO" }] });
    const bystander = await makeBusiness("custby", owner.db);
    const org = provider.business.organizationId;
    expect(await customersOf(org)).toEqual([]);

    const guest = { name: "Jordan Visitor", phone: "(303) 555-0142", email: `jordan-${token()}@example.test` };
    const visitor = await openAnonymous(browser);
    const [first, second] = weekdays(2);
    await bookAsGuest(visitor.page, provider.slug, guest, first);
    // The same person again, typing the phone and the email differently, on another day.
    await bookAsGuest(visitor.page, provider.slug, { name: "jordan visitor", phone: "303.555.0142", email: guest.email.toUpperCase() }, second);
    await visitor.context.close();

    const made = await customersOf(org);
    expect(made).toEqual([{ slug: "jordan-visitor", name: "Jordan Visitor", phone: "(303) 555-0142", email: guest.email, preferred_contact: "SMS" }]);
    const stored = await owner.pool.query<{ customer: string | null; contact_name: string | null; source: string; listing: string | null; address: string | null }>(
      "select c.slug as customer, b.contact_name, b.source, b.marketplace_listing_id as listing, b.contact_address as address from bookings b left join customers c on c.id = b.customer_id where b.organization_id = $1 order by b.number",
      [org],
    );
    expect(stored.rows).toEqual([
      { customer: "jordan-visitor", contact_name: null, source: "Marketplace", listing: provider.listingId, address: "5 Aspen Way, Denver, CO 80203" },
      { customer: "jordan-visitor", contact_name: null, source: "Marketplace", listing: provider.listingId, address: "5 Aspen Way, Denver, CO 80203" },
    ]);

    // The business finds them where it looks for customers, with the work they asked for.
    const business = await openAs(browser, provider.business.owner.email);
    const page = business.page;
    await page.goto("/customers");
    await hydrated(page);
    const row = page.getByRole("table", { name: "Customers" }).locator("tbody tr", { hasText: "Jordan Visitor" });
    await expect(row).toHaveCount(1);
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/customers\/jordan-visitor$/);
    await expect(page.getByRole("heading", { level: 1, name: "Jordan Visitor" })).toBeVisible();
    await expect(page.getByText(guest.email).first()).toBeVisible();
    // The customer's page shows the bookings that made them one, from the same records the Bookings module shows: no Job was made up for them.
    const bookingsCard = page.getByRole("heading", { name: "Bookings (2)" });
    await expect(bookingsCard).toBeVisible();
    await expect(page.getByRole("link", { name: /^Booking #BK-\d{4}$/ })).toHaveCount(2);
    await expect(page.getByText("No service visits are recorded yet.")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("link", { name: /^Booking #BK-\d{4}$/ }).first().click();
    await expect(page).toHaveURL(/\/bookings\?tab=upcoming&booking=BK-\d{4}$/);
    // ... and the booking says whose it is and where the visit was asked for.
    const drawer = page.getByRole("complementary", { name: "Booking details" });
    await expect(drawer).toContainText("Jordan Visitor");
    await expect(drawer).toContainText("5 Aspen Way, Denver, CO 80203");
    await expect(drawer).toContainText(guest.email);

    // The booking shows the person, where it came from and the address they gave.
    await page.goto("/bookings?tab=upcoming");
    await hydrated(page);
    const booking = page.getByRole("table", { name: "Upcoming bookings" }).locator("tbody tr", { hasText: "Jordan Visitor" });
    await expect(booking).toHaveCount(2);
    await expect(booking.first()).toContainText("Marketplace");

    // A review can be asked for from the customer the booking made: nothing is sent, the business is given the link.
    await page.goto("/reviews");
    await hydrated(page);
    await page.getByRole("button", { name: "Request review" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel("Customer").selectOption({ label: "Jordan Visitor" });
    await dialog.getByRole("button", { name: "Send review request" }).click();
    const ready = page.getByRole("dialog", { name: "Review link ready" });
    await expect(ready.getByLabel("Review link")).toHaveValue(new RegExp(`^${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/review/[A-Za-z0-9_-]{43}$`));
    const requests = await owner.pool.query<{ slug: string }>("select c.slug from review_requests r join customers c on c.organization_id = r.organization_id and c.id = r.customer_id where r.organization_id = $1", [org]);
    expect(requests.rows).toEqual([{ slug: "jordan-visitor" }]);
    await business.context.close();

    // Another business knows nothing of them.
    const other = await openAs(browser, bystander.owner.email);
    await other.page.goto("/customers/jordan-visitor");
    await expect(other.page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await other.page.goto("/customers");
    await expect(other.page.getByRole("heading", { name: "No customers yet" })).toBeVisible();
    await other.context.close();
    expect(await customersOf(bystander.organizationId)).toEqual([]);
  });

  test("from a business's own website: the customer is made, the booking is theirs and the Site is its source; a review request can name them", async ({ browser, workerTenant, db, page }) => {
    const email = `site-guest-${token()}@example.test`;
    const before = (await db.query<{ n: number }>("select count(*)::int as n from customers where organization_id = $1", [workerTenant.organizationId])).rows[0].n;
    const visitor = await openAnonymous(browser);
    const guest = visitor.page;
    await guest.goto(`/sites/${workerTenant.platformSlug}/booking/annual-cooling-tune-up`);
    await hydrated(guest);
    await guest.getByLabel("Date", { exact: true }).fill("2024-10-29");
    await guest.getByRole("radio", { name: /^11:30 AM/ }).check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await guest.getByLabel(/^Full name/).fill("Riley Site");
    await guest.getByLabel(/^Phone number/).fill(freshPhone());
    await guest.getByLabel(/^Email address/).fill(email);
    await guest.getByLabel(/^Service address/).fill("1402 South Congress Ave, Austin, TX 78704");
    await guest.getByRole("button", { name: "Confirm booking" }).click();
    await expect(guest.getByRole("region", { name: "Instant booking confirmed" })).toContainText(/BK-\d{4}/);
    await visitor.context.close();

    const rows = (await db.query<{ source: string; customer: string; contact_email: string | null; contact_name: string | null; org: string; customer_org: string }>(
      "select b.source, c.name as customer, b.contact_email, b.contact_name, b.organization_id as org, c.organization_id as customer_org from bookings b join customers c on c.id = b.customer_id where c.email_key = lower($1)",
      [email],
    )).rows;
    expect(rows).toEqual([{ source: "Website", customer: "Riley Site", contact_email: null, contact_name: null, org: workerTenant.organizationId, customer_org: workerTenant.organizationId }]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from customers where organization_id = $1", [workerTenant.organizationId])).rows[0].n).toBe(before + 1);

    // The signed-in owner of the business finds them in Customers and can name them in a review request.
    await page.goto("/customers");
    await hydrated(page);
    await expect(page.getByRole("table", { name: "Customers" }).locator("tbody tr", { hasText: "Riley Site" })).toBeVisible();
    await page.goto("/reviews");
    await hydrated(page);
    await page.getByRole("button", { name: "Request review" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel("Customer").selectOption({ label: "Riley Site" });
    await dialog.getByRole("button", { name: "Send review request" }).click();
    await expect(page.getByRole("dialog", { name: "Review link ready" })).toBeVisible();
  });
});

/* ───────────────────────────── the public call ───────────────────────────── */

test.describe("the public booking call cannot be used to reach a customer", () => {
  test("it cannot name a customer or a business, cannot overwrite or attach to anyone else's customer, and answers the same whether or not the email is already a customer's", async ({ browser }) => {
    const provider = await makeProvider("custpub", handles(), { areas: [{ city: "Denver", state: "CO" }] });
    const other = await makeProvider("custpub2", handles(), { areas: [{ city: "Denver", state: "CO" }] });
    const org = provider.business.organizationId;
    // Somebody else's customer, in another business, and one of this business's own that the request will try to take over.
    const secretEmail = `secret-${token()}@example.test`;
    const secretPhone = freshPhone();
    await owner.pool.query("insert into customers (organization_id, slug, name, phone, email) values ($1, 'secret-person', 'Secret Person', $2, $3)", [other.business.organizationId, secretPhone, secretEmail]);
    const ownEmail = `own-${token()}@example.test`;
    await owner.pool.query("insert into customers (organization_id, slug, name, phone, email) values ($1, 'own-person', 'Own Person', '(303) 555-0188', $2)", [org, ownEmail]);
    const otherCustomer = (await owner.pool.query<{ id: string }>("select id from customers where organization_id = $1", [other.business.organizationId])).rows[0].id;

    // One real booking through the page, to capture the call it sends.
    const visitor = await openAnonymous(browser);
    const guest = visitor.page;
    const [day, next, third] = weekdays(3);
    await guest.goto(`/listings/${provider.slug}/book/${SAMPLE_SERVICES.tuneUp}`);
    await hydrated(guest);
    await guest.getByLabel("Date", { exact: true }).fill(day);
    await guest.getByRole("radio", { name: /^11:30 AM/ }).check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await guest.getByLabel(/^Full name/).fill("Captured Guest");
    await guest.getByLabel(/^Phone number/).fill(freshPhone());
    await guest.getByLabel(/^Email address/).fill(`captured-${token()}@example.test`);
    await guest.getByLabel(/^Service address/).fill("5 Aspen Way, Denver, CO 80203");
    const call = await captureAction(guest, () => guest.getByRole("button", { name: "Confirm booking" }).click());
    await expect(guest.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    await visitor.context.close();

    const api = await anonymous(address());
    const send = async (change: Record<string, unknown>) => (await replay(api, call, withFirstArgument(call, (argument) => Object.assign(argument, { submissionKey: `k-${token()}${token()}`, date: next }, change)))).text();

    // Forged fields: a customer of another business, an organization, a booking number, a source. The booking is this business's, for a customer made from what was typed.
    const forgedName = "Forged Guest";
    const forgedEmail = `forged-${token()}@example.test`;
    const forged = await send({ name: forgedName, email: forgedEmail, phone: freshPhone(), customerId: otherCustomer, customer_id: otherCustomer, organizationId: other.business.organizationId, organization_id: other.business.organizationId, source: "Website", number: 1, status: "confirmed" });
    expect(forged).toContain('"ok":true');
    const forgedBooking = await owner.pool.query<{ org: string; customer_org: string; name: string; source: string }>(
      "select b.organization_id as org, c.organization_id as customer_org, c.name, b.source from bookings b join customers c on c.id = b.customer_id where c.email_key = lower($1)",
      [forgedEmail],
    );
    expect(forgedBooking.rows).toEqual([{ org, customer_org: org, name: forgedName, source: "Marketplace" }]);
    // The other business's customer has no booking and is exactly as it was.
    expect((await owner.pool.query("select count(*)::int as n from bookings where customer_id = $1", [otherCustomer])).rows[0].n).toBe(0);
    expect((await owner.pool.query("select name, phone, email from customers where id = $1", [otherCustomer])).rows).toEqual([{ name: "Secret Person", phone: secretPhone, email: secretEmail }]);

    // Typing another business's email and phone makes this business's own customer: nothing of the other's is found, attached or learned.
    await send({ name: "Copycat", email: secretEmail, phone: secretPhone });
    expect((await owner.pool.query("select count(*)::int as n from customers where organization_id = $1 and email_key = lower($2)", [org, secretEmail])).rows[0].n).toBe(1);
    expect((await owner.pool.query("select count(*)::int as n from bookings where customer_id = $1", [otherCustomer])).rows[0].n).toBe(0);

    // Typing the email and phone of one of this business's own customers, with a different name, finds it; it is not renamed or changed by being found.
    const found = await send({ name: "Somebody Else Entirely", email: ownEmail.toUpperCase(), phone: "(303) 555-0188" });
    expect(found).toContain('"ok":true');
    expect((await owner.pool.query("select name, phone, email from customers where organization_id = $1 and slug = 'own-person'", [org])).rows).toEqual([{ name: "Own Person", phone: "(303) 555-0188", email: ownEmail }]);
    expect((await owner.pool.query("select count(*)::int as n from customers where organization_id = $1 and name = 'Somebody Else Entirely'", [org])).rows[0].n).toBe(0);

    // No enumeration: the answer to an email that is already a customer's has the shape of the answer to one that is not (only the reference and the status can differ).
    const shape = (text: string) => text.replace(/BK-\d+/g, "BK-0").replace(/\d+/g, "0");
    const fresh = await send({ name: "Newcomer", email: `new-${token()}@example.test`, phone: freshPhone() });
    const existing = await send({ name: "Newcomer", email: ownEmail, phone: "(303) 555-0188", date: third });
    expect(shape(existing)).toBe(shape(fresh));
    await api.dispose();
  });
});

/* ───────────────────────────── on a tablet, by keyboard ───────────────────────────── */

test.describe("at the narrowest width the workspace supports", () => {
  test("the empty Customers page, the Add customer dialog and the new customer's page fit at 768 px, are named, and the dialog works by keyboard alone", async ({ browser }) => {
    const business = await makeBusiness("custtab", owner.db);
    const where = address();
    const state = await (await signedIn(business.owner.email, where)).storageState();
    const context = await browser.newContext({ storageState: state, viewport: { width: 768, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": where } });
    const page = await context.newPage();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    await page.goto("/customers");
    await hydrated(page);
    expect(await overflow(), "the empty page runs off the screen").toBe(0);
    await expectAccessible(page);

    const button = page.getByRole("button", { name: "Add customer" });
    await button.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add customer" });
    await expect(dialog).toBeVisible();
    expect(await overflow(), "the dialog runs off the screen").toBe(0);
    await expectAccessible(page);
    // Escape closes it and the focus goes back to what opened it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();

    // Open it again and add a customer without the mouse: Enter in a field sends the form.
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^Full name/).fill("Keyboard Person");
    await dialog.getByLabel("Email address").fill(`keyboard-${token()}@example.test`);
    await dialog.getByLabel("Email address").press("Enter");
    await expect(page).toHaveURL(/\/customers\/keyboard-person$/);
    await expect(page.getByRole("heading", { level: 1, name: "Keyboard Person" })).toBeVisible();
    expect(await overflow(), "the customer's page runs off the screen").toBe(0);
    await expectAccessible(page);
    await context.close();
  });
});
