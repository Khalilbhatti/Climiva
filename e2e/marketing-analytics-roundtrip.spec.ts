/**
 * The seed and the application's database layer agree for Marketing and the Analytics baseline too: what the seed wrote is what the
 * application reads back, field for field (campaigns, recipients with their delivery results, chosen customers, imported adjustments),
 * the sample records keep the same database identity every time the database is rebuilt, and seeding again changes nothing: no
 * duplicate campaign, recipient or adjustment, no moved timestamp. A test copy of the sample business is restored to exactly this.
 *
 * These read through the restricted runtime role under the tenant context (the way a page does).
 */
import { expect, test } from "playwright/test";
import { Pool } from "pg";
import type { Campaign } from "../src/data/marketing";
import { loadAdjustments } from "../src/db/adjustments";
import { loadCampaignRecipients, loadMarketing } from "../src/db/marketing-queries";
import { getAnalyticsReport } from "../src/db/reporting-queries";
import { stableId } from "../src/db/stable-id";
import { withTenant } from "../src/db/tenant";
import { presetRange } from "../src/lib/analytics-rules";
import { adminDb } from "../scripts/db/lib";
import { resetTestTenant, seedDevelopmentData } from "../scripts/db/seed-lib";
import { COOLING_TUNE_UP_RECIPIENTS, MARKETING, NORTHSTAR_MARKETING } from "./apex-data";
import { test as fixtures } from "./fixtures";

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

/** A seeded campaign as the application reads it: the recipients are not part of a campaign. */
const asRead = (campaigns: readonly (Campaign & { recipientRows?: unknown })[]): Campaign[] =>
  campaigns.map((campaign) => {
    const copy: Record<string, unknown> = { ...campaign };
    delete copy.recipientRows;
    return copy as Campaign;
  });

test.describe("what was seeded is what is read", () => {
  test("Apex: the eleven campaigns come back exactly as seeded, in the order they were made", async () => {
    const read = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadMarketing(tx, ids.apex, "America/Chicago"));
    expect(read.campaigns).toEqual(asRead(MARKETING.campaigns));
    expect(read.campaigns.map((campaign) => campaign.id).slice(0, 5)).toEqual([
      "cmp-fall-maintenance-reminder",
      "cmp-cooling-tune-up-reminder",
      "cmp-seasonal-service-reminder",
      "cmp-winter-heating-prep-notice",
      "cmp-filter-replacement-reminder",
    ]);
  });

  test("Northstar: its own two campaigns come back exactly as seeded, in its own time zone", async () => {
    const read = await withTenant({ userId: ids.taylor, organizationId: ids.northstar }, (tx) => loadMarketing(tx, ids.northstar, "America/Denver"));
    expect(read.campaigns).toEqual(asRead(NORTHSTAR_MARKETING.campaigns));
    expect(read.campaigns.find((campaign) => campaign.id === "cmp-radiant-heat-estimate-offer")).toMatchObject({ sentAt: "2024-10-28T11:30", status: "sent" });
  });

  test("the sent campaign's recipients and delivery result come back as seeded: the snapshot, the result for each, the customer link where there is one", async () => {
    const read = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadCampaignRecipients(tx, ids.apex, "America/Chicago", "cmp-cooling-tune-up-reminder"));
    expect(read!.total).toBe(42);
    expect(read!.recipients).toHaveLength(6);
    expect(read!.recipients.map((person) => ({ name: person.name, phone: person.phone, status: person.status, at: person.at, customerId: person.customerId, failureReason: person.failureReason }))).toEqual(
      COOLING_TUNE_UP_RECIPIENTS.map((person) => ({ name: person.name, phone: person.phone, status: person.status, at: person.at, customerId: person.customerId, failureReason: person.failureReason })),
    );
    expect(read!.campaign.delivery).toEqual({ delivered: 40, notDelivered: 2 });
    // A campaign whose recipients are counted and not listed has an empty snapshot and its own count.
    const winter = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadCampaignRecipients(tx, ids.apex, "America/Chicago", "cmp-winter-heating-prep-notice"));
    expect(winter).toMatchObject({ total: 48, recipients: [] });
  });

  test("the imported adjustments come back exactly as written, for the active business only", async () => {
    const apex = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadAdjustments(tx, ids.apex));
    const stored = (await admin.query("select count(*)::int as n from analytics_imported_baselines where organization_id = $1", [ids.apex])).rows[0].n;
    expect(apex).toHaveLength(stored);
    expect(apex.length).toBeGreaterThan(50);
    const northstar = await withTenant({ userId: ids.taylor, organizationId: ids.northstar }, (tx) => loadAdjustments(tx, ids.northstar));
    // Northstar's own: bookings and jobs by status, by week and by Service. No money, no plans, no reviews, no audiences.
    expect(northstar).toHaveLength(4 + 3 + 5 + 5 + 2 + 2);
    expect(northstar.every((row) => /^(bookings|jobs)\./.test(row.metricKey))).toBe(true);
    // Through the same functions another business's rows are invisible.
    expect(await withTenant({ userId: ids.taylor, organizationId: ids.apex }, (tx) => loadAdjustments(tx, ids.apex))).toEqual([]);
    expect(await withTenant({ userId: ids.alex, organizationId: ids.northstar }, (tx) => loadAdjustments(tx, ids.northstar))).toEqual([]);
  });
});

