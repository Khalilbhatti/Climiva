/**
 * Phase 19E, the database: how a guest's booking finds or makes the business's customer, and who may add a customer by hand.
 *
 * Everything is SQL as the restricted runtime role (`climvia_app`, the one the application connects as), or as the owner where a test looks underneath
 * or writes what the application cannot. No browser. Each test makes its own business, so the counts asserted are exact.
 *
 * The rule under test (drizzle/0030), inside ONE business and nowhere else:
 *   a. the booker's email AND phone are exactly one customer's                           -> that customer
 *   b. otherwise the customers who share the email or the phone: exactly one -> that one; none -> a new customer;
 *      two or more (the email is one customer's and the phone another's) -> a new, SEPARATE customer; nothing is merged and nobody is picked
 *   c. nothing to recognise them by                                                      -> no customer, the booking keeps the visitor's details
 * A name is never used to find anyone, and a customer that is found is never changed.
 */
import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { createCustomer } from "../src/db/core-queries";
import { withTenant } from "../src/db/tenant";
import { makeProvider, SAMPLE_SERVICES, type Provider } from "./marketplace-helpers";
import { makePlatformAdmin } from "./platform-admin-helpers";
import { asTenant } from "./review-helpers";

let owner: ReturnType<typeof adminDb>;
let app: Pool;
test.beforeAll(() => {
  owner = adminDb();
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 16 });
});
test.afterAll(async () => {
  await app.end();
  await owner.pool.end();
});

const handles = () => ({ db: owner.db, pool: owner.pool });

/* ───────────────────────────── helpers ───────────────────────────── */

type Who = { name: string; phone: string; email: string };
let day = 0;
/** A date no other booking of the test has used, so "the same person at the same time" never applies by accident. */
const nextDate = () => new Date(Date.UTC(2031, 0, 1 + day++)).toISOString().slice(0, 10);
const token = () => randomBytes(4).toString("hex");

async function provider(label = "custacq"): Promise<Provider> {
  return makeProvider(label, handles(), { areas: [{ city: "Austin", state: "TX" }] });
}

/** A booking through the Marketplace's public function, as the application calls it. */
async function book(p: Provider, who: Who, options: { key?: string; note?: string | null; address?: string; service?: string; date?: string } = {}) {
  const date = options.date ?? nextDate();
  const result = await app.query<{ r: { ok: boolean; reason?: string; duplicate?: boolean; number?: number } }>(
    "select app_public_create_marketplace_booking($1, $2, $3, $4::date, '09:00'::time, '10:00'::time, $5, $6, $7, $8, $9, null, null, 'ac-repair-diagnostics', 'austin-tx') as r",
    [p.slug, options.service ?? SAMPLE_SERVICES.repair, options.key ?? `key-${token()}${token()}`, date, who.name, who.phone, who.email, options.address ?? "1402 South Congress Ave, Austin, TX 78704", options.note ?? null],
  );
  return result.rows[0].r;
}

type CustomerRow = { slug: string; name: string; phone: string | null; email: string | null; email_key: string | null; phone_key: string | null };
const customersOf = async (organizationId: string) =>
  (await owner.pool.query<CustomerRow>("select slug, name, phone, email, email_key, phone_key from customers where organization_id = $1 order by position", [organizationId])).rows;

type BookingRow = { number: number; customer: string | null; customer_id: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null; contact_address: string | null; note: string | null; source: string; listing: string | null; discovery_service: string | null; discovery_location: string | null };
const bookingsOf = async (organizationId: string) =>
  (
    await owner.pool.query<BookingRow>(
      `select b.number, c.slug as customer, b.customer_id, b.contact_name, b.contact_phone, b.contact_email, b.contact_address, b.note, b.source, b.marketplace_listing_id as listing, b.discovery_service, b.discovery_location
         from bookings b left join customers c on c.organization_id = b.organization_id and c.id = b.customer_id where b.organization_id = $1 order by b.number`,
      [organizationId],
    )
  ).rows;

