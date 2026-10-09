/**
 * Phase 11: tenant isolation of the operational tables at the DATABASE, independent of the application code.
 *
 * Like database-isolation.spec.ts, these connect to the freshly migrated and seeded test database as the restricted runtime role
 * the app uses (`climvia_app`, DATABASE_URL), set the transaction-local context the way src/db/tenant.ts does, and check that
 * PostgreSQL itself keeps businesses apart: Row Level Security for who may read and write, column grants for what may change,
 * composite foreign keys for what may point at what, and the numbering function for who may take a number. Almost every test
 * runs in a transaction that is rolled back; the numbering tests that must commit use organizations of their own.
 */
import { randomBytes } from "node:crypto";
import { test as base, expect } from "playwright/test";
import { Pool, type PoolClient } from "pg";
import { insertServices } from "../src/db/core-queries";
import { allocateBookingNumber } from "../src/db/ops-queries";
import { withTenant } from "../src/db/tenant";
import { RESERVED_BOOKING_NUMBERS } from "../src/lib/operations-rules";
import { adminDb } from "../scripts/db/lib";
import { SERVICES } from "../scripts/db/seed-data/services";
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
/** Public references -> database ids, per business. */
const apexId: Record<string, string> = {};
const northstarId: Record<string, string> = {};

async function idOf(table: string, organizationId: string, slug: string): Promise<string> {
  return (await admin.query<{ id: string }>(`select id from ${table} where organization_id = $1 and slug = $2`, [organizationId, slug])).rows[0].id;
}

