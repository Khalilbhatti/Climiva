/**
 * Phase 19E correction, what the identity rule means for the people downstream of a booking: the marketing audience (customers a booking made are in "all
 * customers" like any other), a review request, and the bookings each person sees on their own page.
 *
 * The household is the case that matters. Two people share one phone and have different emails; the revised rule (drizzle/0031) makes them two customers,
 * and these tests hold that nothing downstream folds them back into one: the audiences keep them apart, a review request names the person it was meant for
 * and the review lands on them, and the bookings of one are never on the other's page. Nothing here sends anything; no marketing or notification feature exists to test.
 */
import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright/test";
import { Pool } from "pg";
import { adminDb } from "../scripts/db/lib";
import { resolveAudience } from "../src/db/marketing-queries";
import { withTenant } from "../src/db/tenant";
import { signedIn } from "./assets-helpers";
import { makeProvider, SAMPLE_SERVICES, type Provider } from "./marketplace-helpers";
import { expect, hydrated, test } from "./saas";

test.describe.configure({ timeout: 180_000 });

let owner: ReturnType<typeof adminDb>;
let app: Pool;
test.beforeAll(() => {
  owner = adminDb();
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
});
test.afterAll(async () => {
  await app.end();
  await owner.pool.end();
});

const token = () => randomBytes(3).toString("hex");
const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
let day = 0;
const nextDate = () => new Date(Date.UTC(2032, 0, 1 + day++)).toISOString().slice(0, 10);

type Who = { name: string; phone: string; email: string };
const provider = () => makeProvider("custsafe", { db: owner.db, pool: owner.pool }, { areas: [{ city: "Austin", state: "TX" }] });

async function book(p: Provider, who: Who) {
  await app.query(
    "select app_public_create_marketplace_booking($1, $2, $3, $4::date, '09:00'::time, '10:00'::time, $5, $6, $7, '5 Aspen Way, Denver, CO 80203', null, null, null, null, null)",
    [p.slug, SAMPLE_SERVICES.repair, `key-${token()}${token()}`, nextDate(), who.name, who.phone, who.email],
  );
}

const bookingsByCustomer = async (organizationId: string) =>
  Object.fromEntries(
    (
      await owner.pool.query<{ slug: string; n: number }>(
        "select c.slug, count(*)::int as n from bookings b join customers c on c.organization_id = b.organization_id and c.id = b.customer_id where b.organization_id = $1 group by c.slug order by c.slug",
        [organizationId],
      )
    ).rows.map((row) => [row.slug, row.n]),
  );

async function openAs(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const where = address();
  const state = await (await signedIn(email, where)).storageState();
  const context = await browser.newContext({ storageState: state, extraHTTPHeaders: { "x-forwarded-for": where } });
  return { context, page: await context.newPage() };
}

/** A household: Mary and John share a phone, have their own emails, and a third customer already had that phone before either booked. */
async function household() {
  const p = await provider();
  const org = p.business.organizationId;
  await owner.pool.query("insert into customers (organization_id, slug, name, phone, email) values ($1, 'phone-owner', 'Phone Owner', '(555) 010-5000', 'owner@example.test')", [org]);
  const mary: Who = { name: "Mary Home", phone: "(555) 010-5000", email: `mary-${token()}@example.test` };
  const john: Who = { name: "John Home", phone: "555.010.5000", email: `john-${token()}@example.test` };
  await book(p, mary);
  await book(p, john);
  return { p, org, mary, john };
}

