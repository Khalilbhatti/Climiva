/**
 * Analytics rules: the pure part of the reporting layer, shared by the server (which queries PostgreSQL), the seed (which reconciles
 * the sample business to its approved figures) and the browser (which shows and exports the answer). No database, no framework, no
 * clock: "today" is always handed in, because the sample business keeps the product's fixed day and every other business its own.
 *
 * What a report is. Analytics owns no records. A report for a date range is
 *
 *     the detailed rows the range selects  (dated facts: bookings and jobs by service day, quotes by creation day, invoices by
 *                                           issue day, payments by payment day)
 *   + the imported adjustments the range covers  (analytics_imported_baselines, see db/schema/reporting)
 *
 * The two sources stay separate until the very last step (`composeReport`), so a test, or the seed, can ask for either one alone.
 * Adjustments with a period are included only when the range covers the whole period; they are never prorated or spread over
 * days, and a business with none (every new one) reports only what its rows say. Plans, reviews and campaigns are "as of today"
 * figures: not filtered by the range, and their adjustments (no period) are always included.
 *
 * Money is integer cents here, like the database. Counts are integers. Nothing in this file rounds money.
 */
import type { InvoiceStatus, QuoteStatus } from "@/data/financials";
import type { CampaignMetrics } from "@/data/marketing";
import type { PlanMetrics } from "@/data/maintenance-plans";
import type { ReviewMetrics } from "@/data/reviews";
import { addDays, isValidDate, startOfWeek } from "./dates";

/* ───────────────────────── the Analytics page ───────────────────────── */

/**
 * The tabs are the questions an owner asks: how many bookings are we getting, how much work is being done, what has been invoiced and paid, what the Marketplace
 * brings, and whether customers stay. Each tab answers its question from the same report; none of them has a figure the others do not.
 */
export const ANALYTICS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "bookings", label: "Bookings" },
  { id: "jobs", label: "Jobs" },
  { id: "revenue", label: "Revenue" },
  { id: "marketplace", label: "Marketplace" },
  { id: "retention", label: "Customer retention" },
] as const;

export type AnalyticsTabId = (typeof ANALYTICS_TABS)[number]["id"];
export const DEFAULT_TAB: AnalyticsTabId = "overview";

/** The tabs of the first version of the page, so a link made then still opens the part of the page it meant. */
const EARLIER_TABS: Readonly<Record<string, AnalyticsTabId>> = { "bookings-jobs": "bookings", financial: "revenue", plans: "retention" };

/** The tab a URL asks for; anything else is the default. */
export const resolveTab = (value: string | null | undefined): AnalyticsTabId =>
  ANALYTICS_TABS.find((tab) => tab.id === value)?.id ?? (value && Object.hasOwn(EARLIER_TABS, value) ? EARLIER_TABS[value] : DEFAULT_TAB);

/* ───────────────────────── date ranges ───────────────────────── */

export type RangeId = "this-month" | "last-month" | "this-quarter" | "custom";
export type PresetId = Exclude<RangeId, "custom">;
export type DateRange = { id: RangeId; from: string; to: string };

export const RANGE_PRESETS: readonly { id: PresetId; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-quarter", label: "This quarter" },
];

/** What the picker opens on, and what Reset returns to. */
export const DEFAULT_RANGE_ID: PresetId = "this-month";

/** The longest custom range a report is built for (two years): a range this long is 25 month columns at most. */
export const MAX_RANGE_DAYS = 731;

const pad = (value: number) => String(value).padStart(2, "0");

const monthStartOf = (date: string) => `${date.slice(0, 7)}-01`;

function monthEndOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return addDays(month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`, -1);
}

const previousMonthOf = (date: string) => monthStartOf(addDays(monthStartOf(date), -1));

/** The whole days between two dates, inclusive of both ends. */
export function daysInRange(from: string, to: string): number {
  const ms = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10))) - Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  return Math.round(ms / 86_400_000) + 1;
}

/** A preset, worked out from the business's own today: the sample business's October 2024, anyone else's current month. */
export function presetRange(id: PresetId, today: string): DateRange {
  if (id === "last-month") {
    const from = previousMonthOf(today);
    return { id, from, to: monthEndOf(from) };
  }
  if (id === "this-quarter") {
    const month = Number(today.slice(5, 7));
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    const from = `${today.slice(0, 4)}-${pad(first)}-01`;
    return { id, from, to: monthEndOf(`${today.slice(0, 4)}-${pad(first + 2)}-01`) };
  }
  return { id: "this-month", from: monthStartOf(today), to: monthEndOf(today) };
}

export function validateCustomRange(from: string, to: string): string | undefined {
  if (!isValidDate(from) || !isValidDate(to)) return "Enter a start date and an end date.";
  if (from > to) return "The end date must be on or after the start date.";
  if (daysInRange(from, to) > MAX_RANGE_DAYS) return "Choose a range of two years or less.";
  return undefined;
}

/**
 * The range a URL asks for. Only the three presets and a valid custom range are understood; anything missing, malformed,
 * reversed or longer than the limit is the default (this month) rather than an error, so a bad link still opens a report.
 */
export function resolveRange(range: string | null | undefined, from: string | null | undefined, to: string | null | undefined, today: string): DateRange {
  if (range === "custom" && isValidDate(from) && isValidDate(to) && validateCustomRange(from, to) === undefined) return { id: "custom", from, to };
  const preset = RANGE_PRESETS.find((item) => item.id === range)?.id ?? DEFAULT_RANGE_ID;
  return presetRange(preset, today);
}

export const rangeLabel = (range: Pick<DateRange, "id">) => RANGE_PRESETS.find((item) => item.id === range.id)?.label ?? "Custom range";

/* ───────────────────────── chart columns ───────────────────────── */

export type Bucket = { start: string; end: string; label: string };

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const monthName = (date: string) => MONTHS_SHORT[Number(date.slice(5, 7)) - 1];

function weekLabel(start: string, end: string): string {
  const first = `${monthName(start)} ${Number(start.slice(8, 10))}`;
  if (start === end) return first;
  return start.slice(0, 7) === end.slice(0, 7) ? `${first}–${Number(end.slice(8, 10))}` : `${first}–${monthName(end)} ${Number(end.slice(8, 10))}`;
}

/** Up to ten weeks are shown week by week; a longer range is shown month by month. */
const WEEKLY_LIMIT_DAYS = 70;

/**
 * The columns of the activity chart for a range: Monday-to-Sunday weeks clipped to the range (the first and last may be short), or
 * calendar months clipped to it when the range is longer than ten weeks. Every day of the range is in exactly one column.
 */
export function reportBuckets(range: Pick<DateRange, "from" | "to">): Bucket[] {
  const buckets: Bucket[] = [];
  const weekly = daysInRange(range.from, range.to) <= WEEKLY_LIMIT_DAYS;
  for (let cursor = range.from; cursor <= range.to; ) {
    const naturalEnd = weekly ? addDays(startOfWeek(cursor), 6) : monthEndOf(cursor);
    const end = naturalEnd < range.to ? naturalEnd : range.to;
    buckets.push({ start: cursor, end, label: weekly ? weekLabel(cursor, end) : `${monthName(cursor)} ${cursor.slice(0, 4)}` });
    cursor = addDays(end, 1);
  }
  return buckets;
}

/* ───────────────────────── imported adjustments ───────────────────────── */

/** The metrics an imported adjustment can belong to. One place, so the seed that writes them and the report that reads them agree. */
export const KEY = {
  bookingsByStatus: "bookings.by_status",
  jobsByStatus: "jobs.by_status",
  bookingsByWeek: "bookings.by_week",
  completedJobsByWeek: "jobs.completed_by_week",
  bookingsByService: "bookings.by_service",
  completedJobsByService: "jobs.completed_by_service",
  quoteCountByStatus: "quotes.count_by_status",
  quoteValue: "quotes.value",
  quoteApprovedValue: "quotes.approved_value",
  invoiceCountByStatus: "invoices.count_by_status",
  invoiceValue: "invoices.value",
  planActive: "plans.active",
  planVisitsDue: "plans.visits_due",
  planRenewals: "plans.renewals",
  planPaused: "plans.paused",
  planEnded: "plans.ended",
  reviewCount: "reviews.count",
  reviewRatingSum: "reviews.rating_sum",
  reviewAwaiting: "reviews.awaiting",
  reviewRequests: "reviews.requests",
  audienceExtra: "marketing.audience_extra",
} as const;

export type AdjustmentRow = {
  metricKey: string;
  dimension: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  integerValue: number | null;
  moneyCents: number | null;
};

const valueOf = (row: AdjustmentRow) => row.integerValue ?? row.moneyCents ?? 0;

/** An adjustment with a period applies only when the range covers all of it. One with no period always applies. */
export const covers = (range: Pick<DateRange, "from" | "to">, row: Pick<AdjustmentRow, "periodStart" | "periodEnd">): boolean =>
  row.periodStart === null || row.periodEnd === null || (range.from <= row.periodStart && range.to >= row.periodEnd);

/** The adjustments of one metric that apply to a range, one entry per dimension (null for an unsplit metric). */
export function adjustmentsOf(rows: readonly AdjustmentRow[], range: Pick<DateRange, "from" | "to"> | null, key: string): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const row of rows) {
    if (row.metricKey !== key || (range !== null && !covers(range, row))) continue;
    totals.set(row.dimension, (totals.get(row.dimension) ?? 0) + valueOf(row));
  }
  return totals;
}

/** The single adjustment of an unsplit (or one split) metric; 0 when there is none. `range: null` means the as-of figures. */
export const adjustmentOf = (rows: readonly AdjustmentRow[], range: Pick<DateRange, "from" | "to"> | null, key: string, dimension: string | null = null): number =>
  adjustmentsOf(rows, range, key).get(dimension) ?? 0;

/** The period the operational adjustments describe, if the business has any. */
export function adjustmentPeriod(rows: readonly AdjustmentRow[]): { from: string; to: string } | null {
  const periodic = rows.filter((row) => row.periodStart !== null && row.periodEnd !== null);
  if (periodic.length === 0) return null;
  return { from: periodic.map((row) => row.periodStart!).sort()[0], to: periodic.map((row) => row.periodEnd!).sort().at(-1)! };
}

/* ───────────────────────── the detailed facts ───────────────────────── */

export const BOOKING_STATUSES = ["confirmed", "completed", "pending", "cancelled"] as const;
export const JOB_STATUSES = ["completed", "scheduled", "in-progress"] as const;
export const QUOTE_STATUSES: readonly QuoteStatus[] = ["approved", "sent", "draft", "declined", "expired"];
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ["paid", "unpaid", "partially-paid"];

/** What the database counts for a range, before any imported adjustment: one row per day, status and Service. */
export type DatedCount = { date: string; status: string; service: string | null; count: number };

export type DetailedFacts = {
  bookings: readonly DatedCount[];
  jobs: readonly DatedCount[];
  quotes: readonly { status: QuoteStatus; count: number; valueCents: number }[];
  invoices: readonly { status: InvoiceStatus; count: number; totalCents: number; balanceCents: number }[];
  payments: { recorded: number; receivedCents: number; voided: readonly { number: number; amountCents: number }[] };
  /** The Services of the business, by reference, for the names in the Service table. */
  serviceNames: ReadonlyMap<string, string>;
};

/* ───────────────────────── the report ───────────────────────── */

export type OperationsReport = {
  bookings: { total: number; confirmed: number; completed: number; pending: number; cancelled: number };
  jobs: { total: number; completed: number; scheduled: number; inProgress: number };
  weekly: { start: string; end: string; label: string; bookings: number; completedJobs: number }[];
  services: { serviceId: string; name: string; bookings: number; completedJobs: number }[];
};

export type FinancialReport = {
  quotes: { count: number; totalValueCents: number; approvedValueCents: number; counts: Record<QuoteStatus, number> };
  invoices: { count: number; totalCents: number; outstandingCents: number; counts: Record<InvoiceStatus, number> };
  payments: { recorded: number; receivedCents: number; voided: { number: number; amountCents: number }[] };
};

export type AnalyticsReport = OperationsReport &
  FinancialReport & {
    range: DateRange;
    /** The business's own today (the sample business's fixed day). */
    today: string;
    kpis: { bookings: number; completedJobs: number; quoteValueCents: number; invoicedCents: number; paymentsReceivedCents: number };
    /** Whether imported history (the sample business's approved totals) is part of these figures, and the period it describes. */
    imported: { period: { from: string; to: string } | null; included: boolean };
    plans: PlanMetrics;
    reviews: ReviewMetrics;
    marketing: CampaignMetrics;
  };

const sum = (values: Iterable<number>) => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

const zeroCounts = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

/** Bookings, jobs, the weekly chart and the Service table: the detailed rows plus the adjustments the range covers. */
export function composeOperations(facts: Pick<DetailedFacts, "bookings" | "jobs" | "serviceNames">, adjustments: readonly AdjustmentRow[], range: Pick<DateRange, "from" | "to">): OperationsReport {
  const adjust = (key: string) => adjustmentsOf(adjustments, range, key);

  const bookingStatus = zeroCounts(BOOKING_STATUSES);
  for (const row of facts.bookings) if (row.status in bookingStatus) bookingStatus[row.status as (typeof BOOKING_STATUSES)[number]] += row.count;
  for (const [status, value] of adjust(KEY.bookingsByStatus)) if (status !== null && status in bookingStatus) bookingStatus[status as (typeof BOOKING_STATUSES)[number]] += value;

  const jobStatus = zeroCounts(JOB_STATUSES);
  for (const row of facts.jobs) if (row.status in jobStatus) jobStatus[row.status as (typeof JOB_STATUSES)[number]] += row.count;
  for (const [status, value] of adjust(KEY.jobsByStatus)) if (status !== null && status in jobStatus) jobStatus[status as (typeof JOB_STATUSES)[number]] += value;

  // Weekly columns: each imported week lands in the column that holds its first day.
  const buckets = reportBuckets(range);
  const weekly = buckets.map((bucket) => ({ ...bucket, bookings: 0, completedJobs: 0 }));
  const columnOf = (date: string) => weekly.find((column) => date >= column.start && date <= column.end);
  for (const row of facts.bookings) {
    const column = columnOf(row.date);
    if (column) column.bookings += row.count;
  }
  for (const row of facts.jobs) {
    const column = row.status === "completed" ? columnOf(row.date) : undefined;
    if (column) column.completedJobs += row.count;
  }
  for (const [week, value] of adjust(KEY.bookingsByWeek)) {
    const column = week === null ? undefined : columnOf(week);
    if (column) column.bookings += value;
  }
  for (const [week, value] of adjust(KEY.completedJobsByWeek)) {
    const column = week === null ? undefined : columnOf(week);
    if (column) column.completedJobs += value;
  }

  // Service table: detailed counts by Service reference, then the imported adjustments; a row with nothing to show is left out.
  const perService = new Map<string, { bookings: number; completedJobs: number }>();
  const entry = (service: string) => {
    let current = perService.get(service);
    if (!current) perService.set(service, (current = { bookings: 0, completedJobs: 0 }));
    return current;
  };
  for (const row of facts.bookings) if (row.service !== null) entry(row.service).bookings += row.count;
  for (const row of facts.jobs) if (row.service !== null && row.status === "completed") entry(row.service).completedJobs += row.count;
  for (const [service, value] of adjust(KEY.bookingsByService)) if (service !== null) entry(service).bookings += value;
  for (const [service, value] of adjust(KEY.completedJobsByService)) if (service !== null) entry(service).completedJobs += value;
  const services = [...perService.entries()]
    .filter(([, counts]) => counts.bookings !== 0 || counts.completedJobs !== 0)
    .map(([serviceId, counts]) => ({ serviceId, name: facts.serviceNames.get(serviceId) ?? serviceId, ...counts }))
    .sort((a, b) => b.bookings - a.bookings || b.completedJobs - a.completedJobs || a.name.localeCompare(b.name));

  return {
    bookings: { total: sum(Object.values(bookingStatus)), ...bookingStatus },
    jobs: { total: sum(Object.values(jobStatus)), completed: jobStatus.completed, scheduled: jobStatus.scheduled, inProgress: jobStatus["in-progress"] },
    weekly,
    services,
  };
}

/** Quotes, invoices and payments: the detailed rows plus the adjustments the range covers. Outstanding is rows only. */
export function composeFinancials(facts: Pick<DetailedFacts, "quotes" | "invoices" | "payments">, adjustments: readonly AdjustmentRow[], range: Pick<DateRange, "from" | "to">): FinancialReport {
  const quoteCounts = zeroCounts(QUOTE_STATUSES);
  let quoteValue = 0;
  let approvedValue = 0;
  for (const row of facts.quotes) {
    quoteCounts[row.status] += row.count;
    quoteValue += row.valueCents;
    if (row.status === "approved") approvedValue += row.valueCents;
  }
  for (const [status, value] of adjustmentsOf(adjustments, range, KEY.quoteCountByStatus)) if (status !== null && status in quoteCounts) quoteCounts[status as QuoteStatus] += value;
  quoteValue += adjustmentOf(adjustments, range, KEY.quoteValue);
  approvedValue += adjustmentOf(adjustments, range, KEY.quoteApprovedValue);

  const invoiceCounts = zeroCounts(INVOICE_STATUSES);
  let invoiced = 0;
  let outstanding = 0;
  for (const row of facts.invoices) {
    invoiceCounts[row.status] += row.count;
    invoiced += row.totalCents;
    outstanding += row.balanceCents;
  }
  for (const [status, value] of adjustmentsOf(adjustments, range, KEY.invoiceCountByStatus)) if (status !== null && status in invoiceCounts) invoiceCounts[status as InvoiceStatus] += value;
  invoiced += adjustmentOf(adjustments, range, KEY.invoiceValue);

  return {
    quotes: { count: sum(Object.values(quoteCounts)), totalValueCents: quoteValue, approvedValueCents: approvedValue, counts: quoteCounts },
    invoices: { count: sum(Object.values(invoiceCounts)), totalCents: invoiced, outstandingCents: outstanding, counts: invoiceCounts },
    payments: { recorded: facts.payments.recorded, receivedCents: facts.payments.receivedCents, voided: [...facts.payments.voided] },
  };
}

/** Whether the range holds anything to report: any booking, job, quote, invoice or payment. */
export function hasActivity(report: Pick<AnalyticsReport, "bookings" | "jobs" | "quotes" | "invoices" | "payments">): boolean {
  return report.bookings.total + report.jobs.total + report.quotes.count + report.invoices.count + report.payments.recorded + report.payments.voided.length > 0;
}

/** The headline totals of a report. */
export const kpisOf = (operations: OperationsReport, financials: FinancialReport): AnalyticsReport["kpis"] => ({
  bookings: operations.bookings.total,
  completedJobs: operations.jobs.completed,
  quoteValueCents: financials.quotes.totalValueCents,
  invoicedCents: financials.invoices.totalCents,
  paymentsReceivedCents: financials.payments.receivedCents,
});

/** What every figure reads when a business has nothing yet. */
export const EMPTY_KPIS: AnalyticsReport["kpis"] = { bookings: 0, completedJobs: 0, quoteValueCents: 0, invoicedCents: 0, paymentsReceivedCents: 0 };

/**
 * The headline totals of the business's current month: what the Overview and the sidebar show, taken from the same report the
 * Analytics page is (so they can never disagree). Money in cents.
 */
export type MonthTotals = {
  range: DateRange;
  bookings: number;
  completedJobs: number;
  invoicedCents: number;
  paymentsReceivedCents: number;
  recordedPayments: number;
};

export const monthTotalsOf = (report: Pick<AnalyticsReport, "range" | "kpis" | "payments">): MonthTotals => ({
  range: report.range,
  bookings: report.kpis.bookings,
  completedJobs: report.kpis.completedJobs,
  invoicedCents: report.kpis.invoicedCents,
  paymentsReceivedCents: report.kpis.paymentsReceivedCents,
  recordedPayments: report.payments.recorded,
});