test.beforeAll(async () => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
  for (const [key, email] of Object.entries(SEED)) user[key] = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
  apex = (await admin.query<{ id: string }>("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id;
  northstar = (await admin.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
  for (const [key, table, slug] of [
    ["sarah", "customers", "sarah-mitchell"],
    ["david", "customers", "david-chen"],
    ["sarahHome", "customer_properties", "prop-sarah-home"],
    ["davidHome", "customer_properties", "prop-david-home"],
    ["cooling", "services", "annual-cooling-tune-up"],
    ["marcus", "team_members", "marcus-vance"],
  ] as const) apexId[key] = await idOf(table, apex, slug);
  for (const [key, table, slug] of [
    ["marta", "customers", "marta-olsen"],
    ["tuneUp", "services", "furnace-tune-up"],
    ["jordan", "team_members", "jordan-pike"],
  ] as const) northstarId[key] = await idOf(table, northstar, slug);
});

test.afterAll(async () => {
  await app.end();
  await admin.end();
});

type Outcome<T> = { value: T; error?: undefined; code?: undefined } | { value?: undefined; error: string; code?: string };

/** Run `fn` as `userId` inside `org` (either may be absent), in a transaction that is always rolled back. */
async function as<T>(userId: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId ?? "", org ?? ""]);
    return { value: await fn(client) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code };
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

const count = async (client: PoolClient, table: string) => (await client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
const OPERATIONAL = ["bookings", "jobs", "job_files", "schedule_blocks", "schedule_block_members", "organization_sequences"];

/** A valid booking for the business `org`, overridden by `values`. */
async function insertBooking(client: PoolClient, org: string, values: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    organization_id: org,
    number: 9001,
    contact_name: "Test Person",
    service_id: org === apex ? apexId.cooling : northstarId.tuneUp,
    source: "Other",
    status: "confirmed",
    service_date: "2030-01-07",
    start_time: "09:00",
    end_time: "10:00",
    received_at: "2030-01-01T00:00:00Z",
    confirmed_at: "2030-01-01T00:00:00Z",
    ...values,
  };
  const columns = Object.keys(row);
  const result = await client.query<{ id: string }>(
    `insert into bookings (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
    columns.map((column) => row[column]),
  );
  return result.rows[0].id;
}

async function insertJob(client: PoolClient, org: string, values: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    organization_id: org,
    number: 9001,
    contact_name: "Test Person",
    service_id: org === apex ? apexId.cooling : northstarId.tuneUp,
    status: "scheduled",
    service_date: "2030-01-07",
    start_time: "09:00",
    end_time: "10:00",
    ...values,
  };
  const columns = Object.keys(row);
  const result = await client.query<{ id: string }>(
    `insert into jobs (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
    columns.map((column) => row[column]),
  );
  return result.rows[0].id;
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
    const userId = await ensureUser(auth, db, { email: `${label}-${suffix}@apex.test`, name: "Numbering Tester" }, process.env.SEED_PASSWORD ?? "");
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

const bookingId = async (client: PoolClient, number: number) => (await client.query<{ id: string }>("select id from bookings where number = $1", [number])).rows[0].id;

test.describe("what the seed holds", () => {
  test("Apex has its approved operations and Northstar a few of its own; BK-1001 exists only in Northstar", async () => {
    const counts = await admin.query<{ slug: string; bookings: number; jobs: number; files: number; blocks: number }>(
      `select o.slug,
              (select count(*)::int from bookings b where b.organization_id = o.id) as bookings,
              (select count(*)::int from jobs j where j.organization_id = o.id) as jobs,
              (select count(*)::int from job_files f where f.organization_id = o.id) as files,
              (select count(*)::int from schedule_blocks s where s.organization_id = o.id) as blocks
         from organizations o where o.slug in ('apex-climate-heating-air', 'northstar-heating-cooling') order by o.slug`,
    );
    expect(counts.rows).toEqual([
      { slug: "apex-climate-heating-air", bookings: 13, jobs: 11, files: 4, blocks: 2 },
      { slug: "northstar-heating-cooling", bookings: 2, jobs: 1, files: 0, blocks: 0 },
    ]);
    const numbers = await admin.query<{ slug: string; number: number }>(
      "select o.slug, b.number from bookings b join organizations o on o.id = b.organization_id where b.number in (1001, 1042) and o.slug in ('apex-climate-heating-air', 'northstar-heating-cooling') order by o.slug",
    );
    expect(numbers.rows).toEqual([
      { slug: "apex-climate-heating-air", number: 1042 },
      { slug: "northstar-heating-cooling", number: 1001 },
    ]);
  });

  test("JB-204 is Sarah Mitchell's completed AC Repair & Diagnostics job, linked to BK-1042", async () => {
    const { rows } = await admin.query(
      `select j.number, j.status, b.number as booking, c.name as customer, s.name as service, p.address_line1 as street, j.completion_notes is not null as has_notes, j.completed_at is not null as has_time
         from jobs j join bookings b on b.id = j.booking_id join customers c on c.id = j.customer_id
         join services s on s.id = j.service_id join customer_properties p on p.id = j.property_id
        where j.organization_id = $1 and j.number = 204`,
      [apex],
    );
    expect(rows).toEqual([{ number: 204, status: "completed", booking: 1042, customer: "Sarah Mitchell", service: "AC Repair & Diagnostics", street: "1402 Kinney Ave", has_notes: true, has_time: true }]);
  });

  test("file metadata is stored but file contents are not: no storage key anywhere", async () => {
    // Every business, test copies included: no file content is stored anywhere, and the standing Apex has its four records.
    const { rows } = await admin.query("select count(*)::int as n, count(storage_key)::int as stored from job_files");
    expect(rows[0].stored).toBe(0);
    expect((await admin.query("select count(*)::int as n from job_files where organization_id = $1", [apex])).rows[0].n).toBe(4);
  });

  test("numbering starts above the seeded records", async () => {
    const { rows } = await admin.query<{ slug: string; kind: string; next_value: number }>(
      `select o.slug, s.kind, s.next_value from organization_sequences s join organizations o on o.id = s.organization_id
        where o.slug in ('apex-climate-heating-air', 'northstar-heating-cooling') order by o.slug, s.kind`,
    );
    expect(rows).toEqual([
      { slug: "apex-climate-heating-air", kind: "booking", next_value: 1043 },
      { slug: "apex-climate-heating-air", kind: "job", next_value: 205 },
      { slug: "northstar-heating-cooling", kind: "booking", next_value: 1003 },
      { slug: "northstar-heating-cooling", kind: "job", next_value: 1002 },
    ]);
  });
});

test.describe("the structure", () => {
  test("every operational table has Row Level Security enabled and carries an organization_id", async () => {
    const rls = await admin.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname = any($1) order by relname",
      [OPERATIONAL],
    );
    expect(rls.rows).toHaveLength(OPERATIONAL.length);
    for (const row of rls.rows) expect(row.relrowsecurity, row.relname).toBe(true);
    const columns = await admin.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and is_nullable = 'NO' and table_name = any($1)",
      [OPERATIONAL],
    );
    expect(columns.rows.map((row) => row.table_name).sort()).toEqual([...OPERATIONAL].sort());
  });

  test("the runtime role cannot delete a booking or a job, or anything else operational", async () => {
    const { rows } = await admin.query<{ table_name: string; privilege_type: string }>(
      "select table_name, privilege_type from information_schema.role_table_grants where grantee = 'climvia_app' and table_name = any($1) and privilege_type in ('DELETE', 'TRUNCATE')",
      [OPERATIONAL],
    );
    expect(rows).toEqual([]);
  });

  test("a customer, property, service and team member can only be pointed at through the business's own composite key", async () => {
    const { rows } = await admin.query<{ conname: string }>(
      "select conname from pg_constraint where contype = 'f' and conrelid in ('bookings'::regclass, 'jobs'::regclass) order by conname",
    );
    const names = rows.map((row) => row.conname);
    for (const expected of [
      "bookings_customer_fk",
      "bookings_property_fk",
      "bookings_service_fk",
      "bookings_assignee_fk",
      "jobs_booking_fk",
      "jobs_customer_fk",
      "jobs_property_fk",
      "jobs_service_fk",
      "jobs_assignee_fk",
      "jobs_equipment_fk",
    ]) {
      expect(names, expected).toContain(expected);
    }
    // Each of them spans (organization_id, id): a reference alone could point into another business.
    const spans = await admin.query<{ conname: string; columns: number }>(
      "select conname, cardinality(conkey) as columns from pg_constraint where conname = any($1) order by conname",
      [["bookings_customer_fk", "bookings_service_fk", "bookings_assignee_fk", "jobs_booking_fk"]],
    );
    for (const row of spans.rows) expect(row.columns, row.conname).toBe(2);
  });
});

test.describe("reading (SELECT)", () => {
  test("with no context nothing is visible, in any operational table", async () => {
    const result = await as(null, null, async (client) => Object.fromEntries(await Promise.all(OPERATIONAL.map(async (table) => [table, await count(client, table)]))));
    expect(result.value).toEqual(Object.fromEntries(OPERATIONAL.map((table) => [table, 0])));
  });

  test("the Apex owner sees Apex's operations and none of Northstar's", async () => {
    const result = await as(user.alex, apex, async (client) => ({
      bookings: await count(client, "bookings"),
      jobs: await count(client, "jobs"),
      files: await count(client, "job_files"),
      blocks: await count(client, "schedule_blocks"),
      blockMembers: await count(client, "schedule_block_members"),
      sequences: await count(client, "organization_sequences"),
      foreign: (await client.query("select 1 from bookings where organization_id = $1", [northstar])).rowCount,
    }));
    expect(result.value).toEqual({ bookings: 13, jobs: 11, files: 4, blocks: 2, blockMembers: 4, sequences: 2, foreign: 0 });
  });

  test("the Northstar owner sees Northstar's operations and none of Apex's", async () => {
    const result = await as(user.taylor, northstar, async (client) => ({
      bookings: await count(client, "bookings"),
      jobs: await count(client, "jobs"),
      files: await count(client, "job_files"),
      numbers: (await client.query<{ number: number }>("select number from bookings order by number")).rows.map((row) => row.number),
      sarah: (await client.query("select 1 from customers where name = 'Sarah Mitchell'")).rowCount,
    }));
    expect(result.value).toEqual({ bookings: 2, jobs: 1, files: 0, numbers: [1001, 1002], sarah: 0 });
  });

  test("pointing the context at a business you are not in returns none of its rows", async () => {
    const alexAtNorthstar = await as(user.alex, northstar, async (client) => ({ bookings: await count(client, "bookings"), jobs: await count(client, "jobs") }));
    expect(alexAtNorthstar.value).toEqual({ bookings: 0, jobs: 0 });
    const taylorAtApex = await as(user.taylor, apex, async (client) => ({ bookings: await count(client, "bookings"), jobs: await count(client, "jobs"), files: await count(client, "job_files") }));
    expect(taylorAtApex.value).toEqual({ bookings: 0, jobs: 0, files: 0 });
  });

  test("a member can read the business's operations (they cannot change them, below)", async () => {
    const result = await as(user.jamie, apex, async (client) => ({ bookings: await count(client, "bookings"), jobs: await count(client, "jobs") }));
    expect(result.value).toEqual({ bookings: 13, jobs: 11 });
  });

  test("someone in both businesses sees only the active one at a time", async () => {
    const atApex = await as(user.casey, apex, (client) => count(client, "bookings"));
    const atNorthstar = await as(user.casey, northstar, (client) => count(client, "bookings"));
    expect([atApex.value, atNorthstar.value]).toEqual([13, 2]);
  });

  test("a booking id from another business cannot be read by naming it", async () => {
    const northstarBooking = (await admin.query<{ id: string }>("select id from bookings where organization_id = $1 limit 1", [northstar])).rows[0].id;
    const result = await as(user.alex, apex, async (client) => (await client.query("select * from bookings where id = $1", [northstarBooking])).rowCount);
    expect(result.value).toBe(0);
  });
});

test.describe("writing (INSERT)", () => {
  test("an owner or admin of the active business can create a booking and a job", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const id = await insertBooking(client, apex, { customer_id: apexId.sarah, contact_name: null, property_id: apexId.sarahHome });
      const job = await insertJob(client, apex, { booking_id: id, customer_id: apexId.sarah, contact_name: null, property_id: apexId.sarahHome });
      return { id, job };
    });
    expect(result.error).toBeUndefined();
    const admin2 = await as(user.casey, northstar, async (client) => insertBooking(client, northstar, { number: 9002 }));
    expect(admin2.error).toBeUndefined();
  });

  test("a member cannot create a booking or a job", async () => {
    const booking = await as(user.jamie, apex, (client) => insertBooking(client, apex));
    expect(booking.error).toMatch(/row-level security/i);
    const job = await as(user.jamie, apex, (client) => insertJob(client, apex));
    expect(job.error).toMatch(/row-level security/i);
  });

  test("with no context, or as someone who is not in the business, nothing can be created", async () => {
    expect((await as(null, null, (client) => insertBooking(client, apex))).error).toMatch(/row-level security/i);
    expect((await as(user.taylor, apex, (client) => insertBooking(client, apex))).error).toMatch(/row-level security/i);
    expect((await as(user.taylor, northstar, (client) => insertBooking(client, apex))).error).toMatch(/row-level security/i);
    expect((await as(user.alex, apex, (client) => insertBooking(client, northstar))).error).toMatch(/row-level security/i);
    expect((await as(user.alex, apex, (client) => insertJob(client, northstar))).error).toMatch(/row-level security/i);
  });

  test("a number is unique within a business: BK-1042 cannot be created twice, but another business may hold it", async () => {
    const twice = await as(user.alex, apex, (client) => insertBooking(client, apex, { number: 1042 }));
    expect(twice.error).toMatch(/bookings_org_number_unique/);
    const other = await as(user.taylor, northstar, (client) => insertBooking(client, northstar, { number: 1042 }));
    expect(other.error).toBeUndefined();
  });

  test("a booking is for a customer or a name, a finished time, a known status and source", async () => {
    const bad: [string, Record<string, unknown>][] = [
      ["both a customer and a name", { customer_id: apexId.sarah, contact_name: "Someone" }],
      ["neither a customer nor a name", { contact_name: null }],
      ["an end before its start", { start_time: "10:00", end_time: "09:00" }],
      ["a status nobody defined", { status: "en-route" }],
      ["a source nobody defined", { source: "Telepathy" }],
      ["a cancellation without a reason", { status: "cancelled" }],
      ["a property without a customer", { property_id: apexId.sarahHome }],
    ];
    for (const [label, values] of bad) {
      const result = await as(user.alex, apex, (client) => insertBooking(client, apex, values));
      expect(result.error, label).toBeTruthy();
      expect(result.code, label).toBe("23514");
    }
  });

  test("a job is for a customer or a name, and is Completed only with its notes and time", async () => {
    expect((await as(user.alex, apex, (client) => insertJob(client, apex, { status: "completed" }))).code).toBe("23514");
    expect((await as(user.alex, apex, (client) => insertJob(client, apex, { status: "scheduled", completion_notes: "x" }))).code).toBe("23514");
    expect((await as(user.alex, apex, (client) => insertJob(client, apex, { status: "waiting-parts" }))).code).toBe("23514");
  });

  test("nothing can be added to a job's files through the application role", async () => {
    const jb204 = (await admin.query<{ id: string }>("select id from jobs where organization_id = $1 and number = 204", [apex])).rows[0].id;
    const result = await as(user.alex, apex, (client) =>
      client.query("insert into job_files (organization_id, job_id, ref, name, size_kb, visibility) values ($1, $2, 'x', 'x.jpg', 1, 'internal')", [apex, jb204]),
    );
    expect(result.error).toMatch(/permission denied/i);
  });
});