const insertCustomer = async (organizationId: string, name: string, phone: string | null, email: string | null) =>
  (await owner.pool.query<{ slug: string }>("insert into customers (organization_id, slug, name, phone, email) values ($1, $2, $3, $4, $5) returning slug", [organizationId, `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${token()}`, name, phone, email])).rows[0].slug;

const dana = (n = token()): Who => ({ name: "Dana Lee", phone: "(555) 010-0100", email: `dana-${n}@example.test` });

/* ───────────────────────────── the keys ───────────────────────────── */

test.describe("the two keys a booking is matched on are one definition", () => {
  test("an email is its trimmed lower-case self, and a phone is its digits (a US number without its country code, under seven digits no identity at all)", async () => {
    const key = async (fn: string, input: string | null) => (await owner.pool.query<{ k: string | null }>(`select ${fn}($1) as k`, [input])).rows[0].k;
    for (const [input, expected] of [["  Dana@Example.COM ", "dana@example.com"], ["dana@example.com", "dana@example.com"], ["", null], ["   ", null], [null, null]] as const) {
      expect(await key("app_email_key", input), `email ${JSON.stringify(input)}`).toBe(expected);
    }
    for (const [input, expected] of [
      ["(555) 010-0100", "5550100100"],
      ["555.010.0100", "5550100100"],
      ["+1 555 010 0100", "5550100100"],
      ["1-555-010-0100", "5550100100"],
      ["15550100100", "5550100100"],
      ["555 0100", "5550100"],
      ["12345", null],
      ["call me", null],
      ["", null],
      [null, null],
      ["+44 20 7946 0958", "442079460958"],
    ] as const) {
      expect(await key("app_phone_key", input), `phone ${JSON.stringify(input)}`).toBe(expected);
    }
  });

  test("a customer's keys are generated from its email and phone: they cannot be written, and follow the columns", async () => {
    const p = await provider();
    const slug = await insertCustomer(p.business.organizationId, "Key Person", " +1 555.010.0123 ", "  Key.Person@Example.TEST ");
    const [row] = (await customersOf(p.business.organizationId)).filter((customer) => customer.slug === slug);
    expect(row).toMatchObject({ email_key: "key.person@example.test", phone_key: "5550100123" });
    await expect(owner.pool.query("insert into customers (organization_id, slug, name, email_key) values ($1, 'zz-key', 'Zed', 'x')", [p.business.organizationId])).rejects.toMatchObject({ code: "428C9" });
  });
});

/* ───────────────────────────── a guest's booking ───────────────────────────── */

