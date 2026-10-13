/**
 * Phase 14: Analytics as a reporting layer over PostgreSQL, checked through the same functions the Analytics page, the Overview and
 * the sidebar call (src/db/reporting-queries) under the same tenant context the pages use.
 *
 * What these pin down:
 *  - the sample business's approved October 2024 figures come out of the database (its rows plus its imported adjustments), exactly;
 *  - the imported adjustments are a separate source and never double count: full report - rows-only report = the stored adjustments,
 *    before and after the data changes;
 *  - a date range reports the records inside it, takes the imported history only when it covers all of its period, and never invents
 *    a distribution over days;
 *  - another business sees none of it, a new business reports zeros, and the exports are the report of the active business;
 *  - every kind of change (a payment, a void, an invoice, a quote, a booking, a plan, a reply, a request, a campaign) moves exactly the
 *    figures it should, by exactly its own contribution.
 */
import { randomBytes } from "node:crypto";
import { expect, test as base } from "playwright/test";
import { Pool } from "pg";
import { businessHoursByWeekday } from "../scripts/db/seed-data/apex";
import { VOID_REASONS } from "../src/data/financials";
import type { Tx } from "../src/db";
import { insertBookingTx } from "../src/db/booking-create";
import { createInvoiceFromQuoteTx, loadFinRefs, recordPaymentTx, updateQuoteStatusTx, voidPaymentTx, type FinContext } from "../src/db/fin-queries";
import { createPlanTx } from "../src/db/maint-queries";
import { cancelScheduleTx, saveDraftTx, scheduleTx, sendTx, type MarketingContext } from "../src/db/marketing-queries";
import { loadRefs } from "../src/db/ops-queries";
import { getAnalyticsReport, getPeriodReport } from "../src/db/reporting-queries";
import { createRequestTx, postReplyTx, type ReviewContext } from "../src/db/review-queries";
import { withTenant } from "../src/db/tenant";
import { buildReport, reportFileName, toCsv, toPdf } from "../src/lib/report-export";
import { EXPORT_MODULES } from "../src/data/analytics";
import { hasActivity, monthTotalsOf, presetRange, type AnalyticsReport, type DateRange } from "../src/lib/analytics-rules";
import { localToInstant } from "../src/lib/business-time";
import { initialBookingStatus } from "../src/lib/operations-rules";
import { parseNewPlan } from "../src/lib/maintenance-rules";
import { APEX, ensureMembership, ensureOrganization, ensureUser, seedAuth } from "../scripts/db/seed-lib";
import { adminDb } from "../scripts/db/lib";
import { OVERVIEW_TOTALS } from "./apex-data";
import { test as workerTest } from "./fixtures";

const test = base;

const TODAY = "2024-10-25";
const NOW = "2024-10-25T10:45";
const STAMP = localToInstant(NOW, "America/Chicago");
const OCTOBER: DateRange = { id: "this-month", from: "2024-10-01", to: "2024-10-31" };
const custom = (from: string, to: string): DateRange => ({ id: "custom", from, to });

let admin: Pool;
const ids = { apex: "", northstar: "", alex: "", taylor: "", casey: "" };

test.beforeAll(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
  const one = async (sql: string) => (await admin.query<{ id: string }>(sql)).rows[0].id;
  ids.apex = await one("select id from organizations where slug = 'apex-climate-heating-air'");
  ids.northstar = await one("select id from organizations where slug = 'northstar-heating-cooling'");
  ids.alex = await one("select id from auth_user where email = 'alex.morgan@apex.test'");
  ids.taylor = await one("select id from auth_user where email = 'taylor.brooks@northstar.test'");
  ids.casey = await one("select id from auth_user where email = 'casey.nguyen@climvia.test'");
});

test.afterAll(async () => {
  await admin.end();
});

type Who = { userId: string; organizationId: string };

/** The report a page would read: the active business's, under its tenant context, for a range. */
function report(who: Who, range: DateRange, options: { today?: string; timeZone?: string; includeImported?: boolean } = {}): Promise<AnalyticsReport> {
  return withTenant(who, (tx) => getAnalyticsReport(tx, { organizationId: who.organizationId, timeZone: options.timeZone ?? "America/Chicago", today: options.today ?? TODAY, range, includeImported: options.includeImported }));
}

const apexOwner: () => Who = () => ({ userId: ids.alex, organizationId: ids.apex });
const northstarOwner: () => Who = () => ({ userId: ids.taylor, organizationId: ids.northstar });