test.describe("writing (UPDATE)", () => {
  test("an owner can confirm and assign a booking; the change is stored", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const id = await bookingId(client, 1040);
      const update = await client.query("update bookings set status = 'confirmed', confirmed_at = now(), assignee_id = $2 where id = $1", [id, apexId.marcus]);
      const row = (await client.query<{ status: string; assignee_id: string }>("select status, assignee_id from bookings where id = $1", [id])).rows[0];
      return { updated: update.rowCount, status: row.status, assigned: row.assignee_id === apexId.marcus };
    });
    expect(result.value).toEqual({ updated: 1, status: "confirmed", assigned: true });
  });

  test("a member, another business's owner, and no context change nothing (zero rows, no error)", async () => {
    const attempts: [string | null, string | null][] = [
      [user.jamie, apex],
      [user.taylor, apex],
      [user.taylor, northstar],
      [null, null],
    ];
    for (const [who, org] of attempts) {
      const result = await as(who, org, async (client) => (await client.query("update bookings set assignee_id = null where number = 1041 and organization_id = $1", [apex])).rowCount);
      expect(result.value, `${who} @ ${org}`).toBe(0);
    }
    const stillAssigned = (await admin.query("select count(*)::int as n from bookings where organization_id = $1 and number = 1041 and assignee_id is null", [apex])).rows[0].n;
    expect(stillAssigned).toBe(1);
  });

  test("the runtime role can change only the columns a screen changes", async () => {
    const forbidden = ["service_date = '2030-01-01'", "number = 5000", "customer_id = null", "contact_name = 'x'", "source = 'Other'", "organization_id = gen_random_uuid()", "start_time = '07:00'"];
    for (const assignment of forbidden) {
      const result = await as(user.alex, apex, (client) => client.query(`update bookings set ${assignment} where number = 1041`));
      expect(result.error, assignment).toMatch(/permission denied|violates/i);
    }
    const forbiddenJob = ["service_date = '2030-01-01'", "number = 5000", "booking_id = null", "equipment_id = null", "organization_id = gen_random_uuid()"];
    for (const assignment of forbiddenJob) {
      const result = await as(user.alex, apex, (client) => client.query(`update jobs set ${assignment} where number = 201`));
      expect(result.error, assignment).toMatch(/permission denied|violates/i);
    }
  });

  test("a booking moves only forward: pending to confirmed or cancelled, confirmed to completed or cancelled; final is final", async () => {
    const pendingToCompleted = await as(user.alex, apex, (client) => client.query("update bookings set status = 'completed' where number = 1040"));
    expect(pendingToCompleted.error).toMatch(/cannot become completed/);
    const completedBack = await as(user.alex, apex, (client) => client.query("update bookings set status = 'confirmed' where number = 1042"));
    expect(completedBack.error).toMatch(/is final/);
    const completedReassigned = await as(user.alex, apex, (client) => client.query("update bookings set assignee_id = null where number = 1042"));
    expect(completedReassigned.error).toMatch(/is final/);
    const cancelWithJob = await as(user.alex, apex, (client) => client.query("update bookings set status = 'cancelled', cancellation_reason = 'x' where number = 1039"));
    expect(cancelWithJob.error).toMatch(/already has a job/);
  });

  test("a job moves only forward: scheduled, in progress, completed; a completed job is never rewritten", async () => {
    const skipped = await as(user.alex, apex, (client) =>
      client.query("update jobs set status = 'completed', completion_notes = 'x', completed_at = now() where number = 201"),
    );
    expect(skipped.error).toMatch(/cannot become completed/);
    const completedBack = await as(user.alex, apex, (client) => client.query("update jobs set status = 'scheduled', completion_notes = null, completed_at = null where number = 204"));
    expect(completedBack.error).toMatch(/is final/);
    const notesRewritten = await as(user.alex, apex, (client) => client.query("update jobs set internal_notes = 'changed' where number = 204"));
    expect(notesRewritten.error).toMatch(/is final/);
    const completesInOneStep = await as(user.alex, apex, async (client) => {
      await client.query("update jobs set status = 'in-progress' where number = 201");
      return (await client.query("update jobs set status = 'completed', completion_notes = 'Done.', completed_at = now(), technician_diagnosis = 'ok' where number = 201")).rowCount;
    });
    expect(completesInOneStep.value).toBe(1);
  });

  test("a file's visibility is the only thing about it that changes, and only an owner or admin of its business changes it", async () => {
    const owner = await as(user.alex, apex, async (client) => (await client.query("update job_files set visibility = 'internal' where ref is not null")).rowCount);
    expect(owner.value).toBe(4);
    const member = await as(user.jamie, apex, async (client) => (await client.query("update job_files set visibility = 'internal'")).rowCount);
    expect(member.value).toBe(0);
    const stranger = await as(user.taylor, northstar, async (client) => (await client.query("update job_files set visibility = 'internal'")).rowCount);
    expect(stranger.value).toBe(0);
    const rename = await as(user.alex, apex, (client) => client.query("update job_files set name = 'other.jpg'"));
    expect(rename.error).toMatch(/permission denied/i);
  });

  test("updated_at moves when a record changes", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const before = (await client.query<{ updated_at: Date }>("select updated_at from bookings where number = 1041")).rows[0].updated_at;
      await client.query("select pg_sleep(0.05)");
      await client.query("update bookings set assignee_id = $1 where number = 1041", [apexId.marcus]);
      const after = (await client.query<{ updated_at: Date; moved: boolean }>("select updated_at, updated_at > $1 as moved from bookings where number = 1041", [before])).rows[0];
      return after.moved;
    });
    expect(result.value).toBe(true);
  });
});