test.describe("a guest's booking finds or makes the business's customer", () => {
  test("a first booking makes the customer, and the booking is theirs: their name, phone and email moved to the customer, the address, the source and the listing stay on the booking", async () => {
    const p = await provider();
    expect(await customersOf(p.business.organizationId)).toEqual([]);
    const outcome = await book(p, { name: "  Dana Lee ", phone: "555.010.0100", email: " Dana@Example.test " }, { note: "The unit is warm", address: "9 Oak Lane, Austin, TX 78701" });
    expect(outcome).toMatchObject({ ok: true, duplicate: false });
    const customers = await customersOf(p.business.organizationId);
    expect(customers).toHaveLength(1);
    // Stored the way Settings stores a phone; the email as typed (trimmed); the keys derived.
    expect(customers[0]).toMatchObject({ slug: "dana-lee", name: "Dana Lee", phone: "(555) 010-0100", email: "Dana@Example.test", email_key: "dana@example.test", phone_key: "5550100100" });
    const bookings = await bookingsOf(p.business.organizationId);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      customer: "dana-lee",
      contact_name: null,
      contact_phone: null,
      contact_email: null,
      contact_address: "9 Oak Lane, Austin, TX 78701",
      note: "The unit is warm",
      source: "Marketplace",
      listing: p.listingId,
      discovery_service: "ac-repair-diagnostics",
      discovery_location: "austin-tx",
    });
  });

  test("the same person again is the same customer, however the email and phone are typed; nothing is made twice and nothing about the customer changes", async () => {
    const p = await provider();
    await book(p, { name: "Dana Lee", phone: "(555) 010-0100", email: "dana@example.test" });
    const before = await customersOf(p.business.organizationId);
    for (const who of [
      { name: "Dana Lee", phone: "(555) 010-0100", email: "dana@example.test" },
      { name: "Dana Lee", phone: "555-010-0100", email: "DANA@EXAMPLE.TEST" },
      { name: "dana lee", phone: "+1 555 010 0100", email: "  dana@example.test  " },
      { name: "Dana   Lee", phone: "15550100100", email: "Dana@Example.Test" },
    ]) {
      expect(await book(p, who)).toMatchObject({ ok: true, duplicate: false });
    }
    expect(await customersOf(p.business.organizationId)).toEqual(before);
    const bookings = await bookingsOf(p.business.organizationId);
    expect(bookings).toHaveLength(5);
    expect(new Set(bookings.map((booking) => booking.customer))).toEqual(new Set(["dana-lee"]));
    // The same name and the same contact details: nothing to add to the note.
    expect(bookings.map((booking) => booking.note)).toEqual([null, null, null, null, null]);
  });

  test("the same email with a new phone is that customer: the new phone is NOT written to them, and is kept on the booking's note", async () => {
    const p = await provider();
    const who = dana();
    await book(p, who);
    await book(p, { ...who, phone: "(555) 010-0999" });
    const customers = await customersOf(p.business.organizationId);
    expect(customers).toHaveLength(1);
    expect(customers[0].phone).toBe("(555) 010-0100");
    expect((await bookingsOf(p.business.organizationId))[1]).toMatchObject({ customer: "dana-lee", note: `Booked as Dana Lee, (555) 010-0999, ${who.email}.` });
  });

  test("the same phone with a new email is that customer when they are the only one with it: the new email is kept on the booking's note, not written to the customer", async () => {
    const p = await provider();
    const who = dana();
    await book(p, who);
    const other = `second-${token()}@example.test`;
    await book(p, { ...who, email: other }, { note: "Please call first" });
    const customers = await customersOf(p.business.organizationId);
    expect(customers).toHaveLength(1);
    expect(customers[0].email).toBe(who.email);
    expect((await bookingsOf(p.business.organizationId))[1]).toMatchObject({ customer: "dana-lee", note: `Booked as Dana Lee, (555) 010-0100, ${other}. Please call first` });
  });

  test("a name alone is no identity: the same name with another email and phone is another customer", async () => {
    const p = await provider();
    await book(p, { name: "Pat Morgan", phone: "(555) 010-1111", email: `pat-${token()}@example.test` });
    await book(p, { name: "Pat Morgan", phone: "(555) 010-2222", email: `pat-${token()}@example.test` });
    expect((await customersOf(p.business.organizationId)).map((customer) => customer.slug)).toEqual(["pat-morgan", "pat-morgan-2"]);
  });

  test("a booking's email is one customer's and its phone another's: neither is picked, nothing is merged, a SEPARATE customer carries what was typed, and it is found again by the next identical booking", async () => {
    const p = await provider();
    const org = p.business.organizationId;
    const a = await insertCustomer(org, "Alice Adams", "(555) 010-0001", "alice@example.test");
    const b = await insertCustomer(org, "Bob Brown", "(555) 010-0002", "bob@example.test");
    const before = await customersOf(org);

    // Alice's email with Bob's phone.
    expect(await book(p, { name: "Alice Adams", phone: "(555) 010-0002", email: "alice@example.test" })).toMatchObject({ ok: true });
    const after = await customersOf(org);
    expect(after).toHaveLength(3);
    // Alice and Bob are exactly as they were; the new customer carries the booker's own email and phone.
    expect(after.filter((customer) => customer.slug === a || customer.slug === b)).toEqual(before);
    const separate = after.find((customer) => customer.slug !== a && customer.slug !== b)!;
    expect(separate).toMatchObject({ name: "Alice Adams", email: "alice@example.test", phone: "(555) 010-0002" });
    expect((await bookingsOf(org))[0].customer).toBe(separate.slug);

    // The same booking again finds the separate customer by its exact identity; no third, no fourth.
    await book(p, { name: "Alice Adams", phone: "555.010.0002", email: "ALICE@example.test" });
    expect(await customersOf(org)).toHaveLength(3);
    expect((await bookingsOf(org)).map((booking) => booking.customer)).toEqual([separate.slug, separate.slug]);

    // And Alice, with her own phone, is still Alice.
    await book(p, { name: "Alice Adams", phone: "(555) 010-0001", email: "alice@example.test" });
    expect((await bookingsOf(org))[2].customer).toBe(a);
  });

  test("a phone several customers share, with a new email: a separate customer, and the next identical booking finds it", async () => {
    const p = await provider();
    const org = p.business.organizationId;
    await insertCustomer(org, "Home One", "(555) 010-7777", "one@example.test");
    await insertCustomer(org, "Home Two", "(555) 010-7777", "two@example.test");
    const who = { name: "Visitor Three", phone: "(555) 010-7777", email: "three@example.test" };
    await book(p, who);
    expect(await customersOf(org)).toHaveLength(3);
    const first = (await bookingsOf(org))[0].customer;
    expect(first).toBe("visitor-three");
    await book(p, who);
    expect(await customersOf(org)).toHaveLength(3);
    expect((await bookingsOf(org))[1].customer).toBe(first);
  });

  test("with only a phone, or only an email, the booker is still recognised; with neither, the booking keeps the visitor's details and no customer is made", async () => {
    const p = await provider();
    const org = p.business.organizationId;
    // Phone only (the form always asks for both, so this is the database holding its line).
    await book(p, { name: "Phone Only", phone: "(555) 010-3333", email: "" });
    await book(p, { name: "Phone Only", phone: "555.010.3333", email: "" });
    // Email only.
    await book(p, { name: "Email Only", phone: "", email: "emailonly@example.test" });
    await book(p, { name: "Email Only", phone: "n/a", email: "EMAILONLY@example.test" });
    expect((await customersOf(org)).map((customer) => customer.slug)).toEqual(["phone-only", "email-only"]);
    expect((await bookingsOf(org)).map((booking) => booking.customer)).toEqual(["phone-only", "phone-only", "email-only", "email-only"]);
    // Neither: nobody to recognise.
    await book(p, { name: "No Details", phone: "n/a", email: "" });
    expect(await customersOf(org)).toHaveLength(2);
    expect((await bookingsOf(org))[4]).toMatchObject({ customer: null, contact_name: "No Details", contact_phone: "n/a", contact_email: "", contact_address: "1402 South Congress Ave, Austin, TX 78704" });
  });

  test("the same identity at another business is another customer there: nothing is shared across businesses, and a booking's customer is always its own business's", async () => {
    const first = await provider("custacqa");
    const second = await provider("custacqb");
    const who = dana();
    await book(first, who);
    await book(second, who);
    await book(second, who);
    const [a, b] = [await customersOf(first.business.organizationId), await customersOf(second.business.organizationId)];
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    const orphans = await owner.pool.query<{ n: number }>(
      "select count(*)::int as n from bookings b join customers c on c.id = b.customer_id where c.organization_id <> b.organization_id and b.organization_id = any($1)",
      [[first.business.organizationId, second.business.organizationId]],
    );
    expect(orphans.rows[0].n).toBe(0);
    // The database refuses it as well, whoever asks: a booking cannot point at another business's customer.
    const stray = await owner.pool.query("select id from customers where organization_id = $1 limit 1", [second.business.organizationId]);
    await expect(
      owner.pool.query("update bookings set customer_id = $2, contact_name = null where organization_id = $1 and number = (select min(number) from bookings where organization_id = $1)", [first.business.organizationId, stray.rows[0].id]),
    ).rejects.toMatchObject({ code: "23503", constraint: "bookings_customer_fk" });
  });

  test("a repeat of a request makes no customer and no booking", async () => {
    const p = await provider();
    const who = dana();
    const key = `key-${token()}${token()}`;
    const date = nextDate();
    expect(await book(p, who, { key, date })).toMatchObject({ ok: true, duplicate: false });
    // The same submission again, and the same person asking for the same Service at the same time again, with a new key and a differently typed email.
    expect(await book(p, who, { key, date })).toMatchObject({ ok: true, duplicate: true });
    expect(await book(p, { ...who, email: who.email.toUpperCase() }, { date })).toMatchObject({ ok: true, duplicate: true });
    expect(await customersOf(p.business.organizationId)).toHaveLength(1);
    expect(await bookingsOf(p.business.organizationId)).toHaveLength(1);
  });

  test("a booking that is refused leaves no customer behind, whether it is refused before the customer is made or after", async () => {
    const p = await provider();
    const org = p.business.organizationId;
    // Before: the details are wrong, the Service is not offered.
    expect(await app.query("select app_public_create_marketplace_booking($1, $2, $3, $4::date, '10:00'::time, '09:00'::time, 'Late Person', '(555) 010-4444', 'late@example.test', '1 A St', null, null, null, null, null) as r", [p.slug, SAMPLE_SERVICES.repair, `key-${token()}${token()}`, nextDate()]).then((r) => r.rows[0].r)).toMatchObject({ ok: false, reason: "details" });
    expect(await book(p, dana(), { service: "no-such-service" })).toMatchObject({ ok: false, reason: "service" });
    // After: the customer is found or made, and then the booking itself breaks a rule (a source the table does not allow). The whole statement is undone.
    const service = (await owner.pool.query<{ id: string }>("select id from services where organization_id = $1 and slug = $2", [org, SAMPLE_SERVICES.repair])).rows[0].id;
    await expect(
      owner.pool.query("select app_insert_public_booking($1, $2, 'instant', 'Carrier pigeon', null, null, null, $3, $4::date, '09:00'::time, '10:00'::time, 'Pigeon Person', '(555) 010-5555', 'pigeon@example.test', '1 A St', null, null, null, now())", [org, service, `key-${token()}${token()}`, nextDate()]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await customersOf(org)).toEqual([]);
    expect(await bookingsOf(org)).toEqual([]);
  });

  test("bookings that have no customer today are left as they are: nothing looks backwards", async () => {
    const p = await provider();
    const org = p.business.organizationId;
    const service = (await owner.pool.query<{ id: string }>("select id from services where organization_id = $1 and slug = $2", [org, SAMPLE_SERVICES.repair])).rows[0].id;
    await owner.pool.query(
      "insert into bookings (organization_id, number, service_id, contact_name, contact_phone, contact_email, contact_address, source, status, service_date, start_time, end_time) values ($1, 5001, $2, 'Old Guest', '(555) 010-6666', 'old@example.test', '1 Old St', 'Website', 'pending', '2030-01-01', '09:00', '10:00')",
      [org, service],
    );
    await book(p, { name: "Old Guest", phone: "(555) 010-6666", email: "old@example.test" });
    const bookings = await bookingsOf(org);
    expect(bookings.find((booking) => booking.number === 5001)).toMatchObject({ customer: null, contact_name: "Old Guest", contact_email: "old@example.test" });
    expect(await customersOf(org)).toHaveLength(1);
  });
});