test.describe("the approved October 2024 view, from the database", () => {
  test("Bookings 24 (14 confirmed, 6 completed, 2 pending, 2 cancelled) and Completed Jobs 18 (4 scheduled, 2 in progress), with the weekly chart and the Service table", async () => {
    const r = await report(apexOwner(), OCTOBER);
    expect(r.bookings).toEqual({ total: 24, confirmed: 14, completed: 6, pending: 2, cancelled: 2 });
    expect(r.jobs).toEqual({ total: 24, completed: 18, scheduled: 4, inProgress: 2 });
    expect(r.weekly.map((column) => [column.label, column.bookings, column.completedJobs])).toEqual([
      ["Oct 1–6", 5, 3],
      ["Oct 7–13", 6, 5],
      ["Oct 14–20", 7, 4],
      ["Oct 21–27", 4, 4],
      ["Oct 28–31", 2, 2],
    ]);
    expect(r.services.map((row) => [row.serviceId, row.name, row.bookings, row.completedJobs])).toEqual([
      ["ac-repair-diagnostics", "AC Repair & Diagnostics", 9, 7],
      ["annual-cooling-tune-up", "Annual Cooling Tune-Up & Maintenance", 8, 6],
      ["heat-pump-diagnostics-repair", "Heat Pump Diagnostics & Repair", 4, 3],
      ["furnace-safety-inspection", "Furnace Safety Inspection & Tune-Up", 2, 2],
      ["ductless-mini-split-estimate", "Ductless Mini-Split Installation & Estimate", 1, 0],
    ]);
    expect(r.kpis.bookings).toBe(OVERVIEW_TOTALS.bookings);
    expect(r.kpis.completedJobs).toBe(OVERVIEW_TOTALS.completedJobs);
  });

  test("Quotes: 12, $4,820 quoted, $2,975 approved (5 approved, 3 sent, 2 draft, 1 declined, 1 expired)", async () => {
    const r = await report(apexOwner(), OCTOBER);
    expect(r.quotes).toEqual({ count: 12, totalValueCents: 482_000, approvedValueCents: 297_500, counts: { approved: 5, sent: 3, draft: 2, declined: 1, expired: 1 } });
    expect(r.kpis.quoteValueCents).toBe(482_000);
  });

  test("Invoices: 18, $6,240 invoiced, $680 outstanding (12 paid, 4 unpaid, 2 partially paid)", async () => {
    const r = await report(apexOwner(), OCTOBER);
    expect(r.invoices).toEqual({ count: 18, totalCents: 624_000, outstandingCents: 68_000, counts: { paid: 12, unpaid: 4, "partially-paid": 2 } });
    expect(r.kpis.invoicedCents).toBe(OVERVIEW_TOTALS.totalInvoiced * 100);
  });

  test("Payments: 7 recorded, $2,130 received from the rows alone, and PAY-1001 ($285) voided and left out", async () => {
    const r = await report(apexOwner(), OCTOBER);
    expect(r.payments).toEqual({ recorded: 7, receivedCents: 213_000, voided: [{ number: 1001, amountCents: 28_500 }] });
    expect(r.kpis.paymentsReceivedCents).toBe(OVERVIEW_TOTALS.paymentsReceived * 100);
    // Payments need no imported history: the rows are the whole figure.
    const rows = await report(apexOwner(), OCTOBER, { includeImported: false });
    expect(rows.payments).toEqual(r.payments);
    expect(rows.invoices.outstandingCents).toBe(68_000);
  });

  test("Maintenance plans 14 / 5 / 3 / 1 / 1, Reviews 12 with a 4.7 average / 3 awaiting / 5 requests, Marketing 2 / 1 / 8 / 146", async () => {
    const r = await report(apexOwner(), OCTOBER);
    expect(r.plans).toEqual({ active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1, pausedOrEnded: 2, all: 16 });
    expect(r.reviews).toEqual({ total: 12, average: 4.7, awaiting: 3, responded: 9, requests: 5 });
    expect(r.marketing).toEqual({ drafts: 2, scheduled: 1, sent: 8, total: 11, recentRecipients: 146 });
    expect(r.imported).toEqual({ period: { from: "2024-10-01", to: "2024-10-31" }, included: true });
    expect(hasActivity(r)).toBe(true);
  });

  test("the Overview and the sidebar read the same report: this month's four totals and the counts beside Bookings and Jobs", async () => {
    const month = await withTenant(apexOwner(), async (tx) => monthTotalsOf(await getPeriodReport(tx, ids.apex, presetRange("this-month", TODAY))));
    expect(month).toEqual({ range: { id: "this-month", from: "2024-10-01", to: "2024-10-31" }, bookings: 24, completedJobs: 18, invoicedCents: 624_000, paymentsReceivedCents: 213_000, recordedPayments: 7 });
  });
});