test.describe("deleting (DELETE)", () => {
  test("no one deletes a booking, a job, a file, a block or a counter: not an owner, not an admin, not anyone", async () => {
    for (const table of OPERATIONAL) {
      for (const [who, org] of [[user.alex, apex], [user.casey, apex], [user.taylor, northstar], [user.jamie, apex], [null, null]] as const) {
        const result = await as(who, org, (client) => client.query(`delete from ${table}`));
        expect(result.error, `${table} as ${who}`).toMatch(/permission denied/i);
      }
    }
    const left = await admin.query("select (select count(*)::int from bookings) as bookings, (select count(*)::int from jobs) as jobs");
    expect(left.rows[0]).toEqual({ bookings: expect.any(Number), jobs: expect.any(Number) });
    expect(left.rows[0].bookings).toBeGreaterThanOrEqual(15);
  });
});

test.describe("relations across businesses are impossible", () => {
  test("an Apex booking cannot point at a Northstar customer, service or team member", async () => {
    const customer = await as(user.alex, apex, (client) => insertBooking(client, apex, { customer_id: northstarId.marta, contact_name: null }));
    expect(customer.error).toMatch(/bookings_customer_fk/);
    const service = await as(user.alex, apex, (client) => insertBooking(client, apex, { service_id: northstarId.tuneUp }));
    expect(service.error).toMatch(/bookings_service_fk/);
    const member = await as(user.alex, apex, (client) => insertBooking(client, apex, { assignee_id: northstarId.jordan }));
    expect(member.error).toMatch(/bookings_assignee_fk/);
  });

  test("a Northstar booking cannot point at an Apex customer, service or team member", async () => {
    const customer = await as(user.taylor, northstar, (client) => insertBooking(client, northstar, { customer_id: apexId.sarah, contact_name: null }));
    expect(customer.error).toMatch(/bookings_customer_fk/);
    const service = await as(user.taylor, northstar, (client) => insertBooking(client, northstar, { service_id: apexId.cooling }));
    expect(service.error).toMatch(/bookings_service_fk/);
    const member = await as(user.taylor, northstar, (client) => insertBooking(client, northstar, { assignee_id: apexId.marcus }));
    expect(member.error).toMatch(/bookings_assignee_fk/);
  });

  test("a job cannot point at another business's service, team member, customer or booking", async () => {
    const service = await as(user.taylor, northstar, (client) => insertJob(client, northstar, { service_id: apexId.cooling }));
    expect(service.error).toMatch(/jobs_service_fk/);
    const member = await as(user.alex, apex, (client) => insertJob(client, apex, { assignee_id: northstarId.jordan }));
    expect(member.error).toMatch(/jobs_assignee_fk/);
    const customer = await as(user.alex, apex, (client) => insertJob(client, apex, { customer_id: northstarId.marta, contact_name: null }));
    expect(customer.error).toMatch(/jobs_customer_fk/);
    const northstarBooking = (await admin.query<{ id: string }>("select id from bookings where organization_id = $1 and number = 1001", [northstar])).rows[0].id;
    const booking = await as(user.alex, apex, (client) => insertJob(client, apex, { booking_id: northstarBooking }));
    expect(booking.error).toMatch(/jobs_booking_fk/);
  });

  test("a booking's property must be that customer's own property", async () => {
    const wrongCustomer = await as(user.alex, apex, (client) => insertBooking(client, apex, { customer_id: apexId.david, contact_name: null, property_id: apexId.sarahHome }));
    expect(wrongCustomer.error).toMatch(/bookings_property_fk/);
    const right = await as(user.alex, apex, (client) => insertBooking(client, apex, { customer_id: apexId.david, contact_name: null, property_id: apexId.davidHome }));
    expect(right.error).toBeUndefined();
  });

  test("a booking has at most one job: a second job for BK-1042 is refused", async () => {
    const result = await as(user.alex, apex, async (client) => insertJob(client, apex, { booking_id: await bookingId(client, 1042), customer_id: apexId.sarah, contact_name: null }));
    expect(result.error).toMatch(/jobs_org_booking_unique/);
    // Jobs with no booking (historical visits) are not constrained against each other.
    const noBooking = await as(user.alex, apex, async (client) => {
      await insertJob(client, apex, { number: 9100 });
      await insertJob(client, apex, { number: 9101 });
      return true;
    });
    expect(noBooking.value).toBe(true);
  });

  test("a job's booking is its own booking: it cannot be moved to another by an update either", async () => {
    const result = await as(user.alex, apex, (client) => client.query("update jobs set booking_id = (select id from bookings where number = 1041) where number = 201"));
    expect(result.error).toMatch(/permission denied/i);
  });
});