/* ───────────────────────────── at the same time ───────────────────────────── */

test.describe("many bookings at once never make the same customer twice", () => {
  for (let round = 1; round <= 3; round++) {
    test(`round ${round}: twelve bookings by one person at the same instant are one customer; six people booking three times each are six`, async () => {
      const p = await provider();
      const org = p.business.organizationId;
      const who = dana();
      const results = await Promise.all(Array.from({ length: 12 }, () => book(p, who)));
      expect(results.every((result) => result.ok)).toBe(true);
      expect(await customersOf(org)).toHaveLength(1);
      expect(new Set((await bookingsOf(org)).map((booking) => booking.customer_id)).size).toBe(1);

      const people = Array.from({ length: 6 }, (_, index): Who => ({ name: `Person ${index}`, phone: `(555) 011-000${index}`, email: `person-${index}-${token()}@example.test` }));
      await Promise.all(people.flatMap((person) => [book(p, person), book(p, person), book(p, person)]));
      expect(await customersOf(org)).toHaveLength(7);
      const grouped = await owner.pool.query<{ n: number }>("select count(*)::int as n from bookings where organization_id = $1 group by customer_id order by n", [org]);
      expect(grouped.rows.map((row) => row.n)).toEqual([3, 3, 3, 3, 3, 3, 12]);
    });
  }

  test("a conflict arriving eight times at once makes ONE separate customer, and the two it conflicts with are untouched", async () => {
    const p = await provider();
    const org = p.business.organizationId;
    const a = await insertCustomer(org, "Alice Adams", "(555) 010-0001", "alice@example.test");
    const b = await insertCustomer(org, "Bob Brown", "(555) 010-0002", "bob@example.test");
    const before = await customersOf(org);
    await Promise.all(Array.from({ length: 8 }, () => book(p, { name: "Alice Adams", phone: "(555) 010-0002", email: "alice@example.test" })));
    const after = await customersOf(org);
    expect(after).toHaveLength(3);
    expect(after.filter((customer) => customer.slug === a || customer.slug === b)).toEqual(before);
    expect(new Set((await bookingsOf(org)).map((booking) => booking.customer)).size).toBe(1);
  });

  for (let round = 1; round <= 3; round++) {
    test(`round ${round}: an owner adding a customer while that person books, again and again, leaves one customer with that email`, async () => {
      const p = await provider();
      const org = p.business.organizationId;
      const who = dana();
      const [added] = await Promise.all([
        withTenant({ userId: p.business.owner.userId, organizationId: org }, (tx) => createCustomer(tx, org, { name: who.name, email: who.email, phone: who.phone, preferredContact: "SMS" })),
        book(p, who),
        book(p, who),
        book(p, who),
        book(p, who),
      ]);
      const customers = await customersOf(org);
      expect(customers.filter((customer) => customer.email_key === who.email)).toHaveLength(1);
      expect(customers).toHaveLength(1);
      // Whoever was first, nobody was refused for being second, and every booking is that customer's.
      expect(added.created || added.existing.name === who.name).toBe(true);
      expect((await bookingsOf(org)).every((booking) => booking.customer === customers[0].slug)).toBe(true);
    });
  }
});