test.describe("rows and imported history are two sources that never double count", () => {
  test("the full report minus the rows-only report is exactly the stored adjustments, and each adjustment is the approved figure minus what the rows contribute", async () => {
    const full = await report(apexOwner(), OCTOBER);
    const rows = await report(apexOwner(), OCTOBER, { includeImported: false });
    // What the rows alone say: the seeded sample records.
    expect(rows.bookings).toEqual({ total: 13, confirmed: 5, completed: 6, pending: 2, cancelled: 0 });
    expect(rows.jobs).toEqual({ total: 10, completed: 6, scheduled: 4, inProgress: 0 });
    expect(rows.quotes).toMatchObject({ count: 4, totalValueCents: 657_000, approvedValueCents: 28_500 });
    expect(rows.invoices).toMatchObject({ count: 9, totalCents: 301_000, counts: { paid: 7, unpaid: 1, "partially-paid": 1 } });
    expect(rows.imported).toEqual({ period: null, included: false });

    const stored = (await admin.query<{ metric_key: string; dimension: string | null; integer_value: number | null; money_cents: number | null; metadata: { approved: number; detailed: number } }>(
      "select metric_key, dimension, integer_value, money_cents, metadata from analytics_imported_baselines where organization_id = $1",
      [ids.apex],
    )).rows;
    const value = (key: string, dimension: string | null = null) => {
      const row = stored.find((item) => item.metric_key === key && item.dimension === dimension)!;
      return row.integer_value ?? row.money_cents!;
    };
    // Each stored adjustment is the approved figure minus the rows' share, and the report differs from the rows by exactly it.
    for (const row of stored) expect((row.integer_value ?? row.money_cents!) , `${row.metric_key} ${row.dimension}`).toBe(row.metadata.approved - row.metadata.detailed);
    expect(full.bookings.total - rows.bookings.total).toBe(value("bookings.by_status", "confirmed") + value("bookings.by_status", "completed") + value("bookings.by_status", "pending") + value("bookings.by_status", "cancelled"));
    expect(full.bookings.confirmed - rows.bookings.confirmed).toBe(9);
    expect(full.bookings.cancelled - rows.bookings.cancelled).toBe(2);
    expect(full.jobs.completed - rows.jobs.completed).toBe(12);
    expect(full.invoices.totalCents - rows.invoices.totalCents).toBe(value("invoices.value"));
    expect(full.quotes.totalValueCents - rows.quotes.totalValueCents).toBe(value("quotes.value"));
    // Where the approved figure is smaller than the sample records beside it, the adjustment is negative.
    expect(value("quotes.value")).toBe(-175_000);
    expect(value("bookings.by_week", "2024-10-21")).toBe(-7);
    expect(value("bookings.by_service", "furnace-safety-inspection")).toBe(-1);
    expect(value("bookings.by_service", "emergency-no-heat-no-cool")).toBe(-1);
    expect(value("plans.active")).toBe(14 - 4);
    expect(value("reviews.rating_sum")).toBe(56 - 19);
    expect(value("reviews.count")).toBe(12 - 4);
    expect(value("marketing.audience_extra", "email:all-customers")).toBe(146 - 5);
    // No imported adjustment exists for the money received: the rows are it.
    expect(stored.some((row) => row.metric_key.startsWith("payments"))).toBe(false);
  });

  test("the weekly chart and the Service table reconcile with the totals they sit beside", async () => {
    const r = await report(apexOwner(), OCTOBER);
    expect(r.weekly.reduce((total, column) => total + column.bookings, 0)).toBe(r.bookings.total);
    expect(r.weekly.reduce((total, column) => total + column.completedJobs, 0)).toBe(r.jobs.completed);
    expect(r.services.reduce((total, row) => total + row.bookings, 0)).toBe(r.bookings.total);
    expect(r.services.reduce((total, row) => total + row.completedJobs, 0)).toBe(r.jobs.completed);
  });
});

