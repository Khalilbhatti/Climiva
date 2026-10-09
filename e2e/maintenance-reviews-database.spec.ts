/**
 * Phase 13: tenant isolation and integrity of the maintenance and review tables at the DATABASE, independent of the application code.
 *
 * Like financials-database.spec.ts, these connect to the freshly migrated and seeded test database as the restricted runtime role
 * the app uses (`climvia_app`, DATABASE_URL), set the transaction-local context the way src/db/tenant.ts does, and check that
 * PostgreSQL itself keeps businesses apart: Row Level Security for who may read and write, column grants for what may change,
 * composite foreign keys for what may point at what, and triggers for what a visit, a reply and a request may do. Almost every test
 * runs in a transaction that is rolled back; the concurrency tests that must commit use the worker's own copy of the Apex business.
 */
import { randomBytes } from "node:crypto";
import { test as base, expect } from "playwright/test";
import { Pool, type PoolClient } from "pg";
import { loadRefs } from "../src/db/ops-queries";
import { createRequestTx, editReplyTx, loadReviews, postReplyTx, type ReviewContext } from "../src/db/review-queries";
import { stableId } from "../src/db/stable-id";
import { withTenant } from "../src/db/tenant";
import { Refusal } from "../src/lib/refusal";
import { test as saasTest } from "./saas";

const test = base;

const SEED = {
  alex: "alex.morgan@apex.test", // Apex owner
  jamie: "jamie.rivera@apex.test", // Apex member
  taylor: "taylor.brooks@northstar.test", // Northstar owner
  casey: "casey.nguyen@climvia.test", // admin in both
};

const TABLES = ["maintenance_plans", "maintenance_plan_coverage", "maintenance_plan_visits", "reviews", "review_replies", "review_requests"];

let app: Pool;
let admin: Pool;
const user: Record<string, string> = {};
let apex = "";
let northstar = "";
/** Database ids of the records the tests point at, per business. */
const a: Record<string, string> = {};
const n: Record<string, string> = {};

const idOf = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0].id;
const bySlug = (table: string, organizationId: string, slug: string) => idOf(`select id from ${table} where organization_id = $1 and slug = $2`, [organizationId, slug]);
const byNumber = (table: string, organizationId: string, number: number) => idOf(`select id from ${table} where organization_id = $1 and number = $2`, [organizationId, number]);
const byRef = (organizationId: string, ref: string) => idOf("select id from maintenance_plan_visits where organization_id = $1 and ref = $2", [organizationId, ref]);

test.beforeAll(async () => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 24 });
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
  for (const [key, email] of Object.entries(SEED)) user[key] = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
  apex = await idOf("select id from organizations where slug = 'apex-climate-heating-air'", []);
  northstar = await idOf("select id from organizations where slug = 'northstar-heating-cooling'", []);

  a.sarah = await bySlug("customers", apex, "sarah-mitchell");
  a.david = await bySlug("customers", apex, "david-chen");
  a.sarahHome = await bySlug("customer_properties", apex, "prop-sarah-home");
  a.davidHome = await bySlug("customer_properties", apex, "prop-david-home");
  a.job204 = await byNumber("jobs", apex, 204);
  a.planSarah = await bySlug("maintenance_plans", apex, "plan-sarah-comfort-care");
  a.planDavid = await bySlug("maintenance_plans", apex, "plan-david-seasonal-maintenance");
  a.v1 = await byRef(apex, "plan-sarah-comfort-care-v1");
  a.v2 = await byRef(apex, "plan-sarah-comfort-care-v2");
  a.davidV1 = await byRef(apex, "plan-david-seasonal-maintenance-v1");
  a.booking1048 = await byNumber("bookings", apex, 1048);
  a.revSarah = await bySlug("reviews", apex, "rev-sarah-mitchell");
  a.revDavid = await bySlug("reviews", apex, "rev-david-chen");
  a.revElena = await bySlug("reviews", apex, "rev-elena-rodriguez");
  a.bookingSarah = (await admin.query<{ id: string }>("select id from bookings where organization_id = $1 and customer_id = $2 order by number limit 1", [apex, a.sarah])).rows[0].id;
  a.bookingDavid = (await admin.query<{ id: string }>("select id from bookings where organization_id = $1 and customer_id = $2 order by number limit 1", [apex, a.david])).rows[0].id;
  // A job that is not completed (the guard on requests), and one of David's that is.
  a.jobOpen = (await admin.query<{ id: string }>("select id from jobs where organization_id = $1 and status <> 'completed' order by number limit 1", [apex])).rows[0].id;
  a.jobDavid = (await admin.query<{ id: string }>("select id from jobs where organization_id = $1 and customer_id = $2 and status = 'completed' order by number limit 1", [apex, a.david])).rows[0].id;

  n.marta = await bySlug("customers", northstar, "marta-olsen");
  n.priya = await bySlug("customers", northstar, "priya-raman");
  n.house = await bySlug("customer_properties", northstar, "prop-olsen-house");
  n.planMarta = await bySlug("maintenance_plans", northstar, "plan-marta-olsen-furnace-care");
  n.v1 = await byRef(northstar, "plan-marta-olsen-furnace-care-v1");
  n.v2 = await byRef(northstar, "plan-marta-olsen-furnace-care-v2");
  n.booking1001 = await byNumber("bookings", northstar, 1001);
  n.job1001 = await byNumber("jobs", northstar, 1001);
  n.revPriya = await bySlug("reviews", northstar, "rev-priya-raman");
  n.revMarta = await bySlug("reviews", northstar, "rev-marta-olsen");
});

test.afterAll(async () => {
  await app.end();
  await admin.end();
});

type Outcome<T> = { value: T; error?: undefined; code?: undefined; constraint?: undefined } | { value?: undefined; error: string; code?: string; constraint?: string };

const failure = (error: unknown): { error: string; code?: string; constraint?: string } => ({
  error: error instanceof Error ? error.message : String(error),
  code: (error as { code?: string }).code,
  constraint: (error as { constraint?: string }).constraint,
});

