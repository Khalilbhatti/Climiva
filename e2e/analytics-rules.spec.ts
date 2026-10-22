/**
 * The pure rules of the reporting layer (src/lib/analytics-rules): which dates a range means, how a range is cut into chart columns,
 * which imported adjustments a range covers, and how detailed rows and adjustments are combined. No database, no browser.
 *
 * The properties that matter most are the ones that stop a number being wrong in a way nobody notices: an imported adjustment is
 * never counted twice, a row moves a total by exactly its own contribution, a partial range never borrows imported history, and the
 * average rating is always sum / count.
 */
import { expect, test } from "playwright/test";
import { getCampaignMetrics, RECENT_WINDOW_DAYS, type Campaign } from "../src/data/marketing";
import { getPlanMetrics, NO_PLAN_ADJUSTMENT } from "../src/data/maintenance-plans";
import { getReviewMetrics, NO_REVIEW_ADJUSTMENT, type Review } from "../src/data/reviews";
import {
  KEY,
  MAX_RANGE_DAYS,
  adjustmentOf,
  adjustmentPeriod,
  adjustmentsOf,
  composeFinancials,
  composeOperations,
  covers,
  daysInRange,
  hasActivity,
  presetRange,
  reportBuckets,
  resolveRange,
  resolveTab,
  validateCustomRange,
  type AdjustmentRow,
  type DatedCount,
  type DetailedFacts,
} from "../src/lib/analytics-rules";
import { OPERATIONS, PLANS_DATA, PLAN_ADJUSTMENT, REVIEWS_DATA, REVIEW_ADJUSTMENT } from "./apex-data";

const SAMPLE_TODAY = "2024-10-25";
const OCTOBER = { from: "2024-10-01", to: "2024-10-31" };

/** An imported adjustment, as stored. */
const adj = (metricKey: string, dimension: string | null, value: number, period: boolean | { from: string; to: string } = OCTOBER, money = false): AdjustmentRow => ({
  metricKey,
  dimension,
  periodStart: period === true ? OCTOBER.from : period ? period.from : null,
  periodEnd: period === true ? OCTOBER.to : period ? period.to : null,
  integerValue: money ? null : value,
  moneyCents: money ? value : null,
});

const dated = (date: string, status: string, service: string | null, count = 1): DatedCount => ({ date, status, service, count });
const NAMES = new Map([
  ["ac-repair", "AC Repair"],
  ["tune-up", "Tune-Up"],
]);
const facts = (overrides: Partial<DetailedFacts> = {}): DetailedFacts => ({
  bookings: [],
  jobs: [],
  quotes: [],
  invoices: [],
  payments: { recorded: 0, receivedCents: 0, voided: [] },
  serviceNames: NAMES,
  ...overrides,
});