test.describe("date ranges", () => {
  test("the default range, this month, includes the imported history; Last month, with no records, is empty", async () => {
    const lastMonth = await report(apexOwner(), presetRange("last-month", TODAY));
    expect(lastMonth.range).toEqual({ id: "last-month", from: "2024-09-01", to: "2024-09-30" });
    expect(hasActivity(lastMonth)).toBe(false);
    expect(lastMonth.kpis).toEqual({ bookings: 0, completedJobs: 0, quoteValueCents: 0, invoicedCents: 0, paymentsReceivedCents: 0 });
    expect(lastMonth.imported.included).toBe(false);
    expect(lastMonth.weekly.every((column) => column.bookings === 0 && column.completedJobs === 0)).toBe(true);
    expect(lastMonth.services).toEqual([]);
  });

  test("this quarter covers the whole imported period and also holds November's booking BK-1048 (25 bookings, 15 confirmed), shown month by month", async () => {
    const quarter = await report(apexOwner(), presetRange("this-quarter", TODAY));
    expect(quarter.bookings).toEqual({ total: 25, confirmed: 15, completed: 6, pending: 2, cancelled: 2 });
    expect(quarter.jobs.total).toBe(24);
    expect(quarter.weekly.map((column) => [column.label, column.bookings, column.completedJobs])).toEqual([["Oct 2024", 24, 18], ["Nov 2024", 1, 0], ["Dec 2024", 0, 0]]);
    expect(quarter.invoices.totalCents).toBe(624_000);
    expect(quarter.imported.included).toBe(true);
    expect(quarter.services.find((row) => row.serviceId === "annual-cooling-tune-up")).toMatchObject({ bookings: 9 });
  });

  test("a range inside October reports the records inside it and none of the imported history, never prorated and never spread over days", async () => {
    const partial = await report(apexOwner(), custom("2024-10-21", "2024-10-31"));
    expect(partial.imported).toEqual({ period: { from: "2024-10-01", to: "2024-10-31" }, included: false });
    // The 13 bookings and 10 jobs the records hold from the 21st, by their real days.
    expect(partial.bookings).toEqual({ total: 13, confirmed: 5, completed: 6, pending: 2, cancelled: 0 });
    expect(partial.jobs).toEqual({ total: 10, completed: 6, scheduled: 4, inProgress: 0 });
    expect(partial.weekly.map((column) => [column.label, column.bookings, column.completedJobs])).toEqual([["Oct 21–27", 11, 6], ["Oct 28–31", 2, 0]]);
    expect(partial.invoices).toMatchObject({ count: 9, totalCents: 301_000, outstandingCents: 68_000 });
    expect(partial.payments).toMatchObject({ recorded: 7, receivedCents: 213_000 });
    // One day is one column, with exactly what happened that day.
    const day = await report(apexOwner(), custom("2024-10-25", "2024-10-25"));
    expect(day.weekly).toEqual([{ start: "2024-10-25", end: "2024-10-25", label: "Oct 25", bookings: 4, completedJobs: 2 }]);
    expect(day.bookings.total).toBe(4);
    expect(day.jobs).toMatchObject({ total: 4, completed: 2, scheduled: 2 });
    expect(day.payments).toEqual({ recorded: 2, receivedCents: 68_500, voided: [{ number: 1001, amountCents: 28_500 }] });
    expect(day.invoices.count).toBe(3);
    // A range before any record is empty and shows no imported history either.
    const early = await report(apexOwner(), custom("2024-01-01", "2024-04-30"));
    expect(hasActivity(early)).toBe(false);
    // One day short of the imported period is still not the whole period.
    const short = await report(apexOwner(), custom("2024-10-01", "2024-10-30"));
    expect(short.imported.included).toBe(false);
    expect(short.bookings.total).toBe(13);
    // A wider range that covers it includes it once.
    const wide = await report(apexOwner(), custom("2024-09-15", "2024-11-30"));
    expect(wide.imported.included).toBe(true);
    expect(wide.bookings.total).toBe(25);
  });

  test("the as-of totals (plans, reviews, campaigns) do not depend on the range", async () => {
    const [octoberReport, emptyRange] = await Promise.all([report(apexOwner(), OCTOBER), report(apexOwner(), custom("2023-01-01", "2023-01-31"))]);
    expect(emptyRange.plans).toEqual(octoberReport.plans);
    expect(emptyRange.reviews).toEqual(octoberReport.reviews);
    expect(emptyRange.marketing).toEqual(octoberReport.marketing);
  });

  test("another business's range works from its own today: Northstar's month is the real month, so its October 2024 is asked for by date", async () => {
    const thisMonth = await report(northstarOwner(), presetRange("this-month", "2026-10-12"), { today: "2026-10-12", timeZone: "America/Denver" });
    expect(thisMonth.range).toEqual({ id: "this-month", from: "2026-10-01", to: "2026-10-31" });
    expect(hasActivity(thisMonth)).toBe(false);
    expect(thisMonth.imported.included).toBe(false);
  });
});

test.describe("tenant isolation", () => {
  test("Northstar's own report: its own baseline and records, its own Service names, nothing of Apex's", async () => {
    const r = await report(northstarOwner(), custom("2024-10-01", "2024-10-31"), { today: "2026-10-12", timeZone: "America/Denver" });
    expect(r.bookings).toEqual({ total: 6, confirmed: 3, completed: 2, pending: 1, cancelled: 0 });
    expect(r.jobs).toEqual({ total: 3, completed: 2, scheduled: 1, inProgress: 0 });
    expect(r.services.map((row) => row.name).sort()).toEqual(["Cooling Diagnostic Visit", "Furnace Tune-Up"]);
    expect(r.quotes).toMatchObject({ count: 2, totalValueCents: 22_300 });
    expect(r.invoices).toMatchObject({ count: 2, totalCents: 36_900 });
    expect(r.payments).toMatchObject({ recorded: 1, receivedCents: 6_000, voided: [{ number: 1002, amountCents: 4_000 }] });
    expect(r.reviews).toEqual({ total: 2, average: 4.5, awaiting: 1, responded: 1, requests: 1 });
    expect(r.plans).toMatchObject({ active: 1, visitsDue: 1 });
    expect(r.marketing).toMatchObject({ drafts: 1, scheduled: 0, sent: 1, total: 2 });
    // Nothing is Apex's: not its figures, not its Services.
    expect(JSON.stringify(r)).not.toContain("AC Repair & Diagnostics");
    expect(r.kpis.bookings).not.toBe(24);
    // Apex's numbers do not move when Northstar's are read, and the other way round.
    expect((await report(apexOwner(), OCTOBER)).kpis.bookings).toBe(24);
  });

  test("the organization a query names is not enough: under another business's context, or by someone who is not a member, it reports nothing", async () => {
    const empty = async (who: Who, organizationId: string) =>
      withTenant(who, async (tx) => {
        const period = await getPeriodReport(tx, organizationId, OCTOBER);
        return { bookings: period.bookings.total, jobs: period.jobs.total, quotes: period.quotes.count, invoices: period.invoices.count, payments: period.payments.recorded, imported: period.imported };
      });
    const nothing = { bookings: 0, jobs: 0, quotes: 0, invoices: 0, payments: 0, imported: { period: null, included: false } };
    // Taylor (Northstar's owner) asking for Apex's figures, inside Northstar's context and inside Apex's.
    expect(await empty({ userId: ids.taylor, organizationId: ids.northstar }, ids.apex)).toEqual(nothing);
    expect(await empty({ userId: ids.taylor, organizationId: ids.apex }, ids.apex)).toEqual(nothing);
    // Alex (Apex's owner) asking for Northstar's.
    expect(await empty({ userId: ids.alex, organizationId: ids.apex }, ids.northstar)).toEqual(nothing);
    expect(await empty({ userId: ids.alex, organizationId: ids.northstar }, ids.northstar)).toEqual(nothing);
    // Casey belongs to both and gets each business's own figures by context, never a mixture.
    const caseyApex = await report({ userId: ids.casey, organizationId: ids.apex }, OCTOBER);
    const caseyNorthstar = await report({ userId: ids.casey, organizationId: ids.northstar }, custom("2024-10-01", "2024-10-31"), { today: "2026-10-12", timeZone: "America/Denver" });
    expect(caseyApex.kpis.bookings).toBe(24);
    expect(caseyNorthstar.kpis.bookings).toBe(6);
  });
});