test.describe("identity and repeatability", () => {
  test("the sample records have deterministic ids, so a rebuilt database gives the same ones", async () => {
    const campaign = await admin.query<{ id: string }>("select id from marketing_campaigns where organization_id = $1 and slug = 'cmp-fall-maintenance-reminder'", [ids.apex]);
    expect(campaign.rows[0].id).toBe(stableId(ids.apex, "campaign", "cmp-fall-maintenance-reminder"));
    expect(stableId(ids.northstar, "campaign", "cmp-fall-maintenance-reminder")).not.toBe(stableId(ids.apex, "campaign", "cmp-fall-maintenance-reminder"));
  });

  test("seeding again changes nothing: the same campaigns, recipients, chosen customers and adjustments, with the same timestamps", async () => {
    const snapshot = async () =>
      (
        await admin.query(
          `select (select count(*)::int from marketing_campaigns) as campaigns, (select count(*)::int from marketing_campaign_recipients) as recipients,
                  (select count(*)::int from marketing_campaign_selected_customers) as chosen, (select count(*)::int from analytics_imported_baselines) as adjustments,
                  (select max(updated_at)::text from marketing_campaigns where organization_id in ($1, $2)) as campaign_updated,
                  (select max(updated_at)::text from analytics_imported_baselines where organization_id in ($1, $2)) as adjustment_updated,
                  (select string_agg(slug || ':' || status || ':' || coalesce(recipient_count, -1) || ':' || coalesce(delivered_count, -1), ',' order by organization_id, position) from marketing_campaigns where organization_id in ($1, $2)) as states,
                  (select sum(coalesce(integer_value, money_cents))::bigint::text from analytics_imported_baselines where organization_id in ($1, $2)) as total`,
          [ids.apex, ids.northstar],
        )
      ).rows[0];
    const before = await snapshot();
    await seedDevelopmentData();
    expect(await snapshot()).toEqual(before);
  });

  test("no business holds the same campaign reference twice, and no metric is stored twice for a split and a period", async () => {
    expect((await admin.query("select organization_id, slug, count(*)::int as n from marketing_campaigns group by organization_id, slug having count(*) > 1")).rows).toEqual([]);
    expect(
      (await admin.query("select organization_id, metric_key, dimension, period_start, period_end, count(*)::int as n from analytics_imported_baselines group by 1, 2, 3, 4, 5 having count(*) > 1")).rows,
    ).toEqual([]);
  });

  test("the sample business's report is the approved one however many times the seed has run", async () => {
    const report = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) =>
      getAnalyticsReport(tx, { organizationId: ids.apex, timeZone: "America/Chicago", today: "2024-10-25", range: presetRange("this-month", "2024-10-25") }),
    );
    expect(report.kpis).toEqual({ bookings: 24, completedJobs: 18, quoteValueCents: 482_000, invoicedCents: 624_000, paymentsReceivedCents: 213_000 });
    expect(report.marketing).toMatchObject({ drafts: 2, scheduled: 1, sent: 8, recentRecipients: 146 });
  });
});

fixtures.describe("a test copy of the sample business", () => {
  fixtures("is restored to the seeded campaigns, recipients and adjustments, however a test changed them", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const state = async () =>
      (
        await admin.query(
          `select (select count(*)::int from marketing_campaigns where organization_id = $1) as campaigns,
                  (select count(*)::int from marketing_campaign_recipients where organization_id = $1) as recipients,
                  (select count(*)::int from analytics_imported_baselines where organization_id = $1) as adjustments,
                  (select sum(coalesce(integer_value, money_cents))::bigint::text from analytics_imported_baselines where organization_id = $1) as total,
                  (select string_agg(slug || ':' || status, ',' order by position) from marketing_campaigns where organization_id = $1) as states`,
          [org],
        )
      ).rows[0];
    const seeded = await state();
    expect(seeded).toMatchObject({ campaigns: 11, recipients: 6 });
    // A test (or a person) changes things: a campaign is cancelled and another made, an adjustment is moved.
    await admin.query("update marketing_campaigns set status = 'draft', scheduled_for = null where organization_id = $1 and slug = 'cmp-fall-maintenance-reminder'", [org]);
    await admin.query("insert into marketing_campaigns (organization_id, slug, name, channel, audience_id, status) values ($1, 'cmp-extra', 'Extra', 'email', 'all-customers', 'draft')", [org]);
    await admin.query("update analytics_imported_baselines set integer_value = integer_value + 7 where organization_id = $1 and metric_key = 'reviews.count'", [org]);
    expect(await state()).not.toEqual(seeded);

    const { pool, db } = adminDb();
    try {
      await resetTestTenant(db, workerTenant);
    } finally {
      await pool.end();
    }
    expect(await state()).toEqual(seeded);
  });
});
