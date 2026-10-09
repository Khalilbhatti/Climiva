/**
 * Phase 12: tenant isolation and money integrity of the financial tables at the DATABASE, independent of the application code.
 *
 * Like operations-database.spec.ts, these connect to the freshly migrated and seeded test database as the restricted runtime role
 * the app uses (`climvia_app`, DATABASE_URL), set the transaction-local context the way src/db/tenant.ts does, and check that
 * PostgreSQL itself keeps businesses apart and keeps the money right: Row Level Security for who may read and write, column grants
 * for what may change, composite foreign keys for what may point at what, triggers for what a payment may do to a balance, and the
 * numbering function for who may take a number. Almost every test runs in a transaction that is rolled back; the numbering and
 * concurrency tests that must commit use organizations of their own.
 */
import { randomBytes } from "node:crypto";
import { test as base, expect } from "playwright/test";
import { Pool, type PoolClient } from "pg";
import { createInvoiceFromQuoteTx, loadFinRefs, recordPaymentTx, voidPaymentTx, type FinContext } from "../src/db/fin-queries";
import { stableId } from "../src/db/stable-id";
import { withTenant } from "../src/db/tenant";
import { lineCents } from "../src/lib/money";
import { Refusal } from "../src/lib/refusal";
import { adminDb } from "../scripts/db/lib";
import { APEX, ensureMembership, ensureOrganization, ensureUser, seedAuth } from "../scripts/db/seed-lib";

const test = base;

const SEED = {
  alex: "alex.morgan@apex.test", // Apex owner
  jamie: "jamie.rivera@apex.test", // Apex member
  taylor: "taylor.brooks@northstar.test", // Northstar owner
  casey: "casey.nguyen@climvia.test", // admin in both
};

let app: Pool;
let admin: Pool;
const user: Record<string, string> = {};
let apex = "";
let northstar = "";
/** Database ids of the records the tests point at, per business. */
const a: Record<string, string> = {};
const n: Record<string, string> = {};

const idOf = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0].id;
const byNumber = (table: string, organizationId: string, number: number) => idOf(`select id from ${table} where organization_id = $1 and number = $2`, [organizationId, number]);
const bySlug = (table: string, organizationId: string, slug: string) => idOf(`select id from ${table} where organization_id = $1 and slug = $2`, [organizationId, slug]);

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
  a.cooling = await bySlug("services", apex, "annual-cooling-tune-up");
  a.alexMember = await bySlug("team_members", apex, "alex-morgan");
  a.job204 = await byNumber("jobs", apex, 204);
  a.booking1042 = await byNumber("bookings", apex, 1042);
  for (const number of [879, 884, 891, 893]) a[`qt${number}`] = await byNumber("quotes", apex, number);
  for (const number of [1043, 1044, 1050, 1051]) a[`inv${number}`] = await byNumber("invoices", apex, number);
  for (const number of [1001, 1008]) a[`pay${number}`] = await byNumber("payments", apex, number);

  n.marta = await bySlug("customers", northstar, "marta-olsen");
  n.tuneUp = await bySlug("services", northstar, "furnace-tune-up");
  n.jordan = await bySlug("team_members", northstar, "jordan-pike");
  n.job1001 = await byNumber("jobs", northstar, 1001);
  n.booking1001 = await byNumber("bookings", northstar, 1001);
  n.qt1001 = await byNumber("quotes", northstar, 1001);
  n.inv1001 = await byNumber("invoices", northstar, 1001);
  n.pay1001 = await byNumber("payments", northstar, 1001);
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