test.describe("a new business", () => {
  test("starts with real, empty reporting: zeros, no imported history, no Apex baseline, and nothing for Marketing", async () => {
    const { pool, db } = adminDb();
    const { auth, close } = seedAuth();
    try {
      const suffix = randomBytes(4).toString("hex");
      const userId = await ensureUser(auth, db, { email: `report-new-${suffix}@example.test`, name: "New Owner" }, process.env.SEED_PASSWORD ?? "");
      const organizationId = await ensureOrganization(db, { ...APEX, slug: `report-new-${suffix}`, fixtureSet: null, sites: [{ name: "Main", slug: "main" }] });
      await ensureMembership(db, { organizationId, userId, role: "owner" });
      for (const range of [presetRange("this-month", "2026-10-12"), OCTOBER, presetRange("this-quarter", TODAY)]) {
        const r = await report({ userId, organizationId }, range, { today: "2026-10-12" });
        expect(r.kpis).toEqual({ bookings: 0, completedJobs: 0, quoteValueCents: 0, invoicedCents: 0, paymentsReceivedCents: 0 });
        expect(r.bookings).toEqual({ total: 0, confirmed: 0, completed: 0, pending: 0, cancelled: 0 });
        expect(r.jobs).toEqual({ total: 0, completed: 0, scheduled: 0, inProgress: 0 });
        expect(r.quotes).toEqual({ count: 0, totalValueCents: 0, approvedValueCents: 0, counts: { approved: 0, sent: 0, draft: 0, declined: 0, expired: 0 } });
        expect(r.invoices).toEqual({ count: 0, totalCents: 0, outstandingCents: 0, counts: { paid: 0, unpaid: 0, "partially-paid": 0 } });
        expect(r.payments).toEqual({ recorded: 0, receivedCents: 0, voided: [] });
        expect(r.services).toEqual([]);
        expect(r.weekly.every((column) => column.bookings === 0 && column.completedJobs === 0)).toBe(true);
        expect(r.imported).toEqual({ period: null, included: false });
        expect(r.plans).toEqual({ active: 0, visitsDue: 0, renewals: 0, paused: 0, ended: 0, pausedOrEnded: 0, all: 0 });
        expect(r.reviews).toEqual({ total: 0, average: 0, awaiting: 0, responded: 0, requests: 0 });
        expect(r.marketing).toEqual({ drafts: 0, scheduled: 0, sent: 0, total: 0, recentRecipients: 0 });
        expect(hasActivity(r)).toBe(false);
      }
      expect((await admin.query("select count(*)::int as n from analytics_imported_baselines where organization_id = $1", [organizationId])).rows[0].n).toBe(0);
    } finally {
      await close();
      await pool.end();
    }
  });
});

