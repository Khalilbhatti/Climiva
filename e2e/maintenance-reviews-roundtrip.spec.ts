/**
 * The seed and the application's database layer agree for maintenance plans and reviews too: what the seed wrote is what the
 * application reads back, field for field (terms, coverage, visits, replies, requests), the sample records keep the same database
 * identity every time the database is rebuilt, and seeding again changes nothing: no duplicate plan, visit, review, reply or
 * request, no moved timestamp.
 *
 * These read through the restricted runtime role under the tenant context (the way a page does).
 */
import { test, expect } from "playwright/test";
import { Pool } from "pg";
import type { MaintenancePlan } from "../src/data/maintenance-plans";
import type { Review } from "../src/data/reviews";
import { loadMaintenance } from "../src/db/maint-queries";
import { loadReviews } from "../src/db/review-queries";
import { stableId } from "../src/db/stable-id";
import { withTenant } from "../src/db/tenant";
import { seedDevelopmentData } from "../scripts/db/seed-lib";
import { NORTHSTAR_MAINTENANCE, NORTHSTAR_REVIEWS } from "../scripts/db/seed-data/northstar";
import { PLANS, REVIEWS, REVIEWS_DATA } from "./apex-data";

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

const byId = <T extends { id: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => a.id.localeCompare(b.id));
/** A seed visit also carries the booking that schedules it; the application derives that from the bookings, so it is not part of a plan as read. */
const asRead = (plans: readonly (Omit<MaintenancePlan, "visits"> & { visits: readonly (MaintenancePlan["visits"][number] & { bookingId?: string })[] })[]): MaintenancePlan[] =>
  plans.map((plan) => ({ ...plan, visits: plan.visits.map((visit) => {
      const copy: Record<string, unknown> = { ...visit };
      delete copy.bookingId;
      return copy as MaintenancePlan["visits"][number];
    }) }));

test.describe("what was seeded is what is read", () => {
  test("Apex: the six plans come back exactly as seeded, with their coverage and visits", async () => {
    const read = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadMaintenance(tx, ids.apex));
    expect(byId(read.plans)).toEqual(byId(asRead(PLANS)));
  });

  test("Northstar: its own plan comes back exactly as seeded", async () => {
    const read = await withTenant({ userId: ids.taylor, organizationId: ids.northstar }, (tx) => loadMaintenance(tx, ids.northstar));
    expect(byId(read.plans)).toEqual(byId(asRead(NORTHSTAR_MAINTENANCE.plans)));
  });

  test("Apex: the four reviews and their replies come back exactly as seeded, newest first, with no request", async () => {
    const read = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadReviews(tx, ids.apex, "America/Chicago"));
    expect(read.reviews.map((review) => review.id)).toEqual(REVIEWS.map((review) => review.id));
    expect(byId<Review>(read.reviews)).toEqual(byId(REVIEWS_DATA.reviews));
    expect(read.requests).toEqual(REVIEWS_DATA.requests);
  });

  test("Northstar: its own reviews, reply and request come back exactly as seeded, in its own time zone", async () => {
    const read = await withTenant({ userId: ids.taylor, organizationId: ids.northstar }, (tx) => loadReviews(tx, ids.northstar, "America/Denver"));
    expect(byId<Review>(read.reviews)).toEqual(byId(NORTHSTAR_REVIEWS.reviews));
    expect(read.requests).toEqual(NORTHSTAR_REVIEWS.requests);
  });

  test("an organization sees none of another's plans, reviews or requests through the same functions", async () => {
    const crossed = await withTenant({ userId: ids.taylor, organizationId: ids.apex }, async (tx) => ({
      plans: await loadMaintenance(tx, ids.apex),
      reviews: await loadReviews(tx, ids.apex, "America/Chicago"),
    }));
    expect(crossed).toEqual({ plans: { plans: [] }, reviews: { reviews: [], requests: [] } });
    const other = await withTenant({ userId: ids.alex, organizationId: ids.northstar }, async (tx) => ({
      plans: await loadMaintenance(tx, ids.northstar),
      reviews: await loadReviews(tx, ids.northstar, "America/Denver"),
    }));
    expect(other).toEqual({ plans: { plans: [] }, reviews: { reviews: [], requests: [] } });
  });

  test("a reply is read in the business's own time zone: Marcus Sterling's was posted on Oct 20 in Austin", async () => {
    const chicago = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadReviews(tx, ids.apex, "America/Chicago"));
    expect(chicago.reviews.find((review) => review.id === "rev-marcus-sterling")!.response!.at).toBe("2024-10-20T09:30");
    // The same stored instant, read in a zone far away, lands on another wall clock: the time is a function of the zone, the review's date never moves.
    const tokyo = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadReviews(tx, ids.apex, "Asia/Tokyo"));
    expect(tokyo.reviews.find((review) => review.id === "rev-marcus-sterling")!.response!.at).not.toBe("2024-10-20T09:30");
    expect(tokyo.reviews.find((review) => review.id === "rev-marcus-sterling")!.date).toBe("2024-10-19");
  });
});