const count = async (client: PoolClient, table: string) => (await client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
const FINANCIAL = ["quotes", "quote_line_items", "invoices", "invoice_line_items", "payments"];

async function insertRow(client: PoolClient, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const result = await client.query<{ id: string }>(
    `insert into ${table} (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
    columns.map((column) => row[column]),
  );
  return result.rows[0].id;
}

const insertQuote = (client: PoolClient, org: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "quotes", { organization_id: org, number: 9001, contact_name: "Test Person", status: "draft", created_on: "2030-01-02", ...values });
const insertInvoice = (client: PoolClient, org: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "invoices", { organization_id: org, number: 9001, contact_name: "Test Person", issue_date: "2030-01-02", payment_terms: "due-on-receipt", ...values });
const insertLine = (client: PoolClient, kind: "quote" | "invoice", org: string, parent: string, values: Record<string, unknown> = {}) =>
  insertRow(client, `${kind}_line_items`, {
    organization_id: org,
    [`${kind}_id`]: parent,
    sort_order: 1,
    description: "Work",
    quantity: "1.00",
    unit_price_cents: 30000,
    line_total_cents: 30000,
    ...values,
  });
const insertPayment = (client: PoolClient, org: string, invoice: string, values: Record<string, unknown> = {}) =>
  insertRow(client, "payments", {
    organization_id: org,
    number: 9001,
    invoice_id: invoice,
    amount_cents: 1000,
    method: "check",
    status: "recorded",
    paid_on: "2030-01-02",
    recorded_at: "2030-01-02T12:00:00Z",
    ...values,
  });
/** A $300 invoice of the business's own, created in the open transaction (so lines may join it). */
async function newInvoice(client: PoolClient, org: string, values: Record<string, unknown> = {}, cents = 30000) {
  const id = await insertInvoice(client, org, values);
  await insertLine(client, "invoice", org, id, { unit_price_cents: cents, line_total_cents: cents });
  return id;
}

/**
 * A person of their own and businesses of their own, for the tests that must COMMIT (a rolled-back transaction gives its number
 * back). None of the standing seed people or businesses is touched, so no other spec sees these.
 */
async function newBusinesses(label: string, howMany: number): Promise<{ userId: string; organizations: string[] }> {
  const { pool, db } = adminDb();
  const { auth, close } = seedAuth();
  try {
    const suffix = randomBytes(4).toString("hex");
    const userId = await ensureUser(auth, db, { email: `${label}-${suffix}@apex.test`, name: "Financial Tester" }, process.env.SEED_PASSWORD ?? "");
    const organizations: string[] = [];
    for (let index = 0; index < howMany; index += 1) {
      const organization = await ensureOrganization(db, { ...APEX, slug: `${label}-${suffix}-${index}`, fixtureSet: null, sites: [{ name: "Main", slug: "main" }] });
      await ensureMembership(db, { organizationId: organization, userId, role: "owner" });
      organizations.push(organization);
    }
    return { userId, organizations };
  } finally {
    await close();
    await pool.end();
  }
}

/** Committed through the owner role: a $`cents` invoice for a name, with `number`. */
async function committedInvoice(org: string, number: number, cents = 30000): Promise<string> {
  const invoice = (
    await admin.query<{ id: string }>(
      "insert into invoices (organization_id, number, contact_name, issue_date, payment_terms) values ($1, $2, 'Pat Payer', '2030-01-02', 'due-on-receipt') returning id",
      [org, number],
    )
  ).rows[0].id;
  await admin.query(
    "insert into invoice_line_items (organization_id, invoice_id, sort_order, description, quantity, unit_price_cents, line_total_cents) values ($1, $2, 1, 'Work', 1, $3, $3)",
    [org, invoice, cents],
  );
  return invoice;
}

/** The context a financial operation runs in, for the in-process concurrency tests. */
async function financeContext(tx: Parameters<Parameters<typeof withTenant>[1]>[0], organizationId: string, userId: string): Promise<FinContext> {
  return { tx, organizationId, timeZone: "America/Denver", refs: await loadFinRefs(tx, organizationId), today: "2030-01-02", stamp: new Date("2030-01-02T18:00:00Z"), actorUserId: userId };
}

const sqlFigures = `
  select i.number,
         coalesce((select sum(l.line_total_cents) from invoice_line_items l where l.invoice_id = i.id), 0)::int as total,
         i.previously_paid_cents::int as carried,
         coalesce((select sum(p.amount_cents) from payments p where p.invoice_id = i.id and p.status = 'recorded'), 0)::int as received
    from invoices i where i.organization_id = $1 order by i.number`;

test.describe("what the seed holds", () => {
  test("Apex's baseline, worked out in SQL from the stored rows: 7 payments, $2,130 received, 2 open invoices, $680 owed", async () => {
    const figures = (await admin.query<{ number: number; total: number; carried: number; received: number }>(sqlFigures, [apex])).rows;
    expect(figures).toHaveLength(9);
    const balance = (row: (typeof figures)[number]) => Math.max(0, row.total - row.carried - row.received);
    const open = figures.filter((row) => balance(row) > 0);
    expect(open.map((row) => [row.number, balance(row)])).toEqual([
      [1050, 30000],
      [1051, 38000],
    ]);
    expect(open.reduce((sum, row) => sum + balance(row), 0)).toBe(68000);
    const payments = (await admin.query<{ n: number; received: number }>("select count(*)::int as n, coalesce(sum(amount_cents), 0)::int as received from payments where organization_id = $1 and status = 'recorded'", [apex])).rows[0];
    expect(payments).toEqual({ n: 7, received: 213000 });
    expect((await admin.query("select count(*)::int as n from payments where organization_id = $1", [apex])).rows[0].n).toBe(8);
  });

  test("INV-1050 owes $300 after $200 carried forward (no payment behind it), INV-1051 is unpaid, INV-1044 is paid in full", async () => {
    const figures = (await admin.query<{ number: number; total: number; carried: number; received: number }>(sqlFigures, [apex])).rows;
    const of = (number: number) => figures.find((row) => row.number === number)!;
    expect(of(1050)).toEqual({ number: 1050, total: 50000, carried: 20000, received: 0 });
    expect(of(1051)).toEqual({ number: 1051, total: 38000, carried: 0, received: 0 });
    expect(of(1044)).toEqual({ number: 1044, total: 28500, carried: 0, received: 28500 });
    // The carried $200 is the invoice's own; there is no payment for INV-1050 at all.
    expect((await admin.query("select count(*)::int as n from payments where invoice_id = $1", [a.inv1050])).rows[0].n).toBe(0);
    expect((await admin.query("select imported from invoices where id = $1", [a.inv1050])).rows[0].imported).toBe(true);
  });

  test("PAY-1001 is Voided and stays in history; PAY-1008 is the recorded payment that pays INV-1044", async () => {
    const voided = (await admin.query("select p.status, p.amount_cents, p.void_reason, p.voided_at is not null as has_time, i.number as invoice from payments p join invoices i on i.id = p.invoice_id where p.id = $1", [a.pay1001])).rows[0];
    expect(voided).toEqual({ status: "voided", amount_cents: 28500, void_reason: "Payment entered by mistake", has_time: true, invoice: 1044 });
    const live = (await admin.query("select p.status, p.amount_cents, i.number as invoice, p.customer_id from payments p join invoices i on i.id = p.invoice_id where p.id = $1", [a.pay1008])).rows[0];
    expect(live).toEqual({ status: "recorded", amount_cents: 28500, invoice: 1044, customer_id: a.sarah });
  });

  test("QT-884 is approved with no invoice, and INV-1044 is not linked to it", async () => {
    const quote = (await admin.query("select q.status, q.approved_on::text as approved_on, (select count(*)::int from invoices i where i.quote_id = q.id) as invoices from quotes q where q.id = $1", [a.qt884])).rows[0];
    expect(quote).toEqual({ status: "approved", approved_on: "2024-10-24", invoices: 0 });
    expect((await admin.query("select quote_id from invoices where id = $1", [a.inv1044])).rows[0].quote_id).toBeNull();
    const lines = (await admin.query("select sum(line_total_cents)::int as total, count(*)::int as n from quote_line_items where quote_id = $1", [a.qt884])).rows[0];
    expect(lines).toEqual({ total: 28500, n: 3 });
    expect((await admin.query("select number, status from quotes where organization_id = $1 order by number", [apex])).rows).toEqual([
      { number: 879, status: "declined" },
      { number: 884, status: "approved" },
      { number: 891, status: "sent" },
      { number: 893, status: "draft" },
    ]);
  });

  test("Northstar has its own small set, with numbers of its own: PAY-1001 there is a different payment from Apex's", async () => {
    const counts = (
      await admin.query(
        `select (select count(*)::int from quotes where organization_id = $1) as quotes,
                (select count(*)::int from invoices where organization_id = $1) as invoices,
                (select count(*)::int from payments where organization_id = $1) as payments`,
        [northstar],
      )
    ).rows[0];
    expect(counts).toEqual({ quotes: 2, invoices: 2, payments: 2 });
    const figures = (await admin.query<{ number: number; total: number; carried: number; received: number }>(sqlFigures, [northstar])).rows;
    expect(figures).toEqual([
      { number: 1001, total: 14400, carried: 0, received: 6000 },
      { number: 1002, total: 22500, carried: 0, received: 0 },
    ]);
    const pay = (await admin.query("select status, amount_cents from payments where id = $1", [n.pay1001])).rows[0];
    expect(pay).toEqual({ status: "recorded", amount_cents: 6000 });
    expect(n.pay1001).not.toBe(a.pay1001);
    expect(stableId(northstar, "payment", "PAY-1001")).toBe(n.pay1001);
    expect(stableId(apex, "payment", "PAY-1001")).toBe(a.pay1001);
  });

  test("numbering continues after the seeded records: Apex QT-894, INV-1052, PAY-1009; Northstar starts its next at 1003", async () => {
    const counters = async (org: string) =>
      Object.fromEntries((await admin.query<{ kind: string; next_value: number }>("select kind, next_value from organization_sequences where organization_id = $1 and kind in ('quote', 'invoice', 'payment')", [org])).rows.map((row) => [row.kind, row.next_value]));
    expect(await counters(apex)).toEqual({ quote: 894, invoice: 1052, payment: 1009 });
    expect(await counters(northstar)).toEqual({ quote: 1003, invoice: 1003, payment: 1003 });
  });

  test("the due date is worked out by PostgreSQL from the issue date and the terms", async () => {
    const due = (await admin.query("select number, issue_date::text as issued, payment_terms, due_date::text as due from invoices where organization_id in ($1, $2) and number in (1050, 1001) order by organization_id = $1 desc, number", [apex, northstar])).rows;
    expect(due).toEqual([
      { number: 1050, issued: "2024-10-27", payment_terms: "due-on-receipt", due: "2024-10-27" },
      { number: 1001, issued: "2024-10-29", payment_terms: "net-15", due: "2024-11-13" },
    ]);
  });

  test("an app line total equals PostgreSQL's own rounding of quantity x price, for a spread of values", async () => {
    const quantities = [0.01, 0.25, 0.5, 1, 1.15, 1.5, 2.5, 3.33, 7.75, 33.33, 100.01];
    const prices = [1, 3, 99, 333, 8950, 13000, 12345, 99999];
    const pairs = quantities.flatMap((quantity) => prices.map((price) => ({ quantity, price })));
    for (const { quantity, price } of pairs) {
      const sql = (await admin.query<{ total: string }>("select round($1::numeric * $2::numeric)::text as total", [quantity.toFixed(2), price])).rows[0].total;
      expect(lineCents(quantity, price), `${quantity} x ${price}`).toBe(Number(sql));
    }
  });
});

test.describe("the structure", () => {
  test("every financial table has Row Level Security enabled and carries an organization_id", async () => {
    const tables = (
      await admin.query<{ relname: string; rls: boolean; forced: boolean }>(
        "select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by c.relname",
        [FINANCIAL],
      )
    ).rows;
    expect(tables.map((table) => table.relname).sort()).toEqual([...FINANCIAL].sort());
    for (const table of tables) expect(table.rls, table.relname).toBe(true);
    const columns = (await admin.query<{ table_name: string }>("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and is_nullable = 'NO' and table_name = any($1)", [FINANCIAL])).rows;
    expect(columns.map((row) => row.table_name).sort()).toEqual([...FINANCIAL].sort());
  });

  test("money is whole cents in integer columns: no float, no money type, anywhere in the financial tables", async () => {
    const types = (
      await admin.query<{ table_name: string; column_name: string; data_type: string }>(
        "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = any($1) and (column_name like '%cents' or data_type in ('real', 'double precision', 'money'))",
        [FINANCIAL],
      )
    ).rows;
    expect(types.filter((row) => row.data_type !== "integer")).toEqual([]);
    expect(types.map((row) => `${row.table_name}.${row.column_name}`).sort()).toEqual([
      "invoice_line_items.line_total_cents",
      "invoice_line_items.unit_price_cents",
      "invoices.previously_paid_cents",
      "payments.amount_cents",
      "quote_line_items.line_total_cents",
      "quote_line_items.unit_price_cents",
    ]);
    // A quantity is the one decimal, and it is exact: numeric(10,2).
    const quantity = (await admin.query("select table_name, numeric_precision, numeric_scale from information_schema.columns where table_schema = 'public' and column_name = 'quantity' and table_name = any($1) order by table_name", [FINANCIAL])).rows;
    expect(quantity).toEqual([
      { table_name: "invoice_line_items", numeric_precision: 10, numeric_scale: 2 },
      { table_name: "quote_line_items", numeric_precision: 10, numeric_scale: 2 },
    ]);
  });

  test("every reference from a financial table to another business table goes through the organization (composite foreign keys)", async () => {
    const keys = (
      await admin.query<{ conname: string; tbl: string; target: string; first_column: string }>(
        `select c.conname, c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as target, a.attname as first_column
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and c.conrelid = any($1::regclass[]) and c.confrelid <> 'organizations'::regclass
          order by c.conname`,
        [FINANCIAL],
      )
    ).rows;
    expect(keys).toHaveLength(20);
    expect(keys.filter((key) => key.first_column !== "organization_id").map((key) => key.conname)).toEqual([]);
    // The ones that matter most: the money ones.
    const names = keys.map((key) => key.conname);
    for (const expected of ["payments_invoice_fk", "payments_invoice_customer_fk", "payments_customer_fk", "invoices_quote_fk", "invoices_job_fk", "invoices_customer_fk", "invoice_lines_service_fk", "quotes_customer_fk"]) {
      expect(names, expected).toContain(expected);
    }
  });

  test("the runtime role cannot delete or truncate anything financial: not as an owner, not as an admin", async () => {
    for (const table of FINANCIAL) {
      for (const who of [user.alex, user.casey]) {
        const result = await as(who, apex, (client) => client.query(`delete from ${table}`));
        expect(result.error, `${table} as ${who}`).toMatch(/permission denied/i);
      }
    }
    expect((await as(user.alex, apex, (client) => client.query("truncate payments"))).error).toMatch(/permission denied/i);
  });

  test("business financials are not Climvia's own billing: no table here is shared with, or named for, subscriptions", async () => {
    const tables = (await admin.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by table_name")).rows.map((row) => row.table_name);
    expect(tables.filter((name) => /subscription|plan_billing|saas|stripe|gateway|card|bank/.test(name))).toEqual([]);
    for (const table of FINANCIAL) expect(tables).toContain(table);
  });
});

test.describe("reading (SELECT)", () => {
  test("with no context nothing is visible, in any financial table", async () => {
    const result = await as(null, null, async (client) => Object.fromEntries(await Promise.all(FINANCIAL.map(async (table) => [table, await count(client, table)]))));
    expect(result.value).toEqual({ quotes: 0, quote_line_items: 0, invoices: 0, invoice_line_items: 0, payments: 0 });
  });

  test("the Apex owner sees Apex's financials and none of Northstar's", async () => {
    const result = await as(user.alex, apex, async (client) => ({
      counts: Object.fromEntries(await Promise.all(FINANCIAL.map(async (table) => [table, await count(client, table)]))),
      foreign: (await client.query("select count(*)::int as n from payments where organization_id = $1", [northstar])).rows[0].n,
    }));
    expect(result.value).toEqual({ counts: { quotes: 4, quote_line_items: 6, invoices: 9, invoice_line_items: 11, payments: 8 }, foreign: 0 });
  });

  test("the Northstar owner sees Northstar's financials and none of Apex's", async () => {
    const result = await as(user.taylor, northstar, async (client) => ({
      quotes: await count(client, "quotes"),
      invoices: await count(client, "invoices"),
      payments: await count(client, "payments"),
      apexInvoice: (await client.query("select count(*)::int as n from invoices where id = $1", [a.inv1050])).rows[0].n,
    }));
    expect(result.value).toEqual({ quotes: 2, invoices: 2, payments: 2, apexInvoice: 0 });
  });

  test("pointing the context at a business you are not in returns none of its rows", async () => {
    for (const [who, org] of [[user.taylor, apex], [user.alex, northstar], [user.jamie, northstar]] as const) {
      const result = await as(who, org, async (client) => Promise.all(FINANCIAL.map((table) => count(client, table))));
      expect(result.value, `${who} at ${org}`).toEqual([0, 0, 0, 0, 0]);
    }
  });

  test("a member can read the business's financials (they cannot change them, below)", async () => {
    const result = await as(user.jamie, apex, async (client) => [await count(client, "invoices"), await count(client, "payments")]);
    expect(result.value).toEqual([9, 8]);
  });

  test("someone in both businesses sees only the active one at a time", async () => {
    const atApex = await as(user.casey, apex, (client) => count(client, "payments"));
    const atNorthstar = await as(user.casey, northstar, (client) => count(client, "payments"));
    expect([atApex.value, atNorthstar.value]).toEqual([8, 2]);
  });

  test("an invoice id from another business cannot be read by naming it", async () => {
    const result = await as(user.taylor, northstar, (client) => client.query("select * from invoices where id = $1", [a.inv1050]));
    expect(result.value?.rowCount).toBe(0);
    const lines = await as(user.taylor, northstar, (client) => client.query("select * from invoice_line_items where invoice_id = $1", [a.inv1050]));
    expect(lines.value?.rowCount).toBe(0);
  });
});

test.describe("writing (INSERT)", () => {
  test("an owner or admin of the active business can create a quote, an invoice with lines, and a payment", async () => {
    for (const who of [user.alex, user.casey]) {
      const result = await as(who, apex, async (client) => {
        const quote = await insertQuote(client, apex);
        await insertLine(client, "quote", apex, quote);
        const invoice = await newInvoice(client, apex);
        await insertPayment(client, apex, invoice, { amount_cents: 30000 });
        return [await count(client, "quotes"), await count(client, "invoices"), await count(client, "payments")];
      });
      expect(result.error, who).toBeUndefined();
      expect(result.value, who).toEqual([5, 10, 9]);
    }
  });

  test("a member cannot create a quote, an invoice or a payment", async () => {
    const quote = await as(user.jamie, apex, (client) => insertQuote(client, apex));
    expect(quote.error).toMatch(/row-level security/i);
    const invoice = await as(user.jamie, apex, (client) => insertInvoice(client, apex));
    expect(invoice.error).toMatch(/row-level security/i);
    const payment = await as(user.jamie, apex, (client) => insertPayment(client, apex, a.inv1051));
    expect(payment.error).toMatch(/row-level security/i);
  });

  test("with no context, or as someone who is not in the business, nothing can be created", async () => {
    for (const [who, org] of [[null, null], [user.alex, null], [user.taylor, apex], [user.alex, northstar]] as const) {
      const result = await as(who, org, (client) => insertInvoice(client, apex));
      expect(result.error, `${who} at ${org}`).toMatch(/row-level security/i);
    }
  });

  test("a quote is created as a draft, nothing else", async () => {
    for (const status of ["sent", "approved", "declined", "expired"]) {
      const result = await as(user.alex, apex, (client) => insertQuote(client, apex, { status, sent_on: "2030-01-02", approved_on: status === "approved" ? "2030-01-02" : null }));
      expect(result.error, status).toMatch(/row-level security/i);
    }
  });

  test("an invoice made through the application is never imported and carries no money 'previously paid'", async () => {
    const imported = await as(user.alex, apex, (client) => insertInvoice(client, apex, { imported: true }));
    expect(imported.error).toMatch(/row-level security/i);
    const carried = await as(user.alex, apex, (client) => insertInvoice(client, apex, { previously_paid_cents: 5000 }));
    expect(carried.error).toMatch(/row-level security|invoices_previously_paid/i);
    // Even the owner role cannot carry money on an invoice that is not imported.
    const direct = await admin.query("insert into invoices (organization_id, number, contact_name, issue_date, payment_terms, previously_paid_cents) values ($1, 9999, 'x', '2030-01-02', 'net-7', 100)", [apex]).then(
      () => "inserted",
      (error: { constraint?: string }) => error.constraint,
    );
    expect(direct).toBe("invoices_previously_paid");
  });

  test("lines can join a document only in the transaction that created it: an existing quote or invoice gains none", async () => {
    const invoiceLine = await as(user.alex, apex, (client) => insertLine(client, "invoice", apex, a.inv1051, { sort_order: 2 }));
    expect(invoiceLine.error).toMatch(/row-level security/i);
    const quoteLine = await as(user.alex, apex, (client) => insertLine(client, "quote", apex, a.qt884, { sort_order: 4 }));
    expect(quoteLine.error).toMatch(/row-level security/i);
  });

  test("a payment is recorded, never inserted as voided", async () => {
    const result = await as(user.alex, apex, (client) =>
      insertPayment(client, apex, a.inv1051, { status: "voided", voided_at: "2030-01-02T12:00:00Z", void_reason: "Other" }),
    );
    expect(result.error).toMatch(/row-level security/i);
  });

  test("a payment cannot be more than the balance: INV-1051 takes $380.00 but not $380.01; INV-1050 takes its $300 balance after the $200 carried", async () => {
    const exact = await as(user.alex, apex, (client) => insertPayment(client, apex, a.inv1051, { amount_cents: 38000 }));
    expect(exact.error).toBeUndefined();
    const over = await as(user.alex, apex, (client) => insertPayment(client, apex, a.inv1051, { amount_cents: 38001 }));
    expect(over.constraint).toBe("payments_overpayment");
    const carriedOk = await as(user.alex, apex, (client) => insertPayment(client, apex, a.inv1050, { amount_cents: 30000 }));
    expect(carriedOk.error).toBeUndefined();
    const carriedOver = await as(user.alex, apex, (client) => insertPayment(client, apex, a.inv1050, { amount_cents: 30001 }));
    expect(carriedOver.constraint).toBe("payments_overpayment");
  });

  test("the second payment sees the first: $200 then $200 on a $300 invoice is refused; a voided payment frees its share", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const invoice = await newInvoice(client, apex);
      const first = await insertPayment(client, apex, invoice, { number: 9001, amount_cents: 20000 });
      const second = await insertPayment(client, apex, invoice, { number: 9002, amount_cents: 20000 }).then(() => "ok", (error: { constraint?: string }) => error.constraint);
      return { first: Boolean(first), second };
    });
    expect(result.value).toEqual({ first: true, second: "payments_overpayment" });

    const freed = await as(user.alex, apex, async (client) => {
      const invoice = await newInvoice(client, apex);
      const first = await insertPayment(client, apex, invoice, { number: 9001, amount_cents: 30000 });
      await client.query("update payments set status = 'voided', voided_at = now(), void_reason = 'Duplicate payment' where id = $1", [first]);
      await insertPayment(client, apex, invoice, { number: 9002, amount_cents: 30000 });
      return (await client.query("select count(*)::int as n from payments where invoice_id = $1 and status = 'recorded'", [invoice])).rows[0].n;
    });
    expect(freed.error).toBeUndefined();
    expect(freed.value).toBe(1);
  });

  test("a payment's amount is above zero, its method is one of the five, and nothing about a payment is optional that should not be", async () => {
    for (const [values, constraint] of [
      [{ amount_cents: 0 }, "payments_amount"],
      [{ amount_cents: -100 }, "payments_amount"],
      [{ method: "wire" }, "payments_method"],
      [{ method: "stripe" }, "payments_method"],
    ] as const) {
      const result = await as(user.alex, apex, (client) => insertPayment(client, apex, a.inv1051, values));
      expect(result.constraint, JSON.stringify(values)).toBe(constraint);
    }
    for (const column of ["invoice_id", "amount_cents", "method", "paid_on", "recorded_at", "number"]) {
      const result = await as(user.alex, apex, (client) => insertPayment(client, apex, a.inv1051, { [column]: null }));
      expect(result.code, column).toBe("23502");
    }
  });

  test("a payment's customer is its invoice's, whatever the caller says", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const sarahInvoice = await newInvoice(client, apex, { contact_name: null, customer_id: a.sarah, property_id: a.sarahHome });
      const nameInvoice = await newInvoice(client, apex, { number: 9002 });
      const forSarah = await insertPayment(client, apex, sarahInvoice, { number: 9001, customer_id: a.david });
      // Even a customer of ANOTHER BUSINESS named on a payment is replaced, so it cannot be stored.
      const forName = await insertPayment(client, apex, nameInvoice, { number: 9002, customer_id: n.marta });
      const rows = (await client.query<{ id: string; customer_id: string | null }>("select id, customer_id from payments where id = any($1)", [[forSarah, forName]])).rows;
      return Object.fromEntries(rows.map((row): [string, string | null] => [row.id === forSarah ? "sarah" : "name", row.customer_id]));
    });
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({ sarah: a.sarah, name: null });
  });

  test("a document number is unique within a business: QT-884, INV-1050 and PAY-1008 cannot be created twice, but another business may hold them", async () => {
    const quote = await as(user.alex, apex, (client) => insertQuote(client, apex, { number: 884 }));
    expect(quote.constraint).toBe("quotes_org_number_unique");
    const invoice = await as(user.alex, apex, (client) => insertInvoice(client, apex, { number: 1050 }));
    expect(invoice.constraint).toBe("invoices_org_number_unique");
    const payment = await as(user.alex, apex, (client) => insertPayment(client, apex, a.inv1051, { number: 1008 }));
    expect(payment.constraint).toBe("payments_org_number_unique");
    // Northstar may issue the very same numbers.
    const other = await as(user.taylor, northstar, async (client) => {
      await insertQuote(client, northstar, { number: 884 });
      await insertInvoice(client, northstar, { number: 1050 });
      return true;
    });
    expect(other.error).toBeUndefined();
    const zero = await as(user.alex, apex, (client) => insertInvoice(client, apex, { number: 0 }));
    expect(zero.constraint).toBe("invoices_number_positive");
  });

  test("a quote can have only one invoice", async () => {
    const result = await as(user.alex, apex, async (client) => {
      await insertInvoice(client, apex, { number: 9001, quote_id: a.qt884 });
      return insertInvoice(client, apex, { number: 9002, quote_id: a.qt884 }).then(() => "ok", (error: { constraint?: string }) => error.constraint);
    });
    expect(result.value).toBe("invoices_org_quote_unique");
  });

  test("a document is for a customer or for a name, never both and never neither; terms and statuses are the known ones", async () => {
    for (const [values, constraint] of [
      [{ contact_name: null }, "invoices_party"],
      [{ customer_id: a.sarah }, "invoices_party"],
      [{ payment_terms: "net-90" }, "invoices_terms"],
      [{ contact_name: "x", property_id: a.sarahHome }, "invoices_property_needs_customer"],
    ] as const) {
      const result = await as(user.alex, apex, (client) => insertInvoice(client, apex, values));
      expect(result.constraint, JSON.stringify(values)).toBe(constraint);
    }
    const quote = await as(user.alex, apex, (client) => insertQuote(client, apex, { contact_name: null }));
    expect(quote.constraint).toBe("quotes_party");
  });

  test("a line's total must be its quantity times its price, rounded, and a quantity is above zero", async () => {
    const bad = await as(user.alex, apex, async (client) => {
      const invoice = await insertInvoice(client, apex);
      return insertLine(client, "invoice", apex, invoice, { quantity: "1.50", unit_price_cents: 13000, line_total_cents: 19501 }).then(() => "ok", (error: { constraint?: string }) => error.constraint);
    });
    expect(bad.value).toBe("invoice_lines_total");
    const good = await as(user.alex, apex, async (client) => {
      const quote = await insertQuote(client, apex);
      return insertLine(client, "quote", apex, quote, { quantity: "1.50", unit_price_cents: 13000, line_total_cents: 19500 });
    });
    expect(good.error).toBeUndefined();
    for (const [values, constraint] of [
      [{ quantity: "0" }, "quote_lines_quantity"],
      [{ quantity: "-1" }, "quote_lines_quantity"],
      [{ unit_price_cents: -1, line_total_cents: -1 }, "quote_lines_price"],
    ] as const) {
      const result = await as(user.alex, apex, async (client) => insertLine(client, "quote", apex, await insertQuote(client, apex), values));
      expect(result.constraint, JSON.stringify(values)).toBe(constraint);
    }
  });
});

test.describe("writing (UPDATE)", () => {
  test("an owner can void a recorded payment; the void is stored with when and why, and a second void is refused", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const voided = await client.query("update payments set status = 'voided', voided_at = now(), void_reason = 'Duplicate payment', void_note = 'entered twice', voided_by = $2 where id = $1", [a.pay1008, a.alexMember]);
      const row = (await client.query("select status, void_reason, void_note, voided_by, voided_at is not null as has_time, amount_cents from payments where id = $1", [a.pay1008])).rows[0];
      const again = await client.query("update payments set void_reason = 'Other' where id = $1", [a.pay1008]).then(() => "ok", (error: { constraint?: string }) => error.constraint);
      return { updated: voided.rowCount, row, again };
    });
    expect(result.value).toEqual({
      updated: 1,
      row: { status: "voided", void_reason: "Duplicate payment", void_note: "entered twice", voided_by: a.alexMember, has_time: true, amount_cents: 28500 },
      again: "payments_final",
    });
  });

  test("voiding reopens the balance: INV-1044 owes $285 again, and the payment is still there", async () => {
    const result = await as(user.alex, apex, async (client) => {
      await client.query("update payments set status = 'voided', voided_at = now(), void_reason = 'Incorrect amount' where id = $1", [a.pay1008]);
      const rows = (await client.query(sqlFigures.replace("where i.organization_id = $1", "where i.id = $1"), [a.inv1044])).rows[0];
      return { ...rows, payments: (await client.query("select count(*)::int as n from payments where invoice_id = $1", [a.inv1044])).rows[0].n };
    });
    expect(result.value).toEqual({ number: 1044, total: 28500, carried: 0, received: 0, payments: 2 });
  });

  test("a voided payment is final: it cannot be un-voided, edited or voided again", async () => {
    for (const statement of [
      "update payments set status = 'recorded', voided_at = null, void_reason = null where number = 1001",
      "update payments set void_reason = 'Other' where number = 1001",
      "update payments set status = 'voided', voided_at = now(), void_reason = 'Other' where number = 1001",
    ]) {
      const result = await as(user.alex, apex, (client) => client.query(statement));
      expect(result.constraint, statement).toBe("payments_final");
    }
  });

  test("a recorded payment can only become voided, and a void names its reason", async () => {
    const note = await as(user.alex, apex, (client) => client.query("update payments set void_note = 'x' where number = 1008"));
    expect(note.constraint).toBe("payments_status_transition");
    const noReason = await as(user.alex, apex, (client) => client.query("update payments set status = 'voided', voided_at = now() where number = 1008"));
    expect(noReason.constraint).toBe("payments_void");
    const noTime = await as(user.alex, apex, (client) => client.query("update payments set status = 'voided', void_reason = 'Other' where number = 1008"));
    expect(noTime.constraint).toBe("payments_void");
  });

  test("a payment's identity cannot be rewritten: its invoice, customer, amount, method, date, number and business are fixed", async () => {
    for (const column of ["invoice_id = $1", "customer_id = $1", "amount_cents = 1", "method = 'cash'", "paid_on = '2030-01-01'", "number = 9999", "organization_id = $1", "recorded_at = now()", "note = 'x'", "check_number = '1'", "recorded_by = $1"]) {
      const params = column.includes("$1") ? [column.startsWith("organization_id") ? northstar : a.inv1051] : [];
      const result = await as(user.alex, apex, (client) => client.query(`update payments set ${column} where number = 1008`, params));
      expect(result.error, column).toMatch(/permission denied/i);
    }
  });

  test("invoices and every line have no UPDATE at all: their money cannot change after they are made", async () => {
    for (const statement of [
      "update invoices set message = 'x'",
      "update invoices set payment_terms = 'net-30'",
      "update invoices set previously_paid_cents = 0",
      "update invoice_line_items set unit_price_cents = 1, line_total_cents = 1",
      "update quote_line_items set quantity = 2",
    ]) {
      const result = await as(user.alex, apex, (client) => client.query(statement));
      expect(result.error, statement).toMatch(/permission denied/i);
    }
  });

  test("a quote changes its status and the date of that step, and nothing else", async () => {
    for (const column of ["number = 1", "customer_id = null", "contact_name = 'x'", "message = 'x'", "created_on = '2020-01-01'", "valid_through = '2030-01-01'", "job_id = null", "organization_id = gen_random_uuid()"]) {
      const result = await as(user.alex, apex, (client) => client.query(`update quotes set ${column} where number = 893`));
      expect(result.error, column).toMatch(/permission denied/i);
    }
  });

  test("a quote moves only forward: draft to sent, sent to approved, declined or expired; final is final", async () => {
    const sent = await as(user.alex, apex, async (client) => {
      await client.query("update quotes set status = 'sent', sent_on = '2024-10-25' where number = 893");
      return (await client.query("select status, sent_on::text as sent_on from quotes where number = 893")).rows[0];
    });
    expect(sent.value).toEqual({ status: "sent", sent_on: "2024-10-25" });
    const approved = await as(user.alex, apex, async (client) => {
      await client.query("update quotes set status = 'approved', approved_on = '2024-10-25' where number = 891");
      return (await client.query("select status from quotes where number = 891")).rows[0].status;
    });
    expect(approved.value).toBe("approved");
    // draft cannot jump to approved; sent cannot go back to draft.
    const jump = await as(user.alex, apex, (client) => client.query("update quotes set status = 'approved', sent_on = '2024-10-25', approved_on = '2024-10-25' where number = 893"));
    expect(jump.constraint).toBe("quotes_status_transition");
    const back = await as(user.alex, apex, (client) => client.query("update quotes set status = 'draft', sent_on = null where number = 891"));
    expect(back.constraint).toBe("quotes_status_transition");
    // approved and declined are final.
    for (const [number, to] of [[884, "declined"], [879, "approved"], [884, "sent"]] as const) {
      const result = await as(user.alex, apex, (client) => client.query(`update quotes set status = '${to}' where number = ${number}`));
      expect(result.constraint, `${number} -> ${to}`).toBe("quotes_final");
    }
  });

  test("a status never contradicts its date: Sent has its sent date, Approved has its approval date", async () => {
    const noDate = await as(user.alex, apex, (client) => client.query("update quotes set status = 'sent' where number = 893"));
    expect(noDate.constraint).toBe("quotes_status_dates");
    const noApproval = await as(user.alex, apex, (client) => client.query("update quotes set status = 'approved' where number = 891"));
    expect(noApproval.constraint).toBe("quotes_status_dates");
  });

  test("a member, another business's owner, and no context change nothing (zero rows, no error)", async () => {
    for (const [who, org] of [[user.jamie, apex], [user.taylor, northstar], [user.taylor, apex], [null, null]] as const) {
      const result = await as(who, org, async (client) => ({
        payment: (await client.query("update payments set status = 'voided', voided_at = now(), void_reason = 'Other' where id = $1", [a.pay1008])).rowCount,
        quote: (await client.query("update quotes set status = 'sent', sent_on = '2030-01-02' where id = $1", [a.qt893])).rowCount,
      }));
      expect(result.value, `${who} at ${org}`).toEqual({ payment: 0, quote: 0 });
    }
  });

  test("updated_at moves when a record changes", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const before = (await client.query("select updated_at from quotes where number = 893")).rows[0].updated_at as Date;
      await client.query("select pg_sleep(0.02)");
      await client.query("update quotes set status = 'sent', sent_on = '2024-10-25' where number = 893");
      const after = (await client.query("select clock_timestamp() > updated_at as moved, updated_at > $1 as later from quotes where number = 893", [before])).rows[0];
      return after;
    });
    expect(result.value).toEqual({ moved: true, later: true });
  });
});

test.describe("deleting (DELETE)", () => {
  test("nobody deletes a quote, invoice, payment or line: the correction for a payment is a void, and it stays", async () => {
    for (const statement of [
      "delete from payments where number = 1008",
      "delete from invoices where number = 1051",
      "delete from quotes where number = 893",
      "delete from invoice_line_items",
      "delete from quote_line_items",
    ]) {
      const result = await as(user.alex, apex, (client) => client.query(statement));
      expect(result.error, statement).toMatch(/permission denied/i);
    }
    expect((await admin.query("select count(*)::int as n from payments where organization_id = $1", [apex])).rows[0].n).toBe(8);
  });
});

test.describe("relations across businesses are impossible", () => {
  const fk = (error: { constraint?: string; code?: string }) => `${error.code}:${error.constraint}`;

  test("an Apex quote cannot point at a Northstar customer, service, job or booking", async () => {
    for (const [values, name] of [
      [{ contact_name: null, customer_id: n.marta }, "quotes_customer_fk"],
      [{ service_id: n.tuneUp }, "quotes_service_fk"],
      [{ job_id: n.job1001 }, "quotes_job_fk"],
      [{ booking_id: n.booking1001 }, "quotes_booking_fk"],
    ] as const) {
      const result = await as(user.alex, apex, (client) => insertQuote(client, apex, values));
      expect(result.error ? `${result.code}:${result.constraint}` : "inserted", JSON.stringify(values)).toBe(`23503:${name}`);
    }
  });

  test("an Apex invoice cannot point at a Northstar customer, service, job, booking or quote", async () => {
    for (const [values, name] of [
      [{ contact_name: null, customer_id: n.marta }, "invoices_customer_fk"],
      [{ service_id: n.tuneUp }, "invoices_service_fk"],
      [{ job_id: n.job1001 }, "invoices_job_fk"],
      [{ booking_id: n.booking1001 }, "invoices_booking_fk"],
      [{ quote_id: n.qt1001 }, "invoices_quote_fk"],
    ] as const) {
      const result = await as(user.alex, apex, (client) => insertInvoice(client, apex, values));
      expect(result.error ? `${result.code}:${result.constraint}` : "inserted", JSON.stringify(values)).toBe(`23503:${name}`);
    }
  });

  test("a line cannot name another business's Service, on a quote or an invoice", async () => {
    const quote = await as(user.alex, apex, async (client) => insertLine(client, "quote", apex, await insertQuote(client, apex), { service_id: n.tuneUp }));
    expect(fk(quote)).toBe("23503:quote_lines_service_fk");
    const invoice = await as(user.alex, apex, async (client) => insertLine(client, "invoice", apex, await insertInvoice(client, apex), { service_id: n.tuneUp }));
    expect(fk(invoice)).toBe("23503:invoice_lines_service_fk");
    const own = await as(user.alex, apex, async (client) => insertLine(client, "invoice", apex, await insertInvoice(client, apex), { service_id: a.cooling }));
    expect(own.error).toBeUndefined();
  });

  test("a line cannot join another business's document", async () => {
    const result = await as(user.alex, apex, (client) => insertLine(client, "invoice", apex, n.inv1001));
    expect(result.error).toBeDefined();
    const northstarCaller = await as(user.taylor, northstar, (client) => insertLine(client, "invoice", northstar, a.inv1051));
    expect(northstarCaller.error).toBeDefined();
  });

  test("an Apex payment cannot name a Northstar invoice, a Northstar customer or a Northstar team member", async () => {
    const invoice = await as(user.alex, apex, (client) => insertPayment(client, apex, n.inv1001));
    expect(fk(invoice)).toBe("23503:payments_invoice_fk");
    const recordedBy = await as(user.alex, apex, (client) => insertPayment(client, apex, a.inv1051, { recorded_by: n.jordan }));
    expect(fk(recordedBy)).toBe("23503:payments_recorded_by_fk");
    const voidedBy = await as(user.alex, apex, (client) => client.query("update payments set status = 'voided', voided_at = now(), void_reason = 'Other', voided_by = $1 where number = 1008", [n.jordan]));
    expect(fk(voidedBy)).toBe("23503:payments_voided_by_fk");
  });

  test("a Northstar payment cannot name an Apex invoice either", async () => {
    const result = await as(user.taylor, northstar, (client) => insertPayment(client, northstar, a.inv1051));
    expect(fk(result)).toBe("23503:payments_invoice_fk");
  });

  test("a property is its customer's own: David's invoice cannot name Sarah's property", async () => {
    const result = await as(user.alex, apex, (client) => insertInvoice(client, apex, { contact_name: null, customer_id: a.david, property_id: a.sarahHome }));
    expect(fk(result)).toBe("23503:invoices_property_fk");
    const ok = await as(user.alex, apex, (client) => insertInvoice(client, apex, { contact_name: null, customer_id: a.david, property_id: a.davidHome }));
    expect(ok.error).toBeUndefined();
  });

  test("an invoice's job and booking are the business's own: Sarah's JB-204 and BK-1042 can be named by an Apex invoice", async () => {
    const result = await as(user.alex, apex, (client) => insertInvoice(client, apex, { contact_name: null, customer_id: a.sarah, job_id: a.job204, booking_id: a.booking1042 }));
    expect(result.error).toBeUndefined();
  });
});

test.describe("numbering", () => {
  const next = async (client: PoolClient, kind: string) => (await client.query<{ n: number }>("select app_next_number($1) as n", [kind])).rows[0].n;

  test("app_next_number gives the next quote, invoice and payment number of the ACTIVE business, and a rollback gives it back", async () => {
    const first = await as(user.alex, apex, async (client) => [await next(client, "quote"), await next(client, "quote"), await next(client, "invoice"), await next(client, "payment")]);
    expect(first.value).toEqual([894, 895, 1052, 1009]);
    const again = await as(user.alex, apex, async (client) => [await next(client, "quote"), await next(client, "invoice"), await next(client, "payment")]);
    expect(again.value).toEqual([894, 1052, 1009]);
    const northstarNext = await as(user.taylor, northstar, async (client) => [await next(client, "quote"), await next(client, "invoice"), await next(client, "payment")]);
    expect(northstarNext.value).toEqual([1003, 1003, 1003]);
  });

  test("it cannot be used across businesses, by a member, with no context", async () => {
    for (const kind of ["quote", "invoice", "payment"]) {
      expect((await as(user.alex, northstar, (client) => next(client, kind))).error, kind).toMatch(/Not allowed/);
      expect((await as(user.taylor, apex, (client) => next(client, kind))).error, kind).toMatch(/Not allowed/);
      expect((await as(user.jamie, apex, (client) => next(client, kind))).error, kind).toMatch(/Not allowed/);
      expect((await as(null, null, (client) => next(client, kind))).error, kind).toMatch(/Not allowed/);
    }
  });

  test("a made-up kind is refused, and the counters cannot be written directly", async () => {
    expect((await as(user.alex, apex, (client) => next(client, "receipt"))).error).toMatch(/organization_sequences_kind/);
    for (const statement of ["update organization_sequences set next_value = 1 where kind = 'invoice'", "insert into organization_sequences (organization_id, kind, next_value) values (gen_random_uuid(), 'payment', 1)"]) {
      expect((await as(user.alex, apex, (client) => client.query(statement))).error, statement).toMatch(/permission denied/i);
    }
  });

  test("two new businesses each start every kind at 1001, and concurrent requests in one business are never given the same number", async () => {
    const { userId, organizations } = await newBusinesses("fin-numbering", 2);
    const [x, y] = organizations;

    const take = async (org: string, kind: string) => {
      const client = await app.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId, org]);
        const number = await next(client, kind);
        await client.query("select pg_sleep(0.02)");
        await client.query("commit");
        return number;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };

    // A number belongs to its business: both start at 1001, for every kind.
    expect(await Promise.all([take(x, "quote"), take(y, "quote"), take(x, "invoice"), take(y, "invoice"), take(x, "payment"), take(y, "payment")])).toEqual([1001, 1001, 1001, 1001, 1001, 1001]);

    // Twelve invoice requests and twelve payment requests at once in X, with Y taking numbers at the same time: no duplicates, no gaps, no crosstalk.
    const results = await Promise.all([
      ...Array.from({ length: 12 }, () => take(x, "invoice")),
      ...Array.from({ length: 12 }, () => take(x, "payment")),
      ...Array.from({ length: 5 }, () => take(y, "invoice")),
    ]);
    const sorted = (slice: number[]) => [...slice].sort((p, q) => p - q);
    expect(sorted(results.slice(0, 12))).toEqual(Array.from({ length: 12 }, (_, index) => 1002 + index));
    expect(sorted(results.slice(12, 24))).toEqual(Array.from({ length: 12 }, (_, index) => 1002 + index));
    expect(sorted(results.slice(24))).toEqual([1002, 1003, 1004, 1005, 1006]);
  });
});

test.describe("concurrency: the money stays right when requests arrive together", () => {
  test("five payments of $100 raced against a $300 invoice in raw SQL: exactly three are recorded, two are refused, the total never exceeds the invoice", async () => {
    const { userId, organizations } = await newBusinesses("fin-race-sql", 1);
    const [org] = organizations;
    const invoice = await committedInvoice(org, 1001);

    const pay = async (number: number) => {
      const client = await app.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId, org]);
        await insertPayment(client, org, invoice, { number, amount_cents: 10000 });
        await client.query("select pg_sleep(0.08)"); // hold the invoice while the others queue up behind it
        await client.query("commit");
        return "recorded";
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return (error as { constraint?: string }).constraint ?? String(error);
      } finally {
        client.release();
      }
    };
    const outcomes = await Promise.all([1001, 1002, 1003, 1004, 1005].map(pay));
    expect(outcomes.filter((outcome) => outcome === "recorded")).toHaveLength(3);
    expect(outcomes.filter((outcome) => outcome === "payments_overpayment")).toHaveLength(2);
    const stored = (await admin.query("select count(*)::int as n, sum(amount_cents)::int as total from payments where invoice_id = $1", [invoice])).rows[0];
    expect(stored).toEqual({ n: 3, total: 30000 });
  });

  test("six payments of $100 raced through the application against a $300 invoice: three succeed with consecutive PAY numbers, three are refused", async () => {
    const { userId, organizations } = await newBusinesses("fin-race-app", 1);
    const [org] = organizations;
    await committedInvoice(org, 1001);

    const record = (index: number) =>
      withTenant({ userId, organizationId: org }, async (tx) => {
        const ctx = await financeContext(tx, org, userId);
        return recordPaymentTx(ctx, { invoiceNumber: 1001, amountCents: 10000, method: "check", date: "2030-01-02" });
      }).then(
        (reference) => ({ index, reference }),
        (error) => ({ index, error: error instanceof Refusal ? error.message : String(error) }),
      );
    const outcomes = await Promise.all([0, 1, 2, 3, 4, 5].map(record));
    const recorded = outcomes.filter((outcome) => "reference" in outcome).map((outcome) => (outcome as { reference: string }).reference);
    const refused = outcomes.filter((outcome) => "error" in outcome).map((outcome) => (outcome as { error: string }).error);
    expect([...recorded].sort()).toEqual(["PAY-1001", "PAY-1002", "PAY-1003"]);
    expect(refused).toHaveLength(3);
    for (const message of refused) expect(message).toMatch(/no balance due|between \$0\.01 and/);
    const stored = (await admin.query("select count(*)::int as n, sum(amount_cents)::int as total, count(distinct number)::int as numbers from payments where organization_id = $1", [org])).rows[0];
    expect(stored).toEqual({ n: 3, total: 30000, numbers: 3 });
    // A refused payment gave its number back: the next one is PAY-1004, with no gap.
    expect((await admin.query("select next_value from organization_sequences where organization_id = $1 and kind = 'payment'", [org])).rows[0].next_value).toBe(1004);
  });

  test("invoices created from six different quotes at once are numbered 1001 to 1006, once each", async () => {
    const { userId, organizations } = await newBusinesses("fin-race-invoices", 1);
    const [org] = organizations;
    for (let number = 1001; number <= 1006; number += 1) {
      const quote = (
        await admin.query<{ id: string }>(
          "insert into quotes (organization_id, number, contact_name, status, created_on, sent_on, approved_on) values ($1, $2, 'Pat Payer', 'approved', '2030-01-01', '2030-01-01', '2030-01-01') returning id",
          [org, number],
        )
      ).rows[0].id;
      await admin.query("insert into quote_line_items (organization_id, quote_id, sort_order, description, quantity, unit_price_cents, line_total_cents) values ($1, $2, 1, 'Work', 1, 10000, 10000)", [org, quote]);
    }
    const create = (quoteNumber: number) =>
      withTenant({ userId, organizationId: org }, async (tx) => createInvoiceFromQuoteTx(await financeContext(tx, org, userId), { quoteNumber, terms: "due-on-receipt" }));
    const references = await Promise.all([1001, 1002, 1003, 1004, 1005, 1006].map(create));
    expect([...references].sort()).toEqual(["INV-1001", "INV-1002", "INV-1003", "INV-1004", "INV-1005", "INV-1006"]);
    const stored = (await admin.query("select count(*)::int as n, count(distinct number)::int as numbers, count(distinct quote_id)::int as quotes from invoices where organization_id = $1", [org])).rows[0];
    expect(stored).toEqual({ n: 6, numbers: 6, quotes: 6 });
    // Each copied its quote's lines: $100 each.
    expect((await admin.query("select sum(line_total_cents)::int as total from invoice_line_items where organization_id = $1", [org])).rows[0].total).toBe(60000);
  });

  test("three requests to invoice the same quote at once: exactly one invoice is created", async () => {
    const { userId, organizations } = await newBusinesses("fin-race-one-quote", 1);
    const [org] = organizations;
    const quote = (
      await admin.query<{ id: string }>(
        "insert into quotes (organization_id, number, contact_name, status, created_on, sent_on, approved_on) values ($1, 1001, 'Pat Payer', 'approved', '2030-01-01', '2030-01-01', '2030-01-01') returning id",
        [org],
      )
    ).rows[0].id;
    await admin.query("insert into quote_line_items (organization_id, quote_id, sort_order, description, quantity, unit_price_cents, line_total_cents) values ($1, $2, 1, 'Work', 1, 10000, 10000)", [org, quote]);
    const create = () =>
      withTenant({ userId, organizationId: org }, async (tx) => createInvoiceFromQuoteTx(await financeContext(tx, org, userId), { quoteNumber: 1001, terms: "net-7" })).then(
        (reference) => reference,
        (error) => (error instanceof Refusal ? error.message : String(error)),
      );
    const outcomes = await Promise.all([create(), create(), create()]);
    expect(outcomes.filter((outcome) => outcome === "INV-1001")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "That quote already has an invoice.")).toHaveLength(2);
    expect((await admin.query("select count(*)::int as n from invoices where organization_id = $1", [org])).rows[0].n).toBe(1);
  });

  test("three requests to void the same payment at once: exactly one voids it, and it is voided once", async () => {
    const { userId, organizations } = await newBusinesses("fin-race-void", 1);
    const [org] = organizations;
    const invoice = await committedInvoice(org, 1001);
    await admin.query("insert into payments (organization_id, number, invoice_id, amount_cents, method, status, paid_on, recorded_at) values ($1, 1001, $2, 30000, 'check', 'recorded', '2030-01-02', '2030-01-02T12:00:00Z')", [org, invoice]);
    const voidIt = () =>
      withTenant({ userId, organizationId: org }, async (tx) => voidPaymentTx(await financeContext(tx, org, userId), { paymentNumber: 1001, reason: "Duplicate payment" })).then(
        () => "voided",
        (error) => (error instanceof Refusal ? error.message : String(error)),
      );
    const outcomes = await Promise.all([voidIt(), voidIt(), voidIt()]);
    expect(outcomes.filter((outcome) => outcome === "voided")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "That payment has already been voided.")).toHaveLength(2);
    const stored = (await admin.query("select status, void_reason from payments where organization_id = $1", [org])).rows;
    expect(stored).toEqual([{ status: "voided", void_reason: "Duplicate payment" }]);
  });

  test("a void and a new payment racing on one invoice can never leave it over-paid", async () => {
    const { userId, organizations } = await newBusinesses("fin-race-void-pay", 1);
    const [org] = organizations;
    const invoice = await committedInvoice(org, 1001);
    await admin.query("insert into payments (organization_id, number, invoice_id, amount_cents, method, status, paid_on, recorded_at) values ($1, 1001, $2, 30000, 'check', 'recorded', '2030-01-02', '2030-01-02T12:00:00Z')", [org, invoice]);
    const attempts = await Promise.all([
      withTenant({ userId, organizationId: org }, async (tx) => voidPaymentTx(await financeContext(tx, org, userId), { paymentNumber: 1001, reason: "Incorrect amount" })).then(() => "voided", (e) => String(e instanceof Refusal ? e.message : e)),
      withTenant({ userId, organizationId: org }, async (tx) => recordPaymentTx(await financeContext(tx, org, userId), { invoiceNumber: 1001, amountCents: 30000, method: "cash", date: "2030-01-02" })).then(() => "recorded", (e) => String(e instanceof Refusal ? e.message : e)),
    ]);
    expect(attempts[0]).toBe("voided");
    const received = (await admin.query("select coalesce(sum(amount_cents), 0)::int as total from payments where invoice_id = $1 and status = 'recorded'", [invoice])).rows[0].total;
    // Either order is correct: the void first lets the new $300 in; the payment first is refused (the invoice was still paid in full).
    // What can never happen is more than the invoice's $300 recorded against it.
    expect([0, 30000]).toContain(received);
    expect(attempts[1] === "recorded").toBe(received === 30000);
  });
});