test.describe("exports are the active business's report", () => {
  const all = EXPORT_MODULES.map((module) => module.id);

  test("the CSV carries the figures on screen as plain numbers, with the range, the business and the day, and the file name says the range", async () => {
    const r = await report(apexOwner(), OCTOBER);
    const file = buildReport(r, all, "Apex Climate Heating & Air");
    const lines = toCsv(file).trim().split("\r\n");
    expect(lines[0]).toBe("Section,Metric,Value");
    for (const line of [
      "Report,Business,Apex Climate Heating & Air",
      "Report,Date range,2024-10-01 to 2024-10-31",
      "Report,Prepared on,2024-10-25",
      "Summary KPIs,Bookings,24",
      "Summary KPIs,Jobs completed,18",
      "Summary KPIs,Quote value (USD),4820.00",
      "Summary KPIs,Invoiced (USD),6240.00",
      "Summary KPIs,Payments received (USD),2130.00",
      "Bookings,Confirmed,14",
      "Jobs,In progress,2",
      "Quotes & Invoices,Quotes approved,5",
      "Quotes & Invoices,Approved quote value (USD),2975.00",
      "Quotes & Invoices,Invoices partially paid,2",
      "Quotes & Invoices,Outstanding balance (USD),680.00",
      "Payments,Payments recorded,7",
      "Payments,Voided payments,1",
      "Maintenance Plans,Active plans,14",
      "Maintenance Plans,Visits due,5",
    ]) expect(lines, line).toContain(line);
    expect(reportFileName(file, "csv")).toBe("climvia-analytics-2024-10-01-to-2024-10-31.csv");
    expect(reportFileName(file, "pdf")).toBe("climvia-analytics-2024-10-01-to-2024-10-31.pdf");
    expect(toCsv(file)).not.toContain("$");
  });

  test("the PDF says what the CSV says and is a well-formed document", async () => {
    const r = await report(apexOwner(), OCTOBER);
    const bytes = toPdf(buildReport(r, all, "Apex Climate Heating & Air"));
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    for (const phrase of ["Climvia Analytics report", "Apex Climate Heating & Air", "Date range: Oct 1 - Oct 31, 2024", "Summary KPIs", "$6,240.00", "$2,130.00", "$4,820.00", "Voided payments", "Maintenance Plans"]) {
      expect(text, phrase).toContain(phrase.replace(/[\\()]/g, (char) => `\\${char}`));
    }
  });

  test("an export for a range is that range's report: a day's file holds that day, an empty range has nothing to export, and the quarter's name says so", async () => {
    const day = buildReport(await report(apexOwner(), custom("2024-10-25", "2024-10-25")), all, "Apex Climate Heating & Air");
    const csv = toCsv(day).trim().split("\r\n");
    expect(csv).toContain("Report,Date range,2024-10-25 to 2024-10-25");
    expect(csv).toContain("Summary KPIs,Bookings,4");
    expect(csv).toContain("Payments,Payments recorded,2");
    expect(csv).toContain("Summary KPIs,Payments received (USD),685.00");
    expect(csv).not.toContain("Summary KPIs,Bookings,24");
    const quarter = buildReport(await report(apexOwner(), presetRange("this-quarter", TODAY)), all, "Apex Climate Heating & Air");
    expect(reportFileName(quarter, "csv")).toBe("climvia-analytics-2024-10-01-to-2024-12-31.csv");
    expect(toCsv(quarter)).toContain("Summary KPIs,Bookings,25");
    const empty = await report(apexOwner(), custom("2023-01-01", "2023-01-31"));
    expect(hasActivity(empty)).toBe(false);
  });

  test("Northstar's export is Northstar's: its business name and figures, and nothing of Apex's", async () => {
    const r = await report(northstarOwner(), custom("2024-10-01", "2024-10-31"), { today: "2026-10-12", timeZone: "America/Denver" });
    const file = buildReport(r, all, "Northstar Heating & Cooling");
    const csv = toCsv(file);
    expect(csv).toContain("Report,Business,Northstar Heating & Cooling");
    expect(csv).toContain("Report,Prepared on,2026-10-12");
    expect(csv).toContain("Summary KPIs,Bookings,6");
    expect(csv).toContain("Summary KPIs,Invoiced (USD),369.00");
    for (const apexOnly of ["Apex", "6240.00", "2130.00", "4820.00"]) expect(csv, apexOnly).not.toContain(apexOnly);
    expect(Buffer.from(toPdf(file)).toString("latin1")).not.toContain("Apex");
  });
});

/* ───────────────────────── what a change does to the report ───────────────────────── */

const MS = { today: TODAY, stamp: STAMP };

async function financeContext(tx: Tx, who: Who): Promise<FinContext> {
  return { tx, organizationId: who.organizationId, timeZone: "America/Chicago", refs: await loadFinRefs(tx, who.organizationId), today: MS.today, stamp: MS.stamp, actorUserId: who.userId };
}

async function reviewContext(tx: Tx, who: Who): Promise<ReviewContext> {
  return { tx, organizationId: who.organizationId, refs: await loadRefs(tx, who.organizationId), stamp: MS.stamp, actorUserId: who.userId, authorName: "Alex Morgan" };
}

async function marketingContext(tx: Tx, who: Who): Promise<MarketingContext> {
  return { tx, organizationId: who.organizationId, timeZone: "America/Chicago", refs: await loadRefs(tx, who.organizationId), clock: { today: TODAY, now: NOW }, stamp: STAMP, actorUserId: who.userId };
}

/** A business's report now, and the same without the imported history: the pair the no-double-counting checks compare. */
async function both(who: Who, range: DateRange = OCTOBER) {
  return { full: await report(who, range), rows: await report(who, range, { includeImported: false }) };
}

