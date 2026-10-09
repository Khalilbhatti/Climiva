/**
 * The seed and the application's database layer agree for the operations too: what the seed wrote is what the application reads
 * back, field for field, the sample records keep the same database identity every time the database is rebuilt, and seeding
 * again changes nothing.
 *
 * These read through the restricted runtime role under the tenant context (the way a page does).
 */
import { test, expect } from "playwright/test";
import { Pool } from "pg";
import type { Booking, Job } from "../src/data/operations";
import { loadOperations } from "../src/db/ops-queries";
import { stableId } from "../src/db/stable-id";
import { withTenant } from "../src/db/tenant";
import { numberOf } from "../src/lib/operations-rules";
import { seedDevelopmentData } from "../scripts/db/seed-lib";
import { NORTHSTAR_OPERATIONS } from "../scripts/db/seed-data/northstar";
import { BOOKINGS, JOBS, OPERATIONS, SCHEDULE_BLOCKS } from "./apex-data";

let admin: Pool;
const ids = { apex: "", northstar: "", alex: "", taylor: "" };

test.beforeAll(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  const one = async (sql: string) => (await admin.query<{ id: string }>(sql)).rows[0].id;
  ids.apex = await one("select id from organizations where slug = 'apex-climate-heating-air'");
  ids.northstar = await one("select id from organizations where slug = 'northstar-heating-cooling'");
  ids.alex = await one("select id from auth_user where email = 'alex.morgan@apex.test'");
  ids.taylor = await one("select id from auth_user where email = 'taylor.brooks@northstar.test'");
});

test.afterAll(async () => {
  await admin.end();
});

const byBooking = (a: Booking, b: Booking) => (numberOf("BK", a.id) ?? 0) - (numberOf("BK", b.id) ?? 0);
const byJob = (a: Job, b: Job) => (numberOf("JB", a.id) ?? 0) - (numberOf("JB", b.id) ?? 0);

test.describe("what was seeded is what is read", () => {
  test("Apex: bookings, jobs, files and blocks come back exactly as seeded", async () => {
    const operations = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadOperations(tx, ids.apex, "America/Chicago"));
    expect([...operations.bookings].sort(byBooking)).toEqual([...BOOKINGS].sort(byBooking));
    expect([...operations.jobs].sort(byJob)).toEqual([...JOBS].sort(byJob));
    expect(operations.blocks).toEqual(SCHEDULE_BLOCKS);
    expect(operations.jobs.find((job) => job.id === "JB-204")?.files).toHaveLength(4);
  });

  test("Northstar: its own, smaller set comes back exactly as seeded", async () => {
    const operations = await withTenant({ userId: ids.taylor, organizationId: ids.northstar }, (tx) => loadOperations(tx, ids.northstar, "America/Denver"));
    // A booking that schedules a maintenance plan visit says so (BK-1001 here, BK-1048 in Apex): the link lives on the plan's visit and is read from there.
    expect([...operations.bookings].sort(byBooking)).toEqual([...NORTHSTAR_OPERATIONS.bookings].sort(byBooking));
    expect([...operations.jobs].sort(byJob)).toEqual([...NORTHSTAR_OPERATIONS.jobs].sort(byJob));
    expect(operations.blocks).toEqual([]);
  });

  test("an organization sees none of another's operations through the same function", async () => {
    const crossed = await withTenant({ userId: ids.taylor, organizationId: ids.apex }, (tx) => loadOperations(tx, ids.apex, "America/Chicago"));
    expect(crossed).toEqual({ bookings: [], jobs: [], blocks: [] });
  });
});

test.describe("identity and repeatability", () => {
  test("the sample records have deterministic ids, so a rebuilt database gives the same ones", async () => {
    const { rows } = await admin.query<{ id: string; number: number }>("select id, number from bookings where organization_id = $1 and number in (1042, 1040)", [ids.apex]);
    for (const row of rows) expect(row.id).toBe(stableId(ids.apex, "booking", `BK-${row.number}`));
    const job = await admin.query<{ id: string }>("select id from jobs where organization_id = $1 and number = 204", [ids.apex]);
    expect(job.rows[0].id).toBe(stableId(ids.apex, "job", "JB-204"));
    // The same reference in another business is a different record.
    expect(stableId(ids.northstar, "booking", "BK-1001")).not.toBe(stableId(ids.apex, "booking", "BK-1001"));
  });

  test("seeding again changes nothing: the same rows, the same counters", async () => {
    const snapshot = async () =>
      (
        await admin.query(
          `select (select count(*)::int from bookings) as bookings, (select count(*)::int from jobs) as jobs, (select count(*)::int from job_files) as files,
                  (select count(*)::int from schedule_blocks) as blocks,
                  (select string_agg(organization_id::text || kind || next_value, ',' order by organization_id, kind) from organization_sequences where organization_id in ($1, $2)) as counters,
                  (select max(updated_at)::text from bookings where organization_id in ($1, $2)) as booking_updated`,
          [ids.apex, ids.northstar],
        )
      ).rows[0];
    const before = await snapshot();
    await seedDevelopmentData();
    expect(await snapshot()).toEqual(before);
    expect(OPERATIONS.bookings.length).toBeGreaterThan(0);
  });
});