/* ───────────────────────────── by hand ───────────────────────────── */

test.describe("adding a customer by hand: the runtime role, the policy and the lock", () => {
  test("an owner and an admin of the active business may add a customer; a member, a stranger and no one at all may not; UPDATE and DELETE are still closed", async () => {
    const p = await provider();
    const other = await provider();
    const org = p.business.organizationId;
    const insert = (client: PoolClient, organizationId: string, slug: string) => client.query("insert into customers (organization_id, slug, name, email) values ($1, $2, 'Hand Added', $3)", [organizationId, slug, `${slug}@example.test`]);

    for (const person of [p.business.owner, p.business.admin]) {
      await asTenant(app, person.userId, org, async (client) => {
        await insert(client, org, `by-${token()}`);
        expect((await client.query("select count(*)::int as n from customers")).rows[0].n).toBeGreaterThanOrEqual(1);
      });
    }
    // A member sees the customers and cannot add one.
    await asTenant(app, p.business.member.userId, org, async (client) => {
      await expect(insert(client, org, "by-member")).rejects.toMatchObject({ code: "42501" });
    });
    // A member of ANOTHER business, naming this one, and an owner naming the other business while acting in this one.
    await asTenant(app, other.business.owner.userId, org, async (client) => {
      await expect(insert(client, org, "by-stranger")).rejects.toMatchObject({ code: "42501" });
    });
    await asTenant(app, p.business.owner.userId, org, async (client) => {
      await expect(insert(client, other.business.organizationId, "by-forged-org")).rejects.toMatchObject({ code: "42501" });
    });
    // A platform administrator is not a member of a business because of it.
    const platform = await makePlatformAdmin("custdbpa", owner.db, owner.pool);
    await asTenant(app, platform.userId, org, async (client) => {
      await expect(insert(client, org, "by-platform")).rejects.toMatchObject({ code: "42501" });
    });
    // No context: the policies are all false.
    await asTenant(app, null, null, async (client) => {
      await expect(insert(client, org, "by-nobody")).rejects.toMatchObject({ code: "42501" });
    });
    // Nothing else about customers opened: no UPDATE, no DELETE, and the generated keys cannot be written.
    await asTenant(app, p.business.owner.userId, org, async (client) => {
      await insert(client, org, "by-owner-2");
      await client.query("savepoint s1");
      await expect(client.query("update customers set name = 'Changed' where organization_id = $1", [org])).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback to savepoint s1");
      await expect(client.query("delete from customers where organization_id = $1", [org])).rejects.toMatchObject({ code: "42501" });
    });
    expect((await customersOf(other.business.organizationId))).toEqual([]);
    expect((await customersOf(org)).filter((customer) => customer.slug.startsWith("by-")).length).toBe(0);
  });

  test("the unique identity: the same email AND phone twice in one business is refused by the database; the same email alone, the same phone alone and the same identity in another business are not", async () => {
    const p = await provider();
    const other = await provider();
    const org = p.business.organizationId;
    await asTenant(
      app,
      p.business.owner.userId,
      org,
      async (client) => {
        await client.query("insert into customers (organization_id, slug, name, email, phone) values ($1, $2, 'First', 'same@example.test', '(555) 010-8888')", [org, `first-${token()}`]);
      },
      { commit: true },
    );
    const again = (slug: string, email: string | null, phone: string) =>
      asTenant(app, p.business.owner.userId, org, (client) => client.query("insert into customers (organization_id, slug, name, email, phone) values ($1, $2, 'Twin', $3, $4)", [org, slug, email, phone]));
    await expect(again(`twin-${token()}`, " SAME@example.test", "555-010-8888")).rejects.toMatchObject({ code: "23505", constraint: "customers_org_identity_unique" });
    await again(`twin-${token()}`, "same@example.test", "(555) 010-9999");
    await again(`twin-${token()}`, "other@example.test", "(555) 010-8888");
    await again(`twin-${token()}`, null, "(555) 010-8888");
    await asTenant(app, other.business.owner.userId, other.business.organizationId, (client) =>
      client.query("insert into customers (organization_id, slug, name, email, phone) values ($1, $2, 'Twin', 'same@example.test', '(555) 010-8888')", [other.business.organizationId, `twin-${token()}`]),
    );
  });

  test("the functions that find and make customers are internal: the runtime role cannot call them, and the public booking functions stay what they were", async () => {
    const rows = (
      await owner.pool.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; acl: string[] | null; volatility: string }>(
        `select proname, prosecdef, proconfig, proacl::text[] as acl, provolatile as volatility from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('app_resolve_public_customer', 'app_insert_public_booking', 'app_email_key', 'app_phone_key', 'app_public_create_booking', 'app_public_create_marketplace_booking') order by proname`,
      )
    ).rows;
    const byName = Object.fromEntries(rows.map((row) => [row.proname, row]));
    expect(Object.keys(byName)).toHaveLength(6);
    for (const internal of ["app_resolve_public_customer", "app_insert_public_booking"]) {
      expect((byName[internal].acl ?? []).filter((entry) => entry.startsWith("=") || entry.startsWith("climvia_app=")), `${internal} is executable by no one but its owner`).toEqual([]);
    }
    for (const pure of ["app_email_key", "app_phone_key"]) {
      expect(byName[pure].volatility, pure).toBe("i");
      expect((byName[pure].acl ?? []).some((entry) => entry.startsWith("=")), `${pure} is not open to PUBLIC`).toBe(false);
      expect((byName[pure].acl ?? []).some((entry) => entry.startsWith("climvia_app=X")), `${pure} is executable by the runtime role`).toBe(true);
    }
    for (const open of ["app_public_create_booking", "app_public_create_marketplace_booking"]) {
      expect(byName[open].prosecdef, open).toBe(true);
      expect(byName[open].proconfig?.join(","), open).toContain("search_path=public, pg_temp");
    }
    await expect(app.query("select app_resolve_public_customer($1, 'X', '(555) 010-0000', 'x@example.test')", [(await owner.pool.query("select id from organizations limit 1")).rows[0].id])).rejects.toMatchObject({ code: "42501" });
    // And through it nothing leaks across businesses: the runtime role cannot read another business's customers by any route this change added.
    const p = await provider();
    const other = await provider();
    await insertCustomer(other.business.organizationId, "Hidden Person", "(555) 010-1212", "hidden@example.test");
    await asTenant(app, p.business.owner.userId, p.business.organizationId, async (client) => {
      expect((await client.query("select count(*)::int as n from customers")).rows[0].n).toBe(0);
      expect((await client.query("select count(*)::int as n from customers where email_key = 'hidden@example.test' or phone_key = '5550101212'")).rows[0].n).toBe(0);
    });
  });
});