workerTest.describe("every change moves the report by exactly its own contribution", () => {
  const tenantOf = (workerTenant: { userId: string; organizationId: string }): Who => ({ userId: workerTenant.userId, organizationId: workerTenant.organizationId });

  workerTest("recording $300 on INV-1050 moves received to $2,430 (8 payments), outstanding to $380, and one invoice from partially paid to paid; voiding it puts every figure back", async ({ workerTenant }) => {
    const who = tenantOf(workerTenant);
    const before = await both(who);
    const reference = await withTenant(who, async (tx) => recordPaymentTx(await financeContext(tx, who), { invoiceNumber: 1050, amountCents: 30_000, method: "cash", date: TODAY }));
    expect(reference).toBe("PAY-1009");
    const after = await both(who);
    expect(after.full.payments).toMatchObject({ recorded: 8, receivedCents: 243_000 });
    expect(after.full.kpis.paymentsReceivedCents).toBe(243_000);
    expect(after.full.invoices).toMatchObject({ count: 18, totalCents: 624_000, outstandingCents: 38_000, counts: { paid: 13, unpaid: 4, "partially-paid": 1 } });
    // Only these figures moved; everything else is as it was.
    expect({ ...after.full, payments: undefined, invoices: undefined, kpis: undefined }).toEqual({ ...before.full, payments: undefined, invoices: undefined, kpis: undefined });
    // The imported history did not move: the difference between the two reports is what it was.
    expect(after.full.invoices.totalCents - after.rows.invoices.totalCents).toBe(before.full.invoices.totalCents - before.rows.invoices.totalCents);
    expect(after.full.invoices.counts.paid - after.rows.invoices.counts.paid).toBe(before.full.invoices.counts.paid - before.rows.invoices.counts.paid);

    await withTenant(who, async (tx) => voidPaymentTx(await financeContext(tx, who), { paymentNumber: 1009, reason: VOID_REASONS[0] }));
    const voided = await both(who);
    expect(voided.full.payments).toEqual({ recorded: 7, receivedCents: 213_000, voided: [{ number: 1001, amountCents: 28_500 }, { number: 1009, amountCents: 30_000 }] });
    expect(voided.full.invoices).toEqual(before.full.invoices);
    expect(voided.full.kpis).toEqual(before.full.kpis);
  });

  workerTest("a new invoice adds one invoice, its total and its balance; changing a quote's status moves a count between statuses and nothing else", async ({ workerTenant }) => {
    const who = tenantOf(workerTenant);
    const before = await both(who);
    await withTenant(who, async (tx) => createInvoiceFromQuoteTx(await financeContext(tx, who), { quoteNumber: 884, terms: "net-30" }));
    const invoiced = await both(who);
    expect(invoiced.full.invoices).toMatchObject({ count: 19, totalCents: 624_000 + 28_500, outstandingCents: 68_000 + 28_500, counts: { paid: 12, unpaid: 5, "partially-paid": 2 } });
    expect(invoiced.full.kpis.invoicedCents).toBe(652_500);
    expect(invoiced.full.payments).toEqual(before.full.payments);
    expect(invoiced.full.invoices.count - invoiced.rows.invoices.count).toBe(before.full.invoices.count - before.rows.invoices.count);

    await withTenant(who, async (tx) => updateQuoteStatusTx(await financeContext(tx, who), 893, "sent"));
    const quoted = await both(who);
    expect(quoted.full.quotes).toEqual({ ...before.full.quotes, counts: { ...before.full.quotes.counts, draft: before.full.quotes.counts.draft - 1, sent: before.full.quotes.counts.sent + 1 } });
    expect(quoted.full.quotes.count).toBe(12);
    expect(quoted.full.quotes.totalValueCents).toBe(482_000);
  });

  workerTest("a new booking adds one booking in its status, its week and its Service; the weekly chart and the Service table follow the totals", async ({ workerTenant }) => {
    const who = tenantOf(workerTenant);
    const before = await both(who);
    const status = initialBookingStatus("Phone / Front desk", "instant");
    await withTenant(who, async (tx) => {
      const refs = await loadRefs(tx, who.organizationId);
      return insertBookingTx(
        { tx, organizationId: who.organizationId, refs, hours: businessHoursByWeekday, clock: { today: TODAY, now: NOW }, stamp: STAMP },
        { customerId: "david-chen", serviceId: "annual-cooling-tune-up", source: "Phone / Front desk", date: "2024-10-29", start: "09:00", end: "10:00" },
      );
    });
    const after = await both(who);
    expect(after.full.bookings.total).toBe(before.full.bookings.total + 1);
    expect(after.full.bookings[status]).toBe(before.full.bookings[status] + 1);
    expect(after.full.kpis.bookings).toBe(25);
    expect(after.full.weekly[4].bookings).toBe(before.full.weekly[4].bookings + 1);
    expect(after.full.weekly.reduce((total, column) => total + column.bookings, 0)).toBe(25);
    expect(after.full.services.find((row) => row.serviceId === "annual-cooling-tune-up")!.bookings).toBe(9);
    expect(after.full.jobs).toEqual(before.full.jobs);
    expect(after.full.bookings.total - after.rows.bookings.total).toBe(before.full.bookings.total - before.rows.bookings.total);
    // A booking outside the range does not appear in it.
    expect((await report(who, custom("2024-11-01", "2024-11-30"))).bookings.total).toBe(1);
  });

  workerTest("a new maintenance plan adds an active plan and a visit due; a reply moves a review from awaiting to responded and leaves the average alone; a review request adds one request", async ({ workerTenant }) => {
    const who = tenantOf(workerTenant);
    const before = await report(who, OCTOBER);
    const parsed = parseNewPlan({ customerId: "elena-rodriguez", propertyId: "prop-elena-condo", name: "Comfort Care", status: "active", coverage: { cooling: 1, heating: 1 }, price: "189.50", cadence: "year", startDate: TODAY, endDate: "2025-10-25" });
    expect(parsed.ok).toBe(true);
    await withTenant(who, async (tx) => createPlanTx({ tx, organizationId: who.organizationId, refs: await loadRefs(tx, who.organizationId) }, (parsed as { ok: true; value: Parameters<typeof createPlanTx>[1] }).value));
    const planned = await report(who, OCTOBER);
    expect(planned.plans).toMatchObject({ active: 15, visitsDue: 6, renewals: 3, paused: 1, ended: 1, all: 17 });
    expect(planned.reviews).toEqual(before.reviews);

    await withTenant(who, async (tx) => postReplyTx(await reviewContext(tx, who), "rev-sarah-mitchell", "Thank you, Sarah."));
    const replied = await report(who, OCTOBER);
    expect(replied.reviews).toEqual({ total: 12, average: 4.7, awaiting: 2, responded: 10, requests: 5 });

    await withTenant(who, async (tx) => createRequestTx(await reviewContext(tx, who), { customerSlug: "sarah-mitchell", jobNumber: 204, channel: "sms", message: "Please review us." }));
    const asked = await report(who, OCTOBER);
    expect(asked.reviews).toEqual({ total: 12, average: 4.7, awaiting: 2, responded: 10, requests: 6 });
    expect(asked.plans).toEqual(planned.plans);
  });

  workerTest("campaigns move the Marketing totals: a draft, scheduling it, sending it, cancelling the approved schedule", async ({ workerTenant }) => {
    const who = tenantOf(workerTenant);
    const content = { name: "Report test", channel: "email" as const, audienceId: "maintenance-customers" as const, selectedCustomerIds: [], subject: "Hello", message: "Hi" };
    expect((await report(who, OCTOBER)).marketing).toEqual({ drafts: 2, scheduled: 1, sent: 8, total: 11, recentRecipients: 146 });

    await withTenant(who, async (tx) => saveDraftTx(await marketingContext(tx, who), undefined, content));
    expect((await report(who, OCTOBER)).marketing).toEqual({ drafts: 3, scheduled: 1, sent: 8, total: 12, recentRecipients: 146 });

    await withTenant(who, async (tx) => scheduleTx(await marketingContext(tx, who), { slug: "cmp-report-test", expected: "draft" }, content, "2024-11-04T10:30"));
    // The campaign reaches 42 people (2 customers and 40 imported contacts): they join the recent recipients while it is scheduled.
    expect((await report(who, OCTOBER)).marketing).toEqual({ drafts: 2, scheduled: 2, sent: 8, total: 12, recentRecipients: 146 + 42 });

    await withTenant(who, async (tx) => sendTx(await marketingContext(tx, who), { slug: "cmp-report-test", expected: "scheduled" }, content));
    expect((await report(who, OCTOBER)).marketing).toEqual({ drafts: 2, scheduled: 1, sent: 9, total: 12, recentRecipients: 146 + 42 });

    await withTenant(who, async (tx) => cancelScheduleTx(await marketingContext(tx, who), "cmp-fall-maintenance-reminder"));
    expect((await report(who, OCTOBER)).marketing).toEqual({ drafts: 3, scheduled: 0, sent: 9, total: 12, recentRecipients: 146 + 42 - 38 });
  });

  workerTest("what one business does never shows in another's report", async ({ workerTenant }) => {
    const who = tenantOf(workerTenant);
    const northstarBefore = await report(northstarOwner(), custom("2024-10-01", "2024-10-31"), { today: "2026-10-12", timeZone: "America/Denver" });
    await withTenant(who, async (tx) => recordPaymentTx(await financeContext(tx, who), { invoiceNumber: 1050, amountCents: 30_000, method: "cash", date: TODAY }));
    const northstarAfter = await report(northstarOwner(), custom("2024-10-01", "2024-10-31"), { today: "2026-10-12", timeZone: "America/Denver" });
    expect(northstarAfter).toEqual(northstarBefore);
    expect((await report(apexOwner(), OCTOBER)).payments.receivedCents).toBe(213_000);
  });
});