test.describe("numbering", () => {
  test("app_next_number gives the next number of the ACTIVE business, and a rollback gives it back", async () => {
    const first = await as(user.alex, apex, async (client) => [
      (await client.query<{ n: number }>("select app_next_number('booking') as n")).rows[0].n,
      (await client.query<{ n: number }>("select app_next_number('booking') as n")).rows[0].n,
      (await client.query<{ n: number }>("select app_next_number('job') as n")).rows[0].n,
    ]);
    expect(first.value).toEqual([1043, 1044, 205]);
    // That transaction was rolled back: the counter did not move.
    const again = await as(user.alex, apex, async (client) => (await client.query<{ n: number }>("select app_next_number('booking') as n")).rows[0].n);
    expect(again.value).toBe(1043);
    const northstarNext = await as(user.taylor, northstar, async (client) => (await client.query<{ n: number }>("select app_next_number('booking') as n")).rows[0].n);
    expect(northstarNext.value).toBe(1003);
  });

  test("it cannot be used across businesses, by a member, with no context, or for a made-up kind", async () => {
    const crossing = await as(user.alex, northstar, (client) => client.query("select app_next_number('booking')"));
    expect(crossing.error).toMatch(/Not allowed/);
    const taylorAtApex = await as(user.taylor, apex, (client) => client.query("select app_next_number('booking')"));
    expect(taylorAtApex.error).toMatch(/Not allowed/);
    const member = await as(user.jamie, apex, (client) => client.query("select app_next_number('booking')"));
    expect(member.error).toMatch(/Not allowed/);
    const nobody = await as(null, null, (client) => client.query("select app_next_number('booking')"));
    expect(nobody.error).toMatch(/Not allowed/);
    const madeUp = await as(user.alex, apex, (client) => client.query("select app_next_number('invoice')"));
    expect(madeUp.error).toMatch(/organization_sequences_kind/);
  });

  test("the counters cannot be written directly, so one business cannot move another's", async () => {
    for (const statement of [
      "update organization_sequences set next_value = 1",
      "insert into organization_sequences (organization_id, kind, next_value) values (gen_random_uuid(), 'booking', 1)",
    ]) {
      const result = await as(user.alex, apex, (client) => client.query(statement));
      expect(result.error, statement).toMatch(/permission denied/i);
    }
  });

  test("two new businesses each start at 1001, and concurrent requests in one business are never given the same number", async () => {
    const { userId, organizations } = await newBusinesses("numbering", 2);
    const [a, b] = organizations;

    const take = async (org: string, kind = "booking") => {
      const client = await app.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId, org]);
        const n = (await client.query<{ n: number }>("select app_next_number($1) as n", [kind])).rows[0].n;
        await client.query("select pg_sleep(0.02)");
        await client.query("commit");
        return n;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };

    // Both businesses begin at 1001: a number belongs to its business, not to the product.
    const firsts = await Promise.all([take(a), take(b)]);
    expect(firsts).toEqual([1001, 1001]);

    // Sixteen requests at once in A, with B taking numbers at the same time: no duplicates, no gaps, no crosstalk.
    const results = await Promise.all([...Array.from({ length: 16 }, () => take(a)), ...Array.from({ length: 5 }, () => take(b)), take(a, "job")]);
    expect(results.slice(0, 16).sort((x, y) => x - y)).toEqual(Array.from({ length: 16 }, (_, index) => 1002 + index));
    expect(results.slice(16, 21).sort((x, y) => x - y)).toEqual([1002, 1003, 1004, 1005, 1006]);
    expect(results[21]).toBe(1001);
  });

  test("the number held for Sarah's plan visit is held in the sample business only; another business uses every number", async () => {
    const { userId, organizations } = await newBusinesses("held-number", 2);
    const [plain, sample] = organizations;
    for (const org of organizations) await admin.query("insert into organization_sequences (organization_id, kind, next_value) values ($1, 'booking', 1047)", [org]);
    const take = (org: string, reserved: Readonly<Record<string, number>>, planVisitId?: string) =>
      withTenant({ userId, organizationId: org }, (tx) => allocateBookingNumber(tx, org, reserved, planVisitId));
    // Another business holds nothing back: 1047, then 1048.
    expect([await take(plain, {}), await take(plain, {})]).toEqual([1047, 1048]);
    // The sample business holds 1048 for the visit: the visit takes it, ordinary bookings walk past it.
    expect(await take(sample, RESERVED_BOOKING_NUMBERS, "plan-sarah-comfort-care-v2")).toBe(1048);
    expect([await take(sample, RESERVED_BOOKING_NUMBERS), await take(sample, RESERVED_BOOKING_NUMBERS)]).toEqual([1047, 1049]);
  });

  test("two requests creating a job for the same booking at once: exactly one succeeds", async () => {
    const { userId, organizations } = await newBusinesses("duplicate-job", 1);
    const [org] = organizations;
    const { pool, db } = adminDb();
    let service = "";
    let booking = "";
    try {
      await db.transaction((tx) => insertServices(tx as never, org, [SERVICES[0]]));
      service = (await admin.query<{ id: string }>("select id from services where organization_id = $1", [org])).rows[0].id;
      booking = (
        await admin.query<{ id: string }>(
          `insert into bookings (organization_id, number, contact_name, service_id, source, status, service_date, start_time, end_time, received_at)
           values ($1, 1001, 'Pat', $2, 'Other', 'confirmed', '2030-01-07', '09:00', '10:00', now()) returning id`,
          [org, service],
        )
      ).rows[0].id;
    } finally {
      await pool.end();
    }

    const createJob = async (number: number) => {
      const client = await app.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId, org]);
        await client.query("select id from bookings where id = $1 for update", [booking]);
        await client.query("select pg_sleep(0.05)");
        await client.query(
          "insert into jobs (organization_id, number, booking_id, contact_name, service_id, status, service_date, start_time, end_time) values ($1, $2, $3, 'Pat', $4, 'scheduled', '2030-01-07', '09:00', '10:00')",
          [org, number, booking, service],
        );
        await client.query("commit");
        return "created";
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return (error as { constraint?: string }).constraint ?? String(error);
      } finally {
        client.release();
      }
    };
    const outcomes = await Promise.all([createJob(1001), createJob(1002), createJob(1003)]);
    expect(outcomes.filter((outcome) => outcome === "created")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "jobs_org_booking_unique")).toHaveLength(2);
    expect((await admin.query("select count(*)::int as n from jobs where organization_id = $1", [org])).rows[0].n).toBe(1);
  });
});