test.describe("people who share a phone stay distinct downstream of their bookings", () => {
  test("the marketing audiences keep them as three customers with their own emails: nobody is folded into somebody else, and a chosen list names exactly the people chosen", async () => {
    const { p, org, mary, john } = await household();
    const audience = (channel: "email" | "sms", id: "all-customers" | "selected", selected: string[] = []) =>
      withTenant({ userId: p.business.owner.userId, organizationId: org }, (tx) => resolveAudience(tx, org, "2032-06-01", channel, id, selected));

    const email = await audience("email", "all-customers");
    expect(email.contacts.map((contact) => [contact.slug, contact.email])).toEqual([
      ["phone-owner", "owner@example.test"],
      ["mary-home", mary.email],
      ["john-home", john.email],
    ]);
    expect(email.total).toBe(3);
    // The text audience reaches each customer on their own record; the shared phone is on three records, and they stay three.
    const sms = await audience("sms", "all-customers");
    expect(sms.contacts.map((contact) => contact.slug)).toEqual(["phone-owner", "mary-home", "john-home"]);
    expect(sms.total).toBe(3);
    // A list chosen from the Customers is exactly the chosen: choosing John names John, not the others on his phone.
    const chosen = await audience("email", "selected", ["john-home"]);
    expect(chosen.contacts.map((contact) => [contact.slug, contact.email])).toEqual([["john-home", john.email]]);
    // A repeat booking by either of them changes none of it.
    await book(p, mary);
    await book(p, { ...john, phone: "(555) 010-9876" });
    expect((await audience("email", "all-customers")).contacts.map((contact) => contact.slug)).toEqual(["phone-owner", "mary-home", "john-home"]);
  });

  test("a review request names the person it is for, and the review that comes back is theirs alone", async ({ browser }) => {
    const { p, org } = await household();
    const { context, page } = await openAs(browser, p.business.owner.email);
    await page.goto("/reviews");
    await hydrated(page);
    await page.getByRole("button", { name: "Request review" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel("Customer").selectOption({ label: "John Home" });
    await dialog.getByRole("button", { name: "Send review request" }).click();
    const ready = page.getByRole("dialog", { name: "Review link ready" });
    const link = await ready.getByLabel("Review link").inputValue();
    await context.close();

    const requests = await owner.pool.query<{ slug: string }>("select c.slug from review_requests r join customers c on c.organization_id = r.organization_id and c.id = r.customer_id where r.organization_id = $1", [org]);
    expect(requests.rows).toEqual([{ slug: "john-home" }]);

    // The customer the link was made for answers it; the review is John's, and Mary and the customer who had the phone first have none.
    const secret = link.split("/").pop()!;
    const outcome = await app.query<{ outcome: { result: string } }>("select app_public_submit_review($1, 5, 'Quick and tidy.', false) as outcome", [secret]);
    expect(outcome.rows[0].outcome).toEqual({ result: "submitted", public: false });
    const reviews = await owner.pool.query<{ slug: string; text: string }>("select c.slug, r.review_text as text from reviews r join customers c on c.organization_id = r.organization_id and c.id = r.customer_id where r.organization_id = $1", [org]);
    expect(reviews.rows).toEqual([{ slug: "john-home", text: "Quick and tidy." }]);
  });

  test("bookings stay with the person who made them: a repeat, a changed phone and a third person on the same phone move nobody's activity to anyone else's page", async ({ browser }) => {
    const { p, org, mary, john } = await household();
    await book(p, mary); // Mary again
    await book(p, { ...john, phone: "(555) 010-9876" }); // John, with a phone that is nobody's: still John by his email
    await book(p, { name: "Pat Home", phone: "(555) 010-5000", email: `pat-${token()}@example.test` }); // a third person on the household phone
    expect(await bookingsByCustomer(org)).toEqual({ "john-home": 2, "mary-home": 2, "pat-home": 1 });
    // John's changed phone was not written to his record, and Mary's and the first customer's records are as they were.
    expect((await owner.pool.query("select slug, phone, email from customers where organization_id = $1 order by position", [org])).rows).toEqual([
      { slug: "phone-owner", phone: "(555) 010-5000", email: "owner@example.test" },
      { slug: "mary-home", phone: "(555) 010-5000", email: mary.email },
      { slug: "john-home", phone: "(555) 010-5000", email: john.email },
      { slug: "pat-home", phone: "(555) 010-5000", email: expect.stringMatching(/^pat-/) },
    ]);

    // Each person's own page shows their own bookings and nobody else's.
    const { context, page } = await openAs(browser, p.business.owner.email);
    for (const [slug, count] of [["mary-home", 2], ["john-home", 2], ["pat-home", 1]] as const) {
      await page.goto(`/customers/${slug}`);
      await hydrated(page);
      await expect(page.getByRole("heading", { name: `Bookings (${count})` }), slug).toBeVisible();
    }
    await page.goto("/customers/phone-owner");
    await hydrated(page);
    await expect(page.getByRole("heading", { name: /^Bookings \(/ })).toHaveCount(0);
    await context.close();
  });
});