test.describe("identity and repeatability", () => {
  test("the sample records have deterministic ids, so a rebuilt database gives the same ones", async () => {
    const plan = await admin.query<{ id: string }>("select id from maintenance_plans where organization_id = $1 and slug = 'plan-sarah-comfort-care'", [ids.apex]);
    expect(plan.rows[0].id).toBe(stableId(ids.apex, "plan", "plan-sarah-comfort-care"));
    const visit = await admin.query<{ id: string }>("select id from maintenance_plan_visits where organization_id = $1 and ref = 'plan-sarah-comfort-care-v2'", [ids.apex]);
    expect(visit.rows[0].id).toBe(stableId(ids.apex, "plan-visit", "plan-sarah-comfort-care-v2"));
    const review = await admin.query<{ id: string }>("select id from reviews where organization_id = $1 and slug = 'rev-sarah-mitchell'", [ids.apex]);
    expect(review.rows[0].id).toBe(stableId(ids.apex, "review", "rev-sarah-mitchell"));
    // The same reference in another business is a different record.
    expect(stableId(ids.northstar, "review", "rev-sarah-mitchell")).not.toBe(stableId(ids.apex, "review", "rev-sarah-mitchell"));
  });

  test("seeding again changes nothing: the same rows, the same timestamps", async () => {
    const snapshot = async () =>
      (
        await admin.query(
          `select (select count(*)::int from maintenance_plans) as plans, (select count(*)::int from maintenance_plan_coverage) as coverage,
                  (select count(*)::int from maintenance_plan_visits) as visits, (select count(*)::int from reviews) as reviews,
                  (select count(*)::int from review_replies) as replies, (select count(*)::int from review_requests) as requests,
                  (select count(*)::int from bookings where organization_id in ($1, $2)) as bookings,
                  (select max(updated_at)::text from maintenance_plans where organization_id in ($1, $2)) as plan_updated,
                  (select max(updated_at)::text from maintenance_plan_visits where organization_id in ($1, $2)) as visit_updated,
                  (select max(updated_at)::text from review_replies where organization_id in ($1, $2)) as reply_updated,
                  (select string_agg(ref || ':' || status || ':' || coalesce(booking_id::text, ''), ',' order by ref) from maintenance_plan_visits where organization_id in ($1, $2)) as visit_states`,
          [ids.apex, ids.northstar],
        )
      ).rows[0];
    const before = await snapshot();
    await seedDevelopmentData();
    expect(await snapshot()).toEqual(before);
  });

  test("no business holds the same plan, visit or review reference twice, and no booking schedules two visits", async () => {
    for (const [table, column] of [["maintenance_plans", "slug"], ["maintenance_plan_visits", "ref"], ["reviews", "slug"]] as const) {
      const duplicates = (await admin.query(`select organization_id, ${column}, count(*)::int as n from ${table} group by organization_id, ${column} having count(*) > 1`)).rows;
      expect(duplicates, table).toEqual([]);
    }
    expect((await admin.query("select booking_id, count(*)::int as n from maintenance_plan_visits where booking_id is not null group by booking_id having count(*) > 1")).rows).toEqual([]);
  });

  test("the sample business's Booking BK-1048 is not created by seeding, however many times it runs", async () => {
    expect((await admin.query("select count(*)::int as n from bookings where organization_id = $1 and number = 1048", [ids.apex])).rows[0].n).toBe(0);
    expect((await admin.query("select status, booking_id from maintenance_plan_visits where organization_id = $1 and ref = 'plan-sarah-comfort-care-v2'", [ids.apex])).rows[0]).toEqual({ status: "due", booking_id: null });
  });
});