test.describe("date ranges", () => {
  test("the presets are worked out from the business's own today: the sample business's October 2024, anyone else's current month", () => {
    expect(presetRange("this-month", SAMPLE_TODAY)).toEqual({ id: "this-month", ...OCTOBER });
    expect(presetRange("last-month", SAMPLE_TODAY)).toEqual({ id: "last-month", from: "2024-09-01", to: "2024-09-30" });
    expect(presetRange("this-quarter", SAMPLE_TODAY)).toEqual({ id: "this-quarter", from: "2024-10-01", to: "2024-12-31" });
    // Another business, another day: nothing is October 2024 unless that is its month.
    expect(presetRange("this-month", "2026-02-11")).toEqual({ id: "this-month", from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("last-month", "2026-02-11")).toEqual({ id: "last-month", from: "2026-01-01", to: "2026-01-31" });
    expect(presetRange("this-quarter", "2026-02-11")).toEqual({ id: "this-quarter", from: "2026-01-01", to: "2026-03-31" });
  });

  test("month and quarter edges: leap February, January looking back to December, the last day of a quarter", () => {
    expect(presetRange("this-month", "2024-02-29")).toMatchObject({ from: "2024-02-01", to: "2024-02-29" });
    expect(presetRange("this-month", "2025-02-10")).toMatchObject({ from: "2025-02-01", to: "2025-02-28" });
    expect(presetRange("last-month", "2025-01-15")).toMatchObject({ from: "2024-12-01", to: "2024-12-31" });
    expect(presetRange("last-month", "2024-03-31")).toMatchObject({ from: "2024-02-01", to: "2024-02-29" });
    expect(presetRange("this-quarter", "2024-12-31")).toMatchObject({ from: "2024-10-01", to: "2024-12-31" });
    expect(presetRange("this-quarter", "2024-03-31")).toMatchObject({ from: "2024-01-01", to: "2024-03-31" });
    expect(presetRange("this-quarter", "2024-07-01")).toMatchObject({ from: "2024-07-01", to: "2024-09-30" });
  });

  test("a URL is understood only as a preset or a valid custom range; anything else is this month", () => {
    const month = { id: "this-month", ...OCTOBER };
    expect(resolveRange(null, null, null, SAMPLE_TODAY)).toEqual(month);
    expect(resolveRange("nonsense", null, null, SAMPLE_TODAY)).toEqual(month);
    expect(resolveRange("custom", "2024-13-40", "2024-10-31", SAMPLE_TODAY)).toEqual(month);
    expect(resolveRange("custom", "2024-10-31", "2024-10-01", SAMPLE_TODAY)).toEqual(month);
    expect(resolveRange("custom", null, "2024-10-01", SAMPLE_TODAY)).toEqual(month);
    expect(resolveRange("last-month", null, null, SAMPLE_TODAY)).toMatchObject({ id: "last-month", from: "2024-09-01" });
    expect(resolveRange("this-quarter", "2020-01-01", "2020-02-02", SAMPLE_TODAY)).toMatchObject({ id: "this-quarter", from: "2024-10-01", to: "2024-12-31" });
    expect(resolveRange("custom", "2024-11-15", "2024-11-20", SAMPLE_TODAY)).toEqual({ id: "custom", from: "2024-11-15", to: "2024-11-20" });
    // A custom range is also a range of a business whose today is not October 2024.
    expect(resolveRange(null, null, null, "2027-05-05")).toEqual({ id: "this-month", from: "2027-05-01", to: "2027-05-31" });
  });

  test("a custom range needs two real dates in order, and is at most two years long", () => {
    expect(validateCustomRange("2024-10-01", "2024-10-31")).toBeUndefined();
    expect(validateCustomRange("2024-10-01", "2024-10-01")).toBeUndefined();
    expect(validateCustomRange("", "2024-10-31")).toMatch(/start date and an end date/);
    expect(validateCustomRange("2024-02-30", "2024-10-31")).toMatch(/start date and an end date/);
    expect(validateCustomRange("2024-10-31", "2024-10-01")).toMatch(/on or after the start date/);
    expect(daysInRange("2024-01-01", "2025-12-31")).toBe(MAX_RANGE_DAYS);
    expect(validateCustomRange("2024-01-01", "2025-12-31")).toBeUndefined();
    expect(validateCustomRange("2024-01-01", "2026-01-01")).toMatch(/two years or less/);
    expect(resolveRange("custom", "2020-01-01", "2024-12-06", SAMPLE_TODAY)).toMatchObject({ id: "this-month" });
  });

  test("only the six known tabs are understood, and the first version's addresses open the tab that replaced them", () => {
    for (const tab of ["overview", "bookings", "jobs", "revenue", "marketplace", "retention"]) expect(resolveTab(tab)).toBe(tab);
    expect(resolveTab("bookings-jobs")).toBe("bookings");
    expect(resolveTab("financial")).toBe("revenue");
    expect(resolveTab("plans")).toBe("retention");
    for (const bad of ["", null, undefined, "marketing", "../etc", "OVERVIEW", "__proto__", "constructor", "toString"]) expect(resolveTab(bad as string | null)).toBe("overview");
  });
});

test.describe("chart columns", () => {
  test("October is five weeks, Monday to Sunday, clipped to the month, written the way the approved chart writes them", () => {
    expect(reportBuckets(OCTOBER).map((bucket) => bucket.label)).toEqual(["Oct 1–6", "Oct 7–13", "Oct 14–20", "Oct 21–27", "Oct 28–31"]);
    expect(reportBuckets(OCTOBER).map((bucket) => bucket.start)).toEqual(["2024-10-01", "2024-10-07", "2024-10-14", "2024-10-21", "2024-10-28"]);
  });

  test("a week that crosses a month names both months; a one-day range is one column", () => {
    expect(reportBuckets({ from: "2024-10-28", to: "2024-11-03" }).map((bucket) => bucket.label)).toEqual(["Oct 28–Nov 3"]);
    expect(reportBuckets({ from: "2024-10-25", to: "2024-10-25" })).toEqual([{ start: "2024-10-25", end: "2024-10-25", label: "Oct 25" }]);
  });

  test("a range longer than ten weeks is shown month by month", () => {
    expect(reportBuckets({ from: "2024-10-01", to: "2024-12-31" }).map((bucket) => bucket.label)).toEqual(["Oct 2024", "Nov 2024", "Dec 2024"]);
    expect(reportBuckets({ from: "2024-10-15", to: "2025-01-20" }).map((bucket) => [bucket.start, bucket.end])).toEqual([
      ["2024-10-15", "2024-10-31"],
      ["2024-11-01", "2024-11-30"],
      ["2024-12-01", "2024-12-31"],
      ["2025-01-01", "2025-01-20"],
    ]);
  });

  test("every day of a range is in exactly one column, however the range is cut", () => {
    for (const [from, to] of [["2024-10-01", "2024-10-31"], ["2024-10-02", "2024-10-02"], ["2024-12-30", "2025-01-12"], ["2024-02-26", "2024-03-05"], ["2024-01-01", "2025-12-31"], ["2024-10-07", "2024-12-22"]]) {
      const columns = reportBuckets({ from, to });
      expect(columns[0].start).toBe(from);
      expect(columns.at(-1)!.end).toBe(to);
      for (let index = 1; index < columns.length; index += 1) {
        const next = new Date(`${columns[index - 1].end}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        expect(columns[index].start, `${from}..${to} column ${index}`).toBe(next.toISOString().slice(0, 10));
      }
    }
  });
});

test.describe("imported adjustments", () => {
  test("an adjustment with a period applies only when the range covers all of it; one with no period always applies", () => {
    const row = adj(KEY.bookingsByStatus, "confirmed", 9);
    expect(covers(OCTOBER, row)).toBe(true);
    expect(covers({ from: "2024-09-01", to: "2024-12-31" }, row)).toBe(true);
    expect(covers({ from: "2024-10-02", to: "2024-10-31" }, row)).toBe(false);
    expect(covers({ from: "2024-10-01", to: "2024-10-30" }, row)).toBe(false);
    expect(covers({ from: "2024-11-01", to: "2024-11-30" }, row)).toBe(false);
    expect(covers({ from: "2030-01-01", to: "2030-01-02" }, adj(KEY.planActive, null, 9, false))).toBe(true);
  });

  test("adjustments are read per metric and dimension, summed when a metric is stored more than once, and an as-of read ignores the range", () => {
    const rows = [adj(KEY.bookingsByStatus, "confirmed", 9), adj(KEY.bookingsByStatus, "cancelled", 2), adj(KEY.planActive, null, 9, false), adj(KEY.quoteValue, null, -175_000, true, true)];
    expect([...adjustmentsOf(rows, OCTOBER, KEY.bookingsByStatus)].sort()).toEqual([["cancelled", 2], ["confirmed", 9]]);
    expect(adjustmentOf(rows, OCTOBER, KEY.bookingsByStatus, "confirmed")).toBe(9);
    expect(adjustmentOf(rows, OCTOBER, KEY.bookingsByStatus, "pending")).toBe(0);
    expect(adjustmentOf(rows, OCTOBER, KEY.quoteValue)).toBe(-175_000);
    expect(adjustmentOf(rows, null, KEY.planActive)).toBe(9);
    expect(adjustmentOf(rows, { from: "2025-01-01", to: "2025-01-31" }, KEY.bookingsByStatus, "confirmed")).toBe(0);
    expect(adjustmentPeriod(rows)).toEqual(OCTOBER);
    expect(adjustmentPeriod([adj(KEY.planActive, null, 9, false)])).toBeNull();
    expect(adjustmentPeriod([])).toBeNull();
  });
});

test.describe("detailed rows plus adjustments", () => {
  const bookingFacts = [
    dated("2024-10-21", "completed", "ac-repair"),
    dated("2024-10-25", "confirmed", "ac-repair", 3),
    dated("2024-10-26", "pending", "tune-up"),
    dated("2024-11-19", "confirmed", "tune-up"),
  ];
  const jobFacts = [dated("2024-10-21", "completed", "ac-repair"), dated("2024-10-25", "scheduled", "tune-up"), dated("2024-10-25", "completed", "tune-up")];
  const adjustments = [
    adj(KEY.bookingsByStatus, "confirmed", 9),
    adj(KEY.bookingsByStatus, "cancelled", 2),
    adj(KEY.jobsByStatus, "completed", 12),
    adj(KEY.jobsByStatus, "in-progress", 2),
    adj(KEY.bookingsByWeek, "2024-10-01", 5),
    adj(KEY.bookingsByWeek, "2024-10-21", -3),
    adj(KEY.completedJobsByWeek, "2024-10-01", 3),
    adj(KEY.bookingsByService, "ac-repair", 4),
    adj(KEY.bookingsByService, "tune-up", -1),
    adj(KEY.completedJobsByService, "ac-repair", 7),
  ];

  test("the report is the rows the range selects plus the adjustments it covers, status by status, week by week, Service by Service", () => {
    const report = composeOperations(facts({ bookings: bookingFacts.filter((row) => row.date <= "2024-10-31"), jobs: jobFacts }), adjustments, OCTOBER);
    expect(report.bookings).toEqual({ total: 5 + 11, confirmed: 3 + 9, completed: 1, pending: 1, cancelled: 2 });
    expect(report.jobs).toEqual({ total: 3 + 14, completed: 2 + 12, scheduled: 1, inProgress: 2 });
    // An imported week lands in the column that holds its first day; a negative adjustment lowers a column.
    expect(report.weekly.map((column) => [column.label, column.bookings, column.completedJobs])).toEqual([
      ["Oct 1–6", 5, 3],
      ["Oct 7–13", 0, 0],
      ["Oct 14–20", 0, 0],
      ["Oct 21–27", 5 - 3, 2],
      ["Oct 28–31", 0, 0],
    ]);
    // The Service table is by Service reference, biggest first; a Service whose figures add up to nothing is not listed.
    expect(report.services).toEqual([
      { serviceId: "ac-repair", name: "AC Repair", bookings: 4 + 4, completedJobs: 1 + 7 },
      { serviceId: "tune-up", name: "Tune-Up", bookings: 1 - 1, completedJobs: 1 },
    ]);
  });

  test("a range that does not cover the imported period gets the rows alone; the adjustments are never prorated", () => {
    const partial = composeOperations(facts({ bookings: bookingFacts.slice(0, 2), jobs: jobFacts }), adjustments, { from: "2024-10-10", to: "2024-10-31" });
    const rowsOnly = composeOperations(facts({ bookings: bookingFacts.slice(0, 2), jobs: jobFacts }), [], { from: "2024-10-10", to: "2024-10-31" });
    expect(partial).toEqual(rowsOnly);
    expect(partial.bookings).toMatchObject({ total: 4, confirmed: 3, cancelled: 0 });
  });

  test("nothing is counted twice: the adjustments alone explain the difference, and a row moves a total by exactly its own contribution", () => {
    const base = facts({ bookings: bookingFacts.slice(0, 3), jobs: jobFacts });
    const full = composeOperations(base, adjustments, OCTOBER);
    const rows = composeOperations(base, [], OCTOBER);
    expect(full.bookings.total - rows.bookings.total).toBe(9 + 2);
    expect(full.jobs.total - rows.jobs.total).toBe(12 + 2);
    expect(full.bookings.confirmed - rows.bookings.confirmed).toBe(9);

    // One more confirmed booking on Oct 26 for the tune-up: +1 booking, +1 confirmed, +1 in its week, +1 for its Service, nothing else.
    const more = composeOperations(facts({ bookings: [...bookingFacts.slice(0, 3), dated("2024-10-26", "confirmed", "tune-up")], jobs: jobFacts }), adjustments, OCTOBER);
    expect(more.bookings.total - full.bookings.total).toBe(1);
    expect(more.bookings.confirmed - full.bookings.confirmed).toBe(1);
    expect(more.bookings.pending).toBe(full.bookings.pending);
    expect(more.weekly[3].bookings - full.weekly[3].bookings).toBe(1);
    expect(more.weekly.reduce((total, column) => total + column.bookings, 0) - full.weekly.reduce((total, column) => total + column.bookings, 0)).toBe(1);
    expect(more.services.find((row) => row.serviceId === "tune-up")!.bookings - full.services.find((row) => row.serviceId === "tune-up")!.bookings).toBe(1);
    expect(more.jobs).toEqual(full.jobs);

    // A seeded booking moving from confirmed to cancelled changes two statuses and not the total.
    const cancelled = composeOperations(facts({ bookings: [...bookingFacts.slice(0, 1), dated("2024-10-25", "confirmed", "ac-repair", 2), dated("2024-10-25", "cancelled", "ac-repair"), bookingFacts[2]], jobs: jobFacts }), adjustments, OCTOBER);
    expect(cancelled.bookings.total).toBe(full.bookings.total);
    expect(cancelled.bookings.confirmed).toBe(full.bookings.confirmed - 1);
    expect(cancelled.bookings.cancelled).toBe(full.bookings.cancelled + 1);
  });

  test("an adjustment for a status nobody knows is ignored, a booking with no Service is in the totals but not the Service table, and no adjustments means only rows", () => {
    const report = composeOperations(facts({ bookings: [dated("2024-10-25", "confirmed", null)] }), [adj(KEY.bookingsByStatus, "mystery", 40), adj(KEY.jobsByStatus, "cancelled", 3)], OCTOBER);
    expect(report.bookings).toEqual({ total: 1, confirmed: 1, completed: 0, pending: 0, cancelled: 0 });
    expect(report.jobs.total).toBe(0);
    expect(report.services).toEqual([]);
    expect(report.weekly.reduce((total, column) => total + column.bookings, 0)).toBe(1);
    expect(composeOperations(facts(), [], OCTOBER).bookings.total).toBe(0);
  });

  test("quotes, invoices and payments: rows plus covered adjustments, with the outstanding balance from rows alone", () => {
    const financial = facts({
      quotes: [
        { status: "approved", count: 1, valueCents: 28_500 },
        { status: "draft", count: 1, valueCents: 485_000 },
      ],
      invoices: [
        { status: "paid", count: 7, totalCents: 213_000, balanceCents: 0 },
        { status: "partially-paid", count: 1, totalCents: 50_000, balanceCents: 30_000 },
        { status: "unpaid", count: 1, totalCents: 38_000, balanceCents: 38_000 },
      ],
      payments: { recorded: 7, receivedCents: 213_000, voided: [{ number: 1001, amountCents: 28_500 }] },
    });
    const rows = [
      adj(KEY.quoteCountByStatus, "approved", 4),
      adj(KEY.quoteValue, null, -175_000, true, true),
      adj(KEY.quoteApprovedValue, null, 269_000, true, true),
      adj(KEY.invoiceCountByStatus, "paid", 5),
      adj(KEY.invoiceValue, null, 323_000, true, true),
    ];
    const report = composeFinancials(financial, rows, OCTOBER);
    expect(report.quotes).toEqual({ count: 6, totalValueCents: 513_500 - 175_000, approvedValueCents: 28_500 + 269_000, counts: { approved: 5, sent: 0, draft: 1, declined: 0, expired: 0 } });
    expect(report.invoices).toMatchObject({ count: 14, totalCents: 301_000 + 323_000, outstandingCents: 68_000, counts: { paid: 12, unpaid: 1, "partially-paid": 1 } });
    expect(report.payments).toEqual({ recorded: 7, receivedCents: 213_000, voided: [{ number: 1001, amountCents: 28_500 }] });
    // Out of the imported period the same rows stand alone; the outstanding balance is the same either way.
    const outside = composeFinancials(financial, rows, { from: "2024-10-05", to: "2024-10-31" });
    expect(outside.invoices).toMatchObject({ count: 9, totalCents: 301_000, outstandingCents: 68_000 });
    expect(outside.quotes).toMatchObject({ count: 2, totalValueCents: 513_500 });
  });

  test("a range has activity when any booking, job, quote, invoice or payment is in it", () => {
    const empty = composeOperations(facts(), [], OCTOBER);
    const none = composeFinancials(facts(), [], OCTOBER);
    expect(hasActivity({ ...empty, ...none })).toBe(false);
    expect(hasActivity({ ...empty, ...composeFinancials(facts({ payments: { recorded: 0, receivedCents: 0, voided: [{ number: 1, amountCents: 5 }] } }), [], OCTOBER) })).toBe(true);
    expect(hasActivity({ ...composeOperations(facts({ jobs: [dated("2024-10-25", "scheduled", null)] }), [], OCTOBER), ...none })).toBe(true);
  });
});

test.describe("totals counted as of today", () => {
  const review = (id: string, rating: 1 | 2 | 3 | 4 | 5, answered = false): Review => ({
    id,
    source: "Climvia",
    contactName: id,
    rating,
    text: "x",
    date: "2024-10-01",
    response: answered ? { body: "Thanks", by: "Alex", at: "2024-10-02T10:00" } : undefined,
  });

  test("the average is always the sum of the ratings over the number of reviews, rounded to one decimal", () => {
    const sample = getReviewMetrics(REVIEWS_DATA, REVIEW_ADJUSTMENT);
    expect(sample).toEqual({ total: 12, average: 4.7, awaiting: 3, responded: 9, requests: 5 });
    // 56 points over 12 reviews. One more 5 is 61 over 13 (4.69); one more 1 is 57 over 13 (4.38).
    const add = (rating: 1 | 2 | 3 | 4 | 5) => getReviewMetrics({ reviews: [...REVIEWS_DATA.reviews, review("new", rating)], requests: REVIEWS_DATA.requests }, REVIEW_ADJUSTMENT);
    expect(add(5)).toMatchObject({ total: 13, average: 4.7 });
    expect(add(1)).toMatchObject({ total: 13, average: 4.4 });
    expect(add(3)).toMatchObject({ total: 13, average: 4.5 });
  });

  test("a business counts only its own reviews: another business's ratings never enter its average", () => {
    const mine = { reviews: [review("a", 5), review("b", 4)], requests: [] };
    const theirs = { reviews: [review("c", 1), review("d", 1), review("e", 1)], requests: [] };
    expect(getReviewMetrics(mine)).toMatchObject({ total: 2, average: 4.5 });
    expect(getReviewMetrics(theirs)).toMatchObject({ total: 3, average: 1 });
    expect(getReviewMetrics({ reviews: [], requests: [] }, NO_REVIEW_ADJUSTMENT)).toEqual({ total: 0, average: 0, awaiting: 0, responded: 0, requests: 0 });
  });

  test("a reply moves one review from awaiting to responded and changes neither the count nor the average", () => {
    const before = { reviews: [review("a", 5), review("b", 3)], requests: [] };
    const after = { reviews: [review("a", 5, true), review("b", 3)], requests: [] };
    const one = getReviewMetrics(before, { count: 10, ratingSum: 40, awaiting: 2, requests: 1 });
    const two = getReviewMetrics(after, { count: 10, ratingSum: 40, awaiting: 2, requests: 1 });
    expect(two.awaiting).toBe(one.awaiting - 1);
    expect(two.responded).toBe(one.responded + 1);
    expect(two.total).toBe(one.total);
    expect(two.average).toBe(one.average);
    expect(two.requests).toBe(one.requests);
  });

  test("the plan totals are the stored plans plus the imported adjustment: 14 / 5 / 3 / 1 / 1 for the sample business, only its own plans for anyone else", () => {
    expect(getPlanMetrics(PLANS_DATA, OPERATIONS, SAMPLE_TODAY, PLAN_ADJUSTMENT)).toMatchObject({ active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1, pausedOrEnded: 2 });
    const own = getPlanMetrics(PLANS_DATA, OPERATIONS, SAMPLE_TODAY, NO_PLAN_ADJUSTMENT);
    expect(own.active).toBe(14 - PLAN_ADJUSTMENT.active);
    expect(getPlanMetrics({ plans: [] }, OPERATIONS, SAMPLE_TODAY).all).toBe(0);
  });

  test("recent recipients are those of campaigns sent in the last 60 days plus those still scheduled; drafts and older sends do not count", () => {
    const campaign = (id: string, status: Campaign["status"], recipients: number, sentAt?: string): Campaign => ({ id, name: id, channel: "email", audienceId: "all-customers", recipients, status, sentAt });
    const data = {
      campaigns: [
        campaign("a", "sent", 10, "2024-08-26"),
        campaign("b", "sent", 20, "2024-08-25"),
        campaign("c", "sent", 5, "2024-10-25T09:00"),
        campaign("d", "sent", 100, "2024-10-26"),
        campaign("e", "scheduled", 7),
        campaign("f", "draft", 1000),
      ],
    };
    expect(RECENT_WINDOW_DAYS).toBe(60);
    // 2024-08-26 is exactly 60 days before 2024-10-25: inside. 08-25 is outside. A send after today (not possible) is outside too.
    expect(getCampaignMetrics(data, SAMPLE_TODAY)).toEqual({ drafts: 1, scheduled: 1, sent: 4, total: 6, recentRecipients: 10 + 5 + 7 });
    expect(getCampaignMetrics({ campaigns: [] }, SAMPLE_TODAY)).toEqual({ drafts: 0, scheduled: 0, sent: 0, total: 0, recentRecipients: 0 });
  });
});