/** Run `fn` as `userId` inside `org` (either may be absent), in a transaction that is always rolled back. */
async function as<T>(userId: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId ?? "", org ?? ""]);
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** The same, through the owner role (no Row Level Security): for what only the seed may write, to check the constraints. */
async function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await admin.connect();
  try {
    await client.query("begin");
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

const count = async (client: PoolClient, table: string) => (await client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
const PERMISSION = "42501";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const CHECK = "23514";
const NOT_NULL = "23502";
const IDENTITY = "428C9";

async function insertRow(client: PoolClient, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const result = await client.query<{ id: string }>(
    `insert into ${table} (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
    columns.map((column) => row[column]),
  );
  return result.rows[0].id;
}

let sequence = 0;
const unique = (label: string) => `${label}-${(sequence += 1)}-${randomBytes(2).toString("hex")}`;

const insertPlan = (client: PoolClient, org: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "maintenance_plans", {
    organization_id: org,
    slug: unique("plan-test"),
    customer_id: a.sarah,
    property_id: a.sarahHome,
    name: "Test plan",
    status: "active",
    price_cents: 18900,
    cadence: "year",
    start_date: "2030-01-01",
    end_date: "2031-01-01",
    visits_per_year: 2,
    ...values,
  });
const insertCoverage = (client: PoolClient, org: string, plan: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "maintenance_plan_coverage", { organization_id: org, plan_id: plan, coverage_key: "cooling", label: "Cooling maintenance", visits: 1, sort_order: 1, ...values });
const insertVisit = (client: PoolClient, org: string, plan: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "maintenance_plan_visits", { organization_id: org, plan_id: plan, ref: unique("visit-test"), sequence: 1, label: "Cooling maintenance", status: "due", ...values });
const insertReply = (client: PoolClient, org: string, review: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "review_replies", { organization_id: org, review_id: review, body: "Thank you.", author_name: "Alex Morgan", replied_at: "2030-01-02T12:00:00Z", ...values });
const insertRequest = (client: PoolClient, org: string, customer: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "review_requests", { organization_id: org, customer_id: customer, channel: "email", message: "Please review us.", status: "recorded", requested_at: "2030-01-02T12:00:00Z", ...values });
const insertReview = (client: PoolClient, org: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "reviews", { organization_id: org, slug: unique("rev-test"), customer_id: a.sarah, source: "Climvia", rating: 5, review_text: "Great.", submitted_on: "2030-01-02", ...values });

/** A plan of the business's own with `visits` due visits, all created in the open transaction (so the child rows may join it). */
async function newPlan(client: PoolClient, org: string, customer: string, property: string, visits = 2) {
  const plan = await insertPlan(client, org, { customer_id: customer, property_id: property, visits_per_year: visits });
  const coverage = await insertCoverage(client, org, plan, { visits });
  const ids: string[] = [];
  for (let index = 1; index <= visits; index += 1) ids.push(await insertVisit(client, org, plan, { coverage_id: coverage, sequence: index }));
  return { plan, coverage, visits: ids };
}

/** A copy of one of the business's bookings under a new number, for tests that attach a booking to a visit. */
async function copyBooking(client: PoolClient, source: string, number: number, status = "confirmed"): Promise<string> {
  const reason = status === "cancelled" ? "'Test'" : "null";
  const result = await client.query<{ id: string }>(
    `insert into bookings select (jsonb_populate_record(null::bookings, to_jsonb(b) || jsonb_build_object('id', gen_random_uuid(), 'number', $2::int, 'status', $3::text, 'cancellation_reason', ${reason}))).* from bookings b where b.id = $1 returning id`,
    [source, number, status],
  );
  return result.rows[0].id;
}

/* ───────────────────────── what the seed holds ───────────────────────── */

test.describe("what the seed holds", () => {
  test("Sarah Mitchell's Comfort Care: $189 a year in cents, 2 visits, May 14 2024 to May 14 2025, Active, her own property", async () => {
    const plan = (await admin.query("select name, status, price_cents, cadence, start_date::text as start, end_date::text as ending, visits_per_year, customer_id, property_id, imported, contact_name from maintenance_plans where id = $1", [a.planSarah])).rows[0];
    expect(plan).toEqual({
      name: "Comfort Care",
      status: "active",
      price_cents: 18900,
      cadence: "year",
      start: "2024-05-14",
      ending: "2025-05-14",
      visits_per_year: 2,
      customer_id: a.sarah,
      property_id: a.sarahHome,
      imported: true,
      contact_name: null,
    });
  });

  test("its coverage is Cooling maintenance and Heating maintenance, one visit each, and is not a Service", async () => {
    const coverage = (await admin.query("select coverage_key, label, visits, sort_order from maintenance_plan_coverage where plan_id = $1 order by sort_order", [a.planSarah])).rows;
    expect(coverage).toEqual([
      { coverage_key: "cooling", label: "Cooling maintenance", visits: 1, sort_order: 1 },
      { coverage_key: "heating", label: "Heating maintenance", visits: 1, sort_order: 2 },
    ]);
    // Coverage points at no Service: the table has no foreign key to `services`, and the catalog gained nothing.
    const references = (
      await admin.query("select conname from pg_constraint where contype = 'f' and conrelid = 'maintenance_plan_coverage'::regclass and confrelid = 'services'::regclass")
    ).rows;
    expect(references).toEqual([]);
    expect((await admin.query("select name from services where organization_id = $1 and name ilike any(array['%cooling maintenance%', '%heating maintenance%'])", [apex])).rows).toEqual([]);
  });

  test("its first visit was fulfilled on May 22, 2024 with no booking; its second is scheduled for November 2024 and points at BK-1048", async () => {
    const visits = (await admin.query("select ref, sequence, label, status, booking_id, completed_on::text as completed_on, window_start::text as w_start, window_end::text as w_end from maintenance_plan_visits where plan_id = $1 order by sequence", [a.planSarah])).rows;
    expect(visits).toEqual([
      { ref: "plan-sarah-comfort-care-v1", sequence: 1, label: "Heating maintenance", status: "completed", booking_id: null, completed_on: "2024-05-22", w_start: null, w_end: null },
      { ref: "plan-sarah-comfort-care-v2", sequence: 2, label: "Cooling maintenance", status: "scheduled", booking_id: a.booking1048, completed_on: null, w_start: "2024-11-01", w_end: "2024-11-30" },
    ]);
  });

  test("BK-1048 is the canonical scheduled visit: exactly one booking, Sarah Mitchell's, Nov 19 2024, 10:00 AM to 12:00 PM, Marcus Vance, confirmed, no job", async () => {
    const rows = (
      await admin.query(
        `select b.number, b.status, b.source, b.service_date::text as day, b.start_time::text as start, b.end_time::text as ending, c.name as customer, p.address_line1 as street, p.city, p.state_region as state, p.postal_code as zip,
                m.name as technician, s.name as service, (select count(*)::int from jobs j where j.booking_id = b.id) as jobs
           from bookings b join customers c on c.id = b.customer_id join customer_properties p on p.id = b.property_id
           join team_members m on m.id = b.assignee_id join services s on s.id = b.service_id
          where b.organization_id = $1 and b.number = 1048`,
        [apex],
      )
    ).rows;
    expect(rows).toEqual([
      {
        number: 1048,
        status: "confirmed",
        source: "Maintenance plan",
        day: "2024-11-19",
        start: "10:00:00",
        ending: "12:00:00",
        customer: "Sarah Mitchell",
        street: "1402 Kinney Ave",
        city: "Austin",
        state: "TX",
        zip: "78704",
        technician: "Marcus Vance",
        service: "Annual Cooling Tune-Up & Maintenance",
        jobs: 0,
      },
    ]);
    // It is the booking visit 2 points at, and no other visit points at it. Neither plan nor visit carries a copy of the appointment.
    expect((await admin.query("select v.ref from maintenance_plan_visits v where v.booking_id = $1", [a.booking1048])).rows).toEqual([{ ref: "plan-sarah-comfort-care-v2" }]);
    const columns = (await admin.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'maintenance_plan_visits' and column_name in ('service_date', 'start_time', 'end_time', 'assignee_id', 'service_id', 'customer_id', 'property_id')")).rows;
    expect(columns).toEqual([]);
  });

  test("the booking counter starts where the approved baseline put it (BK-1043 next) and numbers walk past the stored BK-1048", async () => {
    expect((await admin.query("select next_value from organization_sequences where organization_id = $1 and kind = 'booking'", [apex])).rows[0].next_value).toBe(1043);
    expect((await admin.query("select max(number)::int as n from bookings where organization_id = $1", [apex])).rows[0].n).toBe(1048);
  });

  test("a plan's price bills no one: no invoice, quote or payment names a plan, and no column in them could", async () => {
    const columns = (await admin.query<{ table_name: string; column_name: string }>("select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('invoices', 'quotes', 'payments', 'invoice_line_items', 'quote_line_items') and column_name ~ 'plan'")).rows;
    expect(columns).toEqual([]);
    // Money is whole cents in an integer column.
    const type = (await admin.query("select data_type from information_schema.columns where table_name = 'maintenance_plans' and column_name = 'price_cents'")).rows[0].data_type;
    expect(type).toBe("integer");
    expect((await admin.query("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name like 'maintenance_plan%' and data_type in ('real', 'double precision', 'money', 'numeric')")).rows[0].n).toBe(0);
  });

  test("Apex's six plans use the product's own statuses and are carried-in history; Northstar's one is not", async () => {
    const plans = (await admin.query("select slug, status, imported, price_cents from maintenance_plans where organization_id = $1 order by slug", [apex])).rows;
    expect(plans).toHaveLength(6);
    expect(plans.every((plan) => plan.imported === true)).toBe(true);
    expect(new Set(plans.map((plan) => plan.status))).toEqual(new Set(["active", "paused", "ended"]));
    expect((await admin.query("select slug, status, imported, price_cents from maintenance_plans where organization_id = $1", [northstar])).rows).toEqual([
      { slug: "plan-marta-olsen-furnace-care", status: "active", imported: false, price_cents: 14900 },
    ]);
    // The workspace totals the screens report (14 / 5 / 3 / 2) are not dozens of invented rows.
    expect(plans.length).toBeLessThan(10);
  });

  test("Sarah Mitchell's review: 5 stars, source Climvia, her own words, about JB-204 (which stays Completed), no reply yet", async () => {
    const review = (await admin.query("select r.rating, r.source, r.review_text, r.submitted_on::text as submitted, r.customer_id, r.job_id, r.imported, r.reply_draft, j.number as job, j.status as job_status from reviews r join jobs j on j.id = r.job_id where r.id = $1", [a.revSarah])).rows[0];
    expect(review).toEqual({
      rating: 5,
      source: "Climvia",
      review_text: "The technician explained the repair clearly and completed the work as scheduled.",
      submitted: "2024-10-25",
      customer_id: a.sarah,
      job_id: a.job204,
      imported: true,
      reply_draft: "Thank you, Sarah. We appreciate your feedback and are glad the repair process was clear and completed as scheduled.",
      job: 204,
      job_status: "completed",
    });
    expect((await admin.query("select count(*)::int as n from review_replies where review_id = $1", [a.revSarah])).rows[0].n).toBe(0);
  });

  test("the other Apex reviews: David's is answered, Elena's awaits a reply, Marcus Sterling is a name with no customer record", async () => {
    const reviews = (await admin.query("select r.slug, r.rating, r.customer_id is not null as has_customer, r.contact_name, (select count(*)::int from review_replies p where p.review_id = r.id) as replies from reviews r where r.organization_id = $1 order by r.slug", [apex])).rows;
    expect(reviews).toEqual([
      { slug: "rev-david-chen", rating: 4, has_customer: true, contact_name: null, replies: 1 },
      { slug: "rev-elena-rodriguez", rating: 5, has_customer: true, contact_name: null, replies: 0 },
      { slug: "rev-marcus-sterling", rating: 5, has_customer: false, contact_name: "Marcus Sterling", replies: 1 },
      { slug: "rev-sarah-mitchell", rating: 5, has_customer: true, contact_name: null, replies: 0 },
    ]);
    expect((await admin.query("select count(*)::int as n from review_requests where organization_id = $1", [apex])).rows[0].n).toBe(0);
  });

  test("Northstar's plan, bookings, reviews and request are its own: nothing of Apex's appears in them", async () => {
    const visits = (await admin.query("select ref, status, booking_id from maintenance_plan_visits where organization_id = $1 order by sequence", [northstar])).rows;
    expect(visits).toEqual([
      { ref: "plan-marta-olsen-furnace-care-v1", status: "scheduled", booking_id: n.booking1001 },
      { ref: "plan-marta-olsen-furnace-care-v2", status: "due", booking_id: null },
    ]);
    // Northstar's BK-1001 is a different record from any Apex booking.
    expect(stableId(northstar, "booking", "BK-1001")).toBe(n.booking1001);
    const reviews = (await admin.query("select slug, rating, review_text from reviews where organization_id = $1 order by slug", [northstar])).rows;
    expect(reviews.map((row) => row.slug)).toEqual(["rev-marta-olsen", "rev-priya-raman"]);
    expect(reviews.map((row) => row.review_text).join(" ")).not.toMatch(/technician explained the repair/);
    expect((await admin.query("select count(*)::int as n from review_replies where organization_id = $1", [northstar])).rows[0].n).toBe(1);
    expect((await admin.query("select count(*)::int as n from review_requests where organization_id = $1", [northstar])).rows[0].n).toBe(1);
    // Every row of these tables belongs to a business that exists, and none names a record of another business.
    for (const [table, via] of [
      ["maintenance_plans", "customers c on c.id = t.customer_id"],
      ["reviews", "customers c on c.id = t.customer_id"],
      ["review_requests", "customers c on c.id = t.customer_id"],
    ] as const) {
      const crossed = (await admin.query(`select count(*)::int as n from ${table} t join ${via} where c.organization_id <> t.organization_id`)).rows[0].n;
      expect(crossed, table).toBe(0);
    }
  });
});

/* ───────────────────────── the structure ───────────────────────── */

test.describe("the structure", () => {
  test("every table has Row Level Security enabled and carries a required organization_id", async () => {
    const tables = (await admin.query<{ relname: string; rls: boolean }>("select c.relname, c.relrowsecurity as rls from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by c.relname", [TABLES])).rows;
    expect(tables.map((table) => table.relname).sort()).toEqual([...TABLES].sort());
    for (const table of tables) expect(table.rls, table.relname).toBe(true);
    const columns = (await admin.query<{ table_name: string }>("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and is_nullable = 'NO' and table_name = any($1)", [TABLES])).rows;
    expect(columns.map((row) => row.table_name).sort()).toEqual([...TABLES].sort());
  });

  test("every reference to another tenant table is a composite (organization_id, ...) foreign key", async () => {
    const keys = (
      await admin.query<{ conrelid: string; conname: string; definition: string }>(
        `select conrelid::regclass::text as conrelid, conname, pg_get_constraintdef(oid) as definition
           from pg_constraint
          where contype = 'f' and conrelid::regclass::text = any($1) and confrelid::regclass::text <> 'organizations'`,
        [TABLES],
      )
    ).rows;
    expect(keys.length).toBeGreaterThanOrEqual(14);
    for (const key of keys) expect(key.definition, `${key.conrelid}.${key.conname}`).toMatch(/^FOREIGN KEY \(organization_id, /);
    // And every table's own link to its business is the plain foreign key to organizations.
    const owners = (await admin.query("select count(*)::int as n from pg_constraint where contype = 'f' and conrelid::regclass::text = any($1) and confrelid::regclass::text = 'organizations'", [TABLES])).rows[0].n;
    expect(owners).toBe(TABLES.length);
  });

  test("every index a lookup uses starts with the business, so a query for one business never scans another's", async () => {
    const indexes = (
      await admin.query<{ tablename: string; indexname: string; indexdef: string }>("select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) and indexname not like '%_pkey'", [TABLES])
    ).rows;
    expect(indexes.length).toBeGreaterThan(20);
    // The few that lead with the plan are unique keys that already live inside one plan (whose own key leads with the business).
    const planLevel = new Set(["plan_coverage_key_unique", "plan_coverage_order_unique", "plan_visits_order_unique"]);
    for (const index of indexes.filter((item) => !planLevel.has(item.indexname))) expect(index.indexdef, index.indexname).toMatch(/\((organization_id|"organization_id")[,)]/);
  });

  test("the runtime role can read all six tables, write only what the rules allow, and DELETE nothing", async () => {
    const privilege = async (table: string, kind: string) => (await admin.query<{ ok: boolean }>("select has_table_privilege('climvia_app', $1, $2) as ok", [table, kind])).rows[0].ok;
    for (const table of TABLES) {
      expect(await privilege(table, "SELECT"), `${table} select`).toBe(true);
      expect(await privilege(table, "DELETE"), `${table} delete`).toBe(false);
      expect(await privilege(table, "TRUNCATE"), `${table} truncate`).toBe(false);
    }
    // Table-wide UPDATE exists nowhere: plans, coverage, reviews and requests cannot change at all, visits and replies only in named columns.
    for (const table of TABLES) expect(await privilege(table, "UPDATE"), `${table} update`).toBe(false);
    expect(await privilege("reviews", "INSERT")).toBe(false);
    for (const table of ["maintenance_plans", "maintenance_plan_coverage", "maintenance_plan_visits", "review_replies", "review_requests"]) expect(await privilege(table, "INSERT"), `${table} insert`).toBe(true);
    const updatable = async (table: string) =>
      (
        await admin.query<{ attname: string }>(
          "select a.attname from pg_attribute a where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('climvia_app', a.attrelid, a.attnum, 'UPDATE') order by a.attname",
          [table],
        )
      ).rows.map((row) => row.attname);
    expect(await updatable("maintenance_plan_visits")).toEqual(["booking_id", "completed_on", "status"]);
    expect(await updatable("review_replies")).toEqual(["body"]);
    for (const table of ["maintenance_plans", "maintenance_plan_coverage", "reviews", "review_requests"]) expect(await updatable(table), table).toEqual([]);
  });

  test("each table has a read policy and write policies only where writes are allowed; no policy is for DELETE", async () => {
    const policies = (await admin.query<{ tablename: string; cmd: string }>("select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1) order by tablename, cmd", [TABLES])).rows;
    const by = (table: string) => policies.filter((policy) => policy.tablename === table).map((policy) => policy.cmd);
    expect(by("maintenance_plans")).toEqual(["INSERT", "SELECT"]);
    expect(by("maintenance_plan_coverage")).toEqual(["INSERT", "SELECT"]);
    expect(by("maintenance_plan_visits")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(by("reviews")).toEqual(["SELECT"]);
    expect(by("review_replies")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(by("review_requests")).toEqual(["INSERT", "SELECT"]);
    expect(policies.filter((policy) => policy.cmd === "DELETE" || policy.cmd === "ALL")).toEqual([]);
  });

  test("a request's position is a generated identity: nobody chooses it", async () => {
    const column = (await admin.query("select is_identity, identity_generation from information_schema.columns where table_name = 'review_requests' and column_name = 'position'")).rows[0];
    expect(column).toEqual({ is_identity: "YES", identity_generation: "ALWAYS" });
    const result = await as(user.alex, apex, (client) => insertRequest(client, apex, a.sarah, { position: 99 }));
    expect(result.error).toBeDefined();
    expect(result.code).toBe(IDENTITY);
  });

  test("the statuses are the product's: a plan or a visit with an invented status, or a rating outside 1 to 5, is refused by the table itself", async () => {
    const invented = await asOwner((client) => insertPlan(client, apex, { status: "suspended" }));
    expect(invented.constraint).toBe("plans_status");
    const visit = await asOwner(async (client) => {
      const { plan } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      return insertVisit(client, apex, plan, { sequence: 5, status: "cancelled" });
    });
    expect(visit.constraint).toBe("plan_visits_status");
    for (const rating of [0, 6, -1]) expect((await asOwner((client) => insertReview(client, apex, { rating }))).constraint, `rating ${rating}`).toBe("reviews_rating");
    expect((await asOwner((client) => insertReview(client, apex, { source: "Google" }))).constraint).toBe("reviews_source");
    expect((await asOwner((client) => insertPlan(client, apex, { cadence: "weekly" }))).constraint).toBe("plans_cadence");
    expect((await asOwner((client) => insertPlan(client, apex, { price_cents: -1 }))).constraint).toBe("plans_price");
    expect((await asOwner((client) => insertPlan(client, apex, { end_date: "2029-01-01" }))).constraint).toBe("plans_term");
  });

  test("a plan or a review is for a customer record OR a name, never both and never neither", async () => {
    expect((await asOwner((client) => insertPlan(client, apex, { contact_name: "Pat" }))).constraint).toBe("plans_party");
    expect((await asOwner((client) => insertPlan(client, apex, { customer_id: null, property_id: null }))).constraint).toBe("plans_party");
    expect((await asOwner((client) => insertPlan(client, apex, { customer_id: null, property_id: null, contact_name: "Pat", property_text: "1 Main St" }))).value).toBeDefined();
    expect((await asOwner((client) => insertPlan(client, apex, { property_text: "1 Main St" }))).constraint).toBe("plans_address_snapshot");
    expect((await asOwner((client) => insertReview(client, apex, { contact_name: "Pat" }))).constraint).toBe("reviews_party");
    expect((await asOwner((client) => insertReview(client, apex, { customer_id: null }))).constraint).toBe("reviews_party");
  });
});

/* ───────────────────────── isolation ───────────────────────── */

test.describe("tenant isolation: reading", () => {
  test("a member of Apex reads Apex's rows from every table and none of Northstar's", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const out: Record<string, { total: number; foreign: number }> = {};
      for (const table of TABLES) {
        const rows = (await client.query<{ organization_id: string }>(`select organization_id from ${table}`)).rows;
        out[table] = { total: rows.length, foreign: rows.filter((row) => row.organization_id !== apex).length };
      }
      return out;
    });
    expect(result.value).toEqual({
      maintenance_plans: { total: 6, foreign: 0 },
      maintenance_plan_coverage: { total: 6, foreign: 0 },
      maintenance_plan_visits: { total: 12, foreign: 0 },
      reviews: { total: 4, foreign: 0 },
      review_replies: { total: 2, foreign: 0 },
      review_requests: { total: 0, foreign: 0 },
    });
  });

  test("Northstar's owner reads Northstar's rows only, and they are different records", async () => {
    const result = await as(user.taylor, northstar, async (client) => ({
      plans: (await client.query<{ slug: string }>("select slug from maintenance_plans")).rows.map((row) => row.slug),
      reviews: (await client.query<{ slug: string }>("select slug from reviews order by slug")).rows.map((row) => row.slug),
      requests: await count(client, "review_requests"),
      replies: await count(client, "review_replies"),
    }));
    expect(result.value).toEqual({ plans: ["plan-marta-olsen-furnace-care"], reviews: ["rev-marta-olsen", "rev-priya-raman"], requests: 1, replies: 1 });
  });

  test("a person who is not a member of the business named in the context reads nothing, whatever the context says", async () => {
    // Taylor belongs to Northstar only: asking as Taylor for Apex yields nothing, from every table.
    const crossed = await as(user.taylor, apex, async (client) => {
      const out: Record<string, number> = {};
      for (const table of TABLES) out[table] = await count(client, table);
      return out;
    });
    expect(Object.values(crossed.value!)).toEqual([0, 0, 0, 0, 0, 0]);
    // Alex belongs to Apex only.
    const other = await as(user.alex, northstar, async (client) => (await Promise.all(TABLES.map((table) => count(client, table)))).reduce((sum, value) => sum + value, 0));
    expect(other.value).toBe(0);
  });

  test("no context, or a context without a person, reads nothing", async () => {
    for (const [who, org] of [[null, null], [user.alex, null], [null, apex], ["", ""]] as const) {
      const result = await as(who, org, async (client) => (await Promise.all(TABLES.map((table) => count(client, table)))).reduce((sum, value) => sum + value, 0));
      expect(result.value, `${who} / ${org}`).toBe(0);
    }
  });

  test("an admin of both businesses sees one business at a time: the context decides, and a row never leaks across", async () => {
    for (const [org, plans] of [[apex, 6], [northstar, 1]] as const) {
      const result = await as(user.casey, org, async (client) => ({
        plans: await count(client, "maintenance_plans"),
        foreign: (await client.query("select 1 from maintenance_plans where organization_id <> $1", [org])).rowCount,
      }));
      expect(result.value).toEqual({ plans, foreign: 0 });
    }
  });

  test("a plain member can read (Jamie, Apex), and a lookup by another business's id finds nothing", async () => {
    const result = await as(user.jamie, apex, async (client) => ({
      plans: await count(client, "maintenance_plans"),
      northstarPlan: (await client.query("select 1 from maintenance_plans where id = $1", [n.planMarta])).rowCount,
      northstarReview: (await client.query("select 1 from reviews where id = $1", [n.revPriya])).rowCount,
      northstarVisit: (await client.query("select 1 from maintenance_plan_visits where id = $1", [n.v1])).rowCount,
    }));
    expect(result.value).toEqual({ plans: 6, northstarPlan: 0, northstarReview: 0, northstarVisit: 0 });
  });

  test("the application's own readers answer with the active business's rows only", async () => {
    const crossed = await withTenant({ userId: user.taylor, organizationId: apex }, (tx) => loadReviews(tx, apex, "America/Chicago"));
    expect(crossed).toEqual({ reviews: [], requests: [] });
    const own = await withTenant({ userId: user.taylor, organizationId: northstar }, (tx) => loadReviews(tx, northstar, "America/Denver"));
    expect(own.reviews.map((review) => review.id).sort()).toEqual(["rev-marta-olsen", "rev-priya-raman"]);
    expect(own.requests).toHaveLength(1);
  });
});

test.describe("tenant isolation: writing", () => {
  test("a plan can be created by an owner or admin of the business, only for that business, and never as carried-in history", async () => {
    const ok = await as(user.alex, apex, (client) => insertPlan(client, apex));
    expect(ok.value).toBeDefined();
    const admin_ = await as(user.casey, apex, (client) => insertPlan(client, apex));
    expect(admin_.value).toBeDefined();
    // Not a member, a member without the role, another business's context, and the imported flag are each refused by the policy.
    for (const [label, who, org, target, extra] of [
      ["a plain member", user.jamie, apex, apex, {}],
      ["a person of another business", user.taylor, apex, apex, {}],
      ["the right person, naming another business's id", user.alex, apex, northstar, {}],
      ["the right person in another business's context", user.alex, northstar, apex, {}],
      ["no context", null, null, apex, {}],
      ["carried-in history", user.alex, apex, apex, { imported: true }],
    ] as const) {
      const result = await as(who, org, (client) => insertPlan(client, target, { ...extra, ...(target === northstar ? { customer_id: n.marta, property_id: n.house } : {}) }));
      expect(result.error, label).toBeDefined();
      expect(result.code, label).toBe(PERMISSION);
    }
  });

  test("coverage and visits can join only a plan created in the same transaction: an existing plan never gains or loses either", async () => {
    const coverage = await as(user.alex, apex, (client) => insertCoverage(client, apex, a.planSarah, { coverage_key: "heating", sort_order: 5 }));
    expect(coverage.code).toBe(PERMISSION);
    const visit = await as(user.alex, apex, (client) => insertVisit(client, apex, a.planSarah, { sequence: 9 }));
    expect(visit.code).toBe(PERMISSION);
    const together = await as(user.alex, apex, async (client) => {
      const { plan, coverage: cov, visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 3);
      return { plan, cov, visits: visits.length, rows: (await client.query("select count(*)::int as n from maintenance_plan_visits where plan_id = $1", [plan])).rows[0].n };
    });
    expect(together.value!.rows).toBe(3);
    // A visit is born due, with no booking and no completion day.
    for (const extra of [{ status: "scheduled", booking_id: a.bookingSarah }, { status: "completed" }, { booking_id: a.bookingSarah }, { completed_on: "2030-01-02" }]) {
      const result = await as(user.alex, apex, async (client) => {
        const { plan } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
        return insertVisit(client, apex, plan, { sequence: 9, ...extra });
      });
      expect(result.error, JSON.stringify(extra)).toBeDefined();
    }
  });

  test("a plan names the business's own customer and a property that customer owns: another business's, or another customer's, cannot be named", async () => {
    const crossCustomer = await as(user.alex, apex, (client) => insertPlan(client, apex, { customer_id: n.marta, property_id: null }));
    expect(crossCustomer.code).toBe(FOREIGN_KEY);
    expect(crossCustomer.constraint).toBe("plans_customer_fk");
    const crossProperty = await as(user.alex, apex, (client) => insertPlan(client, apex, { customer_id: a.sarah, property_id: n.house }));
    expect(crossProperty.constraint).toBe("plans_property_fk");
    const otherCustomersProperty = await as(user.alex, apex, (client) => insertPlan(client, apex, { customer_id: a.sarah, property_id: a.davidHome }));
    expect(otherCustomersProperty.constraint).toBe("plans_property_fk");
    // The mirror image, from Northstar: it cannot name an Apex customer.
    const mirror = await as(user.taylor, northstar, (client) => insertPlan(client, northstar, { customer_id: a.sarah, property_id: a.sarahHome }));
    expect(mirror.constraint).toBe("plans_customer_fk");
  });

  test("a visit cannot name another business's plan, coverage or booking", async () => {
    // Northstar adding a visit to Apex's plan: the policy refuses (the plan is not Northstar's, and not new).
    const intoApexPlan = await as(user.taylor, northstar, (client) => insertVisit(client, northstar, a.planSarah, { sequence: 9 }));
    expect(intoApexPlan.error).toBeDefined();
    expect(intoApexPlan.code).toBe(PERMISSION);
    // Even through the owner role (no policy), the composite key stops it.
    const throughOwner = await asOwner((client) => insertVisit(client, northstar, a.planSarah, { sequence: 9 }));
    expect(throughOwner.code).toBe(FOREIGN_KEY);
    expect(throughOwner.constraint).toBe("plan_visits_plan_fk");
    // A visit of a new Northstar plan cannot point at Apex's coverage.
    const coverage = await asOwner(async (client) => {
      const plan = await insertPlan(client, northstar, { customer_id: n.marta, property_id: n.house });
      const apexCoverage = (await client.query<{ id: string }>("select id from maintenance_plan_coverage where plan_id = $1 limit 1", [a.planSarah])).rows[0].id;
      return insertVisit(client, northstar, plan, { coverage_id: apexCoverage });
    });
    expect(coverage.constraint).toBe("plan_visits_coverage_fk");
    // Scheduling an Apex visit with a Northstar booking is refused, and the visit is unchanged.
    const crossBooking = await as(user.alex, apex, async (client) => {
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [a.davidV1, n.booking1001]);
    });
    expect(crossBooking.error).toBeDefined();
    expect(crossBooking.code).toBe(CHECK);
    expect(crossBooking.constraint).toBe("plan_visits_booking_party");
    expect((await admin.query("select status, booking_id from maintenance_plan_visits where id = $1", [a.davidV1])).rows[0]).toEqual({ status: "due", booking_id: null });
    // Sarah's visit is scheduled already: its booking cannot be swapped for another business's, or anyone's.
    const swap = await as(user.alex, apex, (client) => client.query("update maintenance_plan_visits set booking_id = $2 where id = $1", [a.v2, n.booking1001]));
    expect(swap.constraint).toBe("plan_visits_status_transition");
    expect((await admin.query("select status, booking_id from maintenance_plan_visits where id = $1", [a.v2])).rows[0]).toEqual({ status: "scheduled", booking_id: a.booking1048 });
    // And through the owner role the composite key refuses a booking of another business outright.
    const throughOwnerBooking = await asOwner((client) => client.query("alter table maintenance_plan_visits disable trigger plan_visits_guard_update").then(() => client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [a.davidV1, n.booking1001])));
    expect(throughOwnerBooking.code).toBe(FOREIGN_KEY);
    expect(throughOwnerBooking.constraint).toBe("plan_visits_booking_fk");
  });

  test("a review cannot name another business's customer or job, or a job that is not the customer's own", async () => {
    // Reviews are never written by the application role at all.
    const byApp = await as(user.alex, apex, (client) => insertReview(client, apex));
    expect(byApp.code).toBe(PERMISSION);
    // The table's keys refuse the crossings even for the owner role.
    expect((await asOwner((client) => insertReview(client, apex, { customer_id: n.marta }))).constraint).toBe("reviews_customer_fk");
    const crossJob = await asOwner((client) => insertReview(client, apex, { customer_id: a.sarah, job_id: n.job1001 }));
    expect(crossJob.code).toBe(FOREIGN_KEY);
    expect(["reviews_job_fk", "reviews_job_customer_fk"]).toContain(crossJob.constraint);
    expect((await asOwner((client) => insertReview(client, apex, { customer_id: a.david, job_id: a.job204 }))).constraint).toBe("reviews_job_customer_fk");
    expect((await asOwner((client) => insertReview(client, apex, { customer_id: a.sarah, job_id: a.job204 }))).value).toBeDefined();
    // A review by a name may still name a job (the customer is then not constrained).
    expect((await asOwner((client) => insertReview(client, apex, { customer_id: null, contact_name: "Pat", job_id: a.job204 }))).value).toBeDefined();
  });

  test("a reply is posted by an owner or admin of the review's own business, on a review of that business", async () => {
    expect((await as(user.alex, apex, (client) => insertReply(client, apex, a.revSarah))).value).toBeDefined();
    expect((await as(user.casey, apex, (client) => insertReply(client, apex, a.revSarah))).value).toBeDefined();
    expect((await as(user.jamie, apex, (client) => insertReply(client, apex, a.revSarah))).code).toBe(PERMISSION);
    expect((await as(user.taylor, apex, (client) => insertReply(client, apex, a.revSarah))).code).toBe(PERMISSION);
    expect((await as(user.alex, apex, (client) => insertReply(client, northstar, n.revMarta))).code).toBe(PERMISSION);
    // Imported replies are the seed's: the runtime role cannot write one.
    expect((await as(user.alex, apex, (client) => insertReply(client, apex, a.revSarah, { imported: true }))).code).toBe(PERMISSION);
    // Northstar replying to an Apex review: the policy lets Northstar write its own rows, and the composite key refuses the review.
    const crossed = await as(user.taylor, northstar, (client) => insertReply(client, northstar, a.revSarah));
    expect(crossed.code).toBe(FOREIGN_KEY);
    expect(crossed.constraint).toBe("review_replies_review_fk");
    // The author may only be one of the business's own team.
    const author = await as(user.alex, apex, async (client) => {
      const outsider = (await admin.query<{ id: string }>("select id from team_members where organization_id = $1 limit 1", [northstar])).rows[0].id;
      return insertReply(client, apex, a.revSarah, { replied_by: outsider });
    });
    expect(author.constraint).toBe("review_replies_by_fk");
  });

  test("a request is recorded by an owner or admin, for the business's own customer and (when it names one) completed job", async () => {
    expect((await as(user.alex, apex, (client) => insertRequest(client, apex, a.sarah, { job_id: a.job204 }))).value).toBeDefined();
    expect((await as(user.jamie, apex, (client) => insertRequest(client, apex, a.sarah))).code).toBe(PERMISSION);
    expect((await as(user.taylor, apex, (client) => insertRequest(client, apex, a.sarah))).code).toBe(PERMISSION);
    expect((await as(user.alex, apex, (client) => insertRequest(client, northstar, n.marta))).code).toBe(PERMISSION);
    // Another business's customer, another business's job, another customer's job.
    expect((await as(user.alex, apex, (client) => insertRequest(client, apex, n.marta))).constraint).toBe("review_requests_customer_fk");
    expect((await as(user.taylor, northstar, (client) => insertRequest(client, northstar, n.marta, { job_id: a.job204 }))).code).toBe(CHECK);
    expect((await as(user.alex, apex, (client) => insertRequest(client, apex, a.david, { job_id: a.job204 }))).constraint).toBe("review_requests_job_customer_fk");
    // Only `recorded` exists: nothing here says a request was sent.
    expect((await as(user.alex, apex, (client) => insertRequest(client, apex, a.sarah, { status: "sent" }))).code).toBe(PERMISSION);
    expect((await asOwner((client) => insertRequest(client, apex, a.sarah, { status: "sent" }))).constraint).toBe("review_requests_status");
  });
});

/* ───────────────────────── nothing is rewritten or deleted ───────────────────────── */

test.describe("history is kept: nothing is deleted, and only what may change changes", () => {
  test("no row of any of the six tables can be deleted through the application role, even by an owner", async () => {
    for (const table of TABLES) {
      const result = await as(user.alex, apex, (client) => client.query(`delete from ${table}`));
      expect(result.code, table).toBe(PERMISSION);
    }
    expect((await admin.query("select count(*)::int as n from maintenance_plans where organization_id = $1", [apex])).rows[0].n).toBe(6);
  });

  test("a plan, its coverage, a review and a request cannot be rewritten through the application role", async () => {
    const attempts: [string, string][] = [
      ["maintenance_plans", "update maintenance_plans set status = 'ended'"],
      ["maintenance_plans", "update maintenance_plans set price_cents = 1"],
      ["maintenance_plans", "update maintenance_plans set customer_id = null, contact_name = 'x'"],
      ["maintenance_plans", "update maintenance_plans set organization_id = organization_id"],
      ["maintenance_plan_coverage", "update maintenance_plan_coverage set visits = 4"],
      ["reviews", "update reviews set rating = 1"],
      ["reviews", "update reviews set review_text = 'Terrible'"],
      ["reviews", "update reviews set customer_id = null, contact_name = 'x'"],
      ["review_requests", "update review_requests set message = 'x'"],
      ["review_requests", "update review_requests set status = 'recorded'"],
    ];
    for (const [, sql] of attempts) {
      const result = await as(user.alex, apex, (client) => client.query(sql));
      expect(result.code, sql).toBe(PERMISSION);
    }
  });

  test("a visit changes only its status, its booking and its completion day; a reply only its text", async () => {
    for (const sql of [
      "update maintenance_plan_visits set ref = 'x'",
      "update maintenance_plan_visits set sequence = sequence + 10",
      "update maintenance_plan_visits set label = 'x'",
      "update maintenance_plan_visits set plan_id = plan_id",
      "update maintenance_plan_visits set organization_id = organization_id",
      "update maintenance_plan_visits set window_start = '2030-01-01', window_end = '2030-01-02'",
      "update review_replies set author_name = 'x'",
      "update review_replies set replied_at = now()",
      "update review_replies set review_id = review_id",
      "update review_replies set imported = false",
      "update review_replies set edited_at = null",
    ]) {
      const result = await as(user.alex, apex, (client) => client.query(sql));
      expect(result.code, sql).toBe(PERMISSION);
    }
  });

  test("a visit and a reply are editable only by an owner or admin of their own business", async () => {
    // A member cannot: the policy hides the row from the update, so nothing changes.
    const member = await as(user.jamie, apex, (client) => client.query("update review_replies set body = 'Changed' where review_id = $1", [a.revDavid]));
    expect(member.value?.rowCount).toBe(0);
    // Another business's owner cannot reach the row at all.
    const other = await as(user.taylor, northstar, (client) => client.query("update review_replies set body = 'Changed' where review_id = $1", [a.revDavid]));
    expect(other.value?.rowCount).toBe(0);
    const visit = await as(user.taylor, northstar, (client) => client.query("update maintenance_plan_visits set status = 'due' where id = $1", [a.v1]));
    expect(visit.value?.rowCount).toBe(0);
    expect((await admin.query("select body from review_replies where review_id = $1", [a.revDavid])).rows[0].body).toBe("Thanks David, appreciate the feedback!");
  });
});

/* ───────────────────────── visits ───────────────────────── */

test.describe("a visit's life: due, scheduled, completed", () => {
  test("a due visit becomes scheduled by attaching a booking of the plan's own customer", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      const booking = await copyBooking(client, a.bookingSarah, 9001);
      const updated = await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1 returning status, booking_id", [visits[0], booking]);
      return { row: updated.rows[0], booking };
    });
    expect(result.error).toBeUndefined();
    expect(result.value!.row).toEqual({ status: "scheduled", booking_id: result.value!.booking });
  });

  test("a visit cannot be scheduled with another customer's booking, or with no booking, or have its booking swapped later", async () => {
    const wrongParty = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      const booking = await copyBooking(client, a.bookingDavid, 9001);
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [visits[0], booking]);
    });
    expect(wrongParty.constraint).toBe("plan_visits_booking_party");
    const noBooking = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      await client.query("update maintenance_plan_visits set status = 'scheduled' where id = $1", [visits[0]]);
    });
    expect(noBooking.constraint).toBe("plan_visits_scheduled");
    const swap = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      const first = await copyBooking(client, a.bookingSarah, 9001);
      const second = await copyBooking(client, a.bookingSarah, 9002);
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [visits[0], first]);
      await client.query("update maintenance_plan_visits set booking_id = $2 where id = $1", [visits[0], second]);
    });
    expect(swap.constraint).toBe("plan_visits_status_transition");
  });

  test("one booking schedules at most one visit: it cannot be attached to a second", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 2);
      const booking = await copyBooking(client, a.bookingSarah, 9001);
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [visits[0], booking]);
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [visits[1], booking]);
    });
    expect(result.code).toBe(UNIQUE);
    expect(result.constraint).toBe("plan_visits_org_booking_unique");
  });

  test("BK-1048 cannot be attached to a second visit, and visit 2 cannot take a second booking", async () => {
    const second = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [visits[0], a.booking1048]);
    });
    expect(second.code).toBe(UNIQUE);
    expect(second.constraint).toBe("plan_visits_org_booking_unique");
    const another = await as(user.alex, apex, async (client) => {
      const booking = await copyBooking(client, a.bookingSarah, 9001);
      await client.query("update maintenance_plan_visits set booking_id = $2 where id = $1", [a.v2, booking]);
    });
    expect(another.constraint).toBe("plan_visits_status_transition");
    expect((await admin.query("select count(*)::int as n from bookings where organization_id = $1 and number = 1048", [apex])).rows[0].n).toBe(1);
  });

  test("a due visit cannot jump to completed, and a completed visit is final", async () => {
    const jump = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      await client.query("update maintenance_plan_visits set status = 'completed', completed_on = '2030-01-02' where id = $1", [visits[0]]);
    });
    expect(jump.constraint).toBe("plan_visits_status_transition");
    for (const sql of ["update maintenance_plan_visits set status = 'due' where id = $1", "update maintenance_plan_visits set completed_on = '2030-01-01' where id = $1", "update maintenance_plan_visits set status = 'scheduled', booking_id = null where id = $1"]) {
      const result = await as(user.alex, apex, (client) => client.query(sql, [a.v1]));
      expect(result.constraint, sql).toBe("plan_visits_final");
    }
    expect((await admin.query("select status, completed_on::text as completed_on from maintenance_plan_visits where id = $1", [a.v1])).rows[0]).toEqual({ status: "completed", completed_on: "2024-05-22" });
  });

  test("a completion day belongs only to a completed visit", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      await client.query("update maintenance_plan_visits set completed_on = '2030-01-02' where id = $1", [visits[0]]);
    });
    expect(result.constraint).toBe("plan_visits_completed");
  });

  test("the visit follows its booking: cancelling the booking reopens the visit, and the booking stays pointed at as history", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      const booking = await copyBooking(client, a.bookingSarah, 9001);
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [visits[0], booking]);
      await client.query("update bookings set status = 'cancelled', cancellation_reason = 'Customer asked' where id = $1", [booking]);
      return { visit: (await client.query("select status, booking_id from maintenance_plan_visits where id = $1", [visits[0]])).rows[0], booking };
    });
    expect(result.error).toBeUndefined();
    expect(result.value!.visit).toEqual({ status: "due", booking_id: result.value!.booking });
  });

  test("a visit booked again after a cancellation takes the new booking; completing that booking completes the visit on the day of service", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const { visits } = await newPlan(client, apex, a.sarah, a.sarahHome, 1);
      const first = await copyBooking(client, a.bookingSarah, 9001);
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [visits[0], first]);
      await client.query("update bookings set status = 'cancelled', cancellation_reason = 'Customer asked' where id = $1", [first]);
      const second = await copyBooking(client, a.bookingSarah, 9002);
      await client.query("update maintenance_plan_visits set status = 'scheduled', booking_id = $2 where id = $1", [visits[0], second]);
      await client.query("update bookings set status = 'completed' where id = $1", [second]);
      return {
        visit: (await client.query("select status, booking_id, completed_on::text as completed_on from maintenance_plan_visits where id = $1", [visits[0]])).rows[0],
        service: (await client.query("select service_date::text as day from bookings where id = $1", [second])).rows[0].day,
        second,
      };
    });
    expect(result.error).toBeUndefined();
    expect(result.value!.visit).toEqual({ status: "completed", booking_id: result.value!.second, completed_on: result.value!.service });
  });

  test("a booking that schedules no visit changes nothing about any plan when it is cancelled", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const before = (await client.query("select string_agg(status, ',' order by ref) as s from maintenance_plan_visits")).rows[0].s;
      const booking = await copyBooking(client, a.bookingSarah, 9001);
      await client.query("update bookings set status = 'cancelled', cancellation_reason = 'x' where id = $1", [booking]);
      return { before, after: (await client.query("select string_agg(status, ',' order by ref) as s from maintenance_plan_visits")).rows[0].s };
    });
    expect(result.value!.after).toBe(result.value!.before);
  });
});

/* ───────────────────────── replies and requests ───────────────────────── */

test.describe("a reply", () => {
  test("a review has one reply: a second is refused by the table", async () => {
    const result = await as(user.alex, apex, async (client) => {
      await insertReply(client, apex, a.revSarah);
      await insertReply(client, apex, a.revSarah, { body: "Another" });
    });
    expect(result.code).toBe(UNIQUE);
    expect(result.constraint).toBe("review_replies_review_unique");
    expect((await as(user.alex, apex, (client) => insertReply(client, apex, a.revDavid))).code).toBe(UNIQUE);
  });

  test("a reply is 1 to 500 characters and signed", async () => {
    for (const [label, values, constraint] of [
      ["empty", { body: "" }, "review_replies_body"],
      ["blank", { body: "   " }, "review_replies_body"],
      ["too long", { body: "x".repeat(501) }, "review_replies_body"],
      ["unsigned", { author_name: " " }, "review_replies_author"],
    ] as const) {
      expect((await as(user.alex, apex, (client) => insertReply(client, apex, a.revSarah, values))).constraint, label).toBe(constraint);
    }
    expect((await as(user.alex, apex, (client) => insertReply(client, apex, a.revSarah, { body: "x".repeat(500) }))).value).toBeDefined();
    expect((await as(user.alex, apex, (client) => insertReply(client, apex, a.revSarah, { body: null }))).code).toBe(NOT_NULL);
  });

  test("editing a reply marks it edited in the database, keeps who replied and when, and leaves the review alone", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const reply = await insertReply(client, apex, a.revSarah, { replied_at: "2030-01-02T12:00:00Z" });
      const before = (await client.query("select body, author_name, replied_at, edited_at, review_id from review_replies where id = $1", [reply])).rows[0];
      await client.query("update review_replies set body = $2 where id = $1", [reply, "Thank you, Sarah. Edited."]);
      const edited = (await client.query("select body, author_name, replied_at, edited_at, review_id from review_replies where id = $1", [reply])).rows[0];
      // Saving the same words again is not an edit.
      const fresh = await insertReply(client, apex, a.revElena);
      await client.query("update review_replies set body = body where id = $1", [fresh]);
      const unchanged = (await client.query("select edited_at from review_replies where id = $1", [fresh])).rows[0];
      const review = (await client.query("select review_text, rating from reviews where id = $1", [a.revSarah])).rows[0];
      return { before, edited, unchanged, review };
    });
    expect(result.error).toBeUndefined();
    const { before, edited, unchanged, review } = result.value!;
    expect(before.edited_at).toBeNull();
    expect(edited.body).toBe("Thank you, Sarah. Edited.");
    expect(edited.edited_at).not.toBeNull();
    expect(edited.author_name).toBe(before.author_name);
    expect(edited.replied_at.toISOString()).toBe(before.replied_at.toISOString());
    expect(edited.review_id).toBe(before.review_id);
    expect(unchanged.edited_at).toBeNull();
    expect(review).toEqual({ review_text: "The technician explained the repair clearly and completed the work as scheduled.", rating: 5 });
  });
});

test.describe("a review request", () => {
  test("it can name a completed job of the customer; a job that is not completed is refused", async () => {
    expect((await as(user.alex, apex, (client) => insertRequest(client, apex, a.sarah, { job_id: a.job204 }))).value).toBeDefined();
    const open = await as(user.alex, apex, async (client) => {
      const owner = (await client.query<{ customer_id: string }>("select customer_id from jobs where id = $1", [a.jobOpen])).rows[0].customer_id;
      return insertRequest(client, apex, owner, { job_id: a.jobOpen });
    });
    expect(open.error).toBeDefined();
    expect(open.constraint).toBe("review_requests_job_completed");
    // Northstar's only job is still scheduled.
    expect((await as(user.taylor, northstar, (client) => insertRequest(client, northstar, n.marta, { job_id: n.job1001 }))).constraint).toBe("review_requests_job_completed");
  });

  test("a job has one active request: a second one for the same job is refused, a request with no job is not limited", async () => {
    const twice = await as(user.alex, apex, async (client) => {
      await insertRequest(client, apex, a.sarah, { job_id: a.job204 });
      await insertRequest(client, apex, a.sarah, { job_id: a.job204, channel: "sms" });
    });
    expect(twice.code).toBe(UNIQUE);
    expect(twice.constraint).toBe("review_requests_job_active_unique");
    const free = await as(user.alex, apex, async (client) => {
      await insertRequest(client, apex, a.sarah);
      await insertRequest(client, apex, a.sarah);
      await insertRequest(client, apex, a.david, { job_id: a.jobDavid });
      return count(client, "review_requests");
    });
    expect(free.value).toBe(3);
    // The same job number in another business is another job: Northstar's request for its JB-1001 is its own.
    expect(a.job204).not.toBe(n.job1001);
  });

  test("a request is by email or SMS, with a message of 1 to 500 characters", async () => {
    for (const [label, values, constraint] of [
      ["fax", { channel: "fax" }, "review_requests_channel"],
      ["empty", { message: "" }, "review_requests_message"],
      ["blank", { message: "  " }, "review_requests_message"],
      ["too long", { message: "x".repeat(501) }, "review_requests_message"],
    ] as const) {
      expect((await as(user.alex, apex, (client) => insertRequest(client, apex, a.sarah, values))).constraint, label).toBe(constraint);
    }
    for (const channel of ["email", "sms"]) expect((await as(user.alex, apex, (client) => insertRequest(client, apex, a.sarah, { channel }))).value, channel).toBeDefined();
  });

  test("requests keep their order: the position is assigned by the database, increasing", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const ids = [await insertRequest(client, apex, a.sarah), await insertRequest(client, apex, a.sarah), await insertRequest(client, apex, a.david)];
      return (await client.query<{ position: number }>("select position from review_requests where id = any($1) order by position", [ids])).rows.map((row) => row.position);
    });
    expect(result.value!).toHaveLength(3);
    expect(result.value![0]).toBeLessThan(result.value![1]);
    expect(result.value![1]).toBeLessThan(result.value![2]);
  });
});

/* ───────────────────────── in the application's own transactions ───────────────────────── */

test.describe("the application's transaction rolls back as a whole", () => {
  test("a reply whose second step fails leaves nothing behind", async () => {
    const before = (await admin.query("select count(*)::int as n from review_replies where organization_id = $1", [apex])).rows[0].n;
    await expect(
      withTenant({ userId: user.alex, organizationId: apex }, async (tx) => {
        const refs = await loadRefs(tx, apex);
        const context: ReviewContext = { tx, organizationId: apex, refs, stamp: new Date("2030-01-02T18:00:00Z"), actorUserId: user.alex, authorName: "Alex Morgan" };
        await postReplyTx(context, "rev-sarah-mitchell", "Thank you, Sarah.");
        // The same transaction then asks for a second reply: it is refused, and the first goes with it.
        await postReplyTx(context, "rev-sarah-mitchell", "Again");
      }),
    ).rejects.toBeInstanceOf(Refusal);
    expect((await admin.query("select count(*)::int as n from review_replies where organization_id = $1", [apex])).rows[0].n).toBe(before);
  });

  test("the application's functions refuse a review or a customer of another business as 'not found', never as a leak", async () => {
    const refusal = async (change: (context: ReviewContext) => Promise<void>) =>
      withTenant({ userId: user.alex, organizationId: apex }, async (tx) => {
        const refs = await loadRefs(tx, apex);
        await change({ tx, organizationId: apex, refs, stamp: new Date("2030-01-02T18:00:00Z"), actorUserId: user.alex, authorName: "Alex Morgan" });
      }).then(
        () => undefined,
        (error: unknown) => (error instanceof Refusal ? error.message : String(error)),
      );
    const gone = await refusal((context) => postReplyTx(context, "rev-priya-raman", "Hello"));
    expect(gone).toMatch(/no longer exists/);
    expect(await refusal((context) => editReplyTx(context, "rev-priya-raman", "Hello"))).toMatch(/no longer exists/);
    expect(await refusal((context) => createRequestTx(context, { customerSlug: "marta-olsen", channel: "email", message: "Hi" }))).toMatch(/not in your customers/);
    expect(await refusal((context) => createRequestTx(context, { customerSlug: "sarah-mitchell", jobNumber: 1001, channel: "email", message: "Hi" }))).toMatch(/no longer exists/);
    expect(await refusal((context) => createRequestTx(context, { customerSlug: "david-chen", jobNumber: 204, channel: "email", message: "Hi" }))).toMatch(/another customer/);
    // The same text for a review that never existed: there is no way to tell the two apart.
    expect(await refusal((context) => postReplyTx(context, "rev-nobody", "Hello"))).toBe(gone);
  });
});

/* ───────────────────────── concurrency ───────────────────────── */

const concurrency = saasTest;

/** How a competing transaction ended: stored, told "no" by the application, or stopped by the table's unique key. */
const outcomeOf = (error: unknown): "refused" | "unique" | string => {
  if (error instanceof Refusal) return "refused";
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === UNIQUE) return "unique";
  }
  return `error: ${error instanceof Error ? error.message : String(error)}`;
};

concurrency.describe("concurrent requests settle on one outcome (the worker's own copy of Apex)", () => {
  const contextFor = (tx: Parameters<Parameters<typeof withTenant>[1]>[0], organizationId: string, userId: string, stamp: Date): Promise<ReviewContext> =>
    loadRefs(tx, organizationId).then((refs) => ({ tx, organizationId, refs, stamp, actorUserId: userId, authorName: "Alex Morgan" }));

  concurrency("two people replying to the same review at once: one reply is stored, the other is told", async ({ workerTenant, db }) => {
    const { userId, organizationId } = workerTenant;
    const post = (body: string) =>
      withTenant({ userId, organizationId }, async (tx) => postReplyTx(await contextFor(tx, organizationId, userId, new Date("2030-01-02T18:00:00Z")), "rev-sarah-mitchell", body)).then(
        () => "ok" as const,
        outcomeOf,
      );
    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => post(`Reply ${index}`)));
    expect(outcomes.filter((outcome) => outcome === "ok")).toHaveLength(1);
    // Whoever lost either saw the existing reply (refused) or met the unique key: never a second reply.
    expect(outcomes.filter((outcome) => outcome !== "ok" && outcome !== "refused" && outcome !== "unique"), outcomes.join(" | ")).toEqual([]);
    expect((await db.query("select count(*)::int as n from review_replies r join reviews v on v.id = r.review_id where v.organization_id = $1 and v.slug = 'rev-sarah-mitchell'", [organizationId])).rows[0].n).toBe(1);
  });

  concurrency("two people asking for a review of the same job at once: one request is stored", async ({ workerTenant, db }) => {
    const { userId, organizationId } = workerTenant;
    const ask = (channel: "email" | "sms") =>
      withTenant({ userId, organizationId }, async (tx) =>
        createRequestTx(await contextFor(tx, organizationId, userId, new Date("2030-01-02T18:00:00Z")), { customerSlug: "sarah-mitchell", jobNumber: 204, channel, message: "Please review us." }),
      ).then(() => "ok" as const, outcomeOf);
    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => ask(index % 2 === 0 ? "email" : "sms")));
    expect(outcomes.filter((outcome) => outcome === "ok")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome !== "ok" && outcome !== "refused" && outcome !== "unique"), outcomes.join(" | ")).toEqual([]);
    expect((await db.query("select count(*)::int as n from review_requests where organization_id = $1", [organizationId])).rows[0].n).toBe(1);
  });

  concurrency("a reply edited by two people at once ends as one of the two texts, edited, with one row", async ({ workerTenant, db }) => {
    const { userId, organizationId } = workerTenant;
    const edit = (body: string) =>
      withTenant({ userId, organizationId }, async (tx) => editReplyTx(await contextFor(tx, organizationId, userId, new Date("2030-01-02T18:00:00Z")), "rev-david-chen", body));
    await Promise.all([edit("First words"), edit("Second words")]);
    const row = (await db.query("select body, edited_at is not null as edited from review_replies r join reviews v on v.id = r.review_id where v.organization_id = $1 and v.slug = 'rev-david-chen'", [organizationId])).rows;
    expect(row).toHaveLength(1);
    expect(["First words", "Second words"]).toContain(row[0].body);
    expect(row[0].edited).toBe(true);
  });
});