/* ───────────────────────────── what the action does with it ───────────────────────────── */

test.describe("createCustomer, the query the Add customer action runs", () => {
  test("it stores what it is given, chooses the public reference itself, and refuses a second customer with the same email (a shared phone is fine)", async () => {
    const p = await provider();
    const org = p.business.organizationId;
    const run = (input: Parameters<typeof createCustomer>[2]) => withTenant({ userId: p.business.owner.userId, organizationId: org }, (tx) => createCustomer(tx, org, input));

    expect(await run({ name: "Dana Lee", email: "dana@example.test", phone: "(555) 010-0100", preferredContact: "SMS" })).toEqual({ created: true, slug: "dana-lee" });
    // The same name is another customer when the email differs: the reference gets a number.
    expect(await run({ name: "Dana Lee", email: "dana2@example.test", phone: "(555) 010-0100", preferredContact: "Email" })).toEqual({ created: true, slug: "dana-lee-2" });
    // The same email, however it is typed, is the customer already on the list.
    for (const email of ["dana@example.test", "  DANA@Example.Test "]) {
      expect(await run({ name: "Someone Else", email, phone: null, preferredContact: "Email" })).toEqual({ created: false, existing: { slug: "dana-lee", name: "Dana Lee" } });
    }
    // A phone number alone, and a name with no email, are fine.
    expect(await run({ name: "Phone Person", email: null, phone: "(555) 010-0100", preferredContact: "Phone" })).toEqual({ created: true, slug: "phone-person" });
    expect(await run({ name: "Phone Person", email: null, phone: "(555) 010-0100", preferredContact: "Phone" })).toEqual({ created: true, slug: "phone-person-2" });
    const customers = await customersOf(org);
    expect(customers).toHaveLength(4);
    expect(customers.find((customer) => customer.slug === "dana-lee-2")).toMatchObject({ email: "dana2@example.test", phone: "(555) 010-0100" });
    // A customer who now exists is found by their next booking (exact email and phone) rather than made again.
    await book(p, { name: "Dana Lee", phone: "(555) 010-0100", email: "dana@example.test" });
    expect(await customersOf(org)).toHaveLength(4);
    expect((await bookingsOf(org))[0].customer).toBe("dana-lee");
  });

  test("two owners adding the same email at the same instant make one customer", async () => {
    const p = await provider();
    const org = p.business.organizationId;
    const run = () => withTenant({ userId: p.business.owner.userId, organizationId: org }, (tx) => createCustomer(tx, org, { name: "Race Person", email: "race@example.test", phone: null, preferredContact: "Email" }));
    const results = await Promise.all([run(), run(), run(), run(), run()]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await customersOf(org)).toHaveLength(1);
  });
});
