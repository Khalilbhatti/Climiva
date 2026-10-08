/**
 * Analytics reads; it does not own. These pure functions turn the shared records and selectors into the figures the
 * reports show, so a total on Analytics is the same number the owning module shows:
 *
 *  - Bookings, Jobs, Quotes, the weekly chart and the Service table are the approved aggregates (data/analytics), like
 *    the Overview's Bookings and Completed Jobs. They do not move during a session, so Analytics and the Overview can
 *    never disagree.
 *  - Money, invoice statuses, payments and maintenance plans are derived from the Financial and Maintenance Plans
 *    stores through the same selectors those modules use, so a payment recorded or an invoice created in this session
 *    shows here at once.
 *  - The recent bookings, completed jobs and payments are records read from the operational and financial stores.
 */
import {
  BOOKING_BREAKDOWN,
  DEFAULT_RANGE_ID,
  INVOICE_BASELINE_COUNTS,
  JOB_BREAKDOWN,
  QUOTE_BASELINE,
  RANGE_PRESETS,
  REPORT_PERIOD,
  SERVICE_ACTIVITY,
  WEEKLY_ACTIVITY,
  type RangeId,
} from "@/data/analytics";
import {
  FINANCIALS,
  getInvoiceStatus,
  getOutstandingBalance,
  getPaymentsReceivedTotal,
  getRecordedPaymentsCount,
  getTotalInvoiced,
  type FinancialData,
  type InvoiceStatus,
  type Payment,
  type QuoteStatus,
} from "@/data/financials";
import { PROTOTYPE_TODAY, overviewMetrics } from "@/data/fixtures";
import { getPlanMetrics, type PlanMetrics, type PlansData } from "@/data/maintenance-plans";
import type { Booking, Job, OperationsData } from "@/data/operations";
import { getServiceById } from "@/data/services";
import { formatMonthDay, isValidDate } from "./dates";
import { getDisplayPreferences } from "./display-preferences";
import { formatDate } from "./format";

/* ───────────────────────── the figures ───────────────────────── */

export type AnalyticsModel = {
  kpis: { bookings: number; completedJobs: number; quoteValue: number; invoiced: number; paymentsReceived: number };
  bookings: { total: number; confirmed: number; completed: number; pending: number; cancelled: number };
  jobs: { total: number; completed: number; scheduled: number; inProgress: number };
  recentBookings: Booking[];
  recentCompletedJobs: Job[];
  weekly: typeof WEEKLY_ACTIVITY;
  services: { serviceId: string; name: string; bookings: number; completedJobs: number }[];
  quotes: { count: number; totalValue: number; approvedValue: number; counts: Record<QuoteStatus, number> };
  invoices: { count: number; total: number; outstanding: number; counts: Record<InvoiceStatus, number> };
  payments: { recorded: number; received: number; voided: Payment[]; recent: Payment[] };
  plans: PlanMetrics;
};

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function tallyInvoices(data: FinancialData): Record<InvoiceStatus, number> {
  const counts: Record<InvoiceStatus, number> = { paid: 0, unpaid: 0, "partially-paid": 0 };
  for (const invoice of data.invoices) counts[getInvoiceStatus(invoice, data)] += 1;
  return counts;
}

const CANONICAL_INVOICE_COUNTS = tallyInvoices(FINANCIALS);

/**
 * The approved status counts, moved by what has happened to the invoices since the baseline: an invoice created in the
 * session adds one, and a payment that settles one moves it between statuses.
 */
function invoiceCounts(data: FinancialData): Record<InvoiceStatus, number> {
  const now = tallyInvoices(data);
  return {
    paid: INVOICE_BASELINE_COUNTS.paid + now.paid - CANONICAL_INVOICE_COUNTS.paid,
    unpaid: INVOICE_BASELINE_COUNTS.unpaid + now.unpaid - CANONICAL_INVOICE_COUNTS.unpaid,
    "partially-paid": INVOICE_BASELINE_COUNTS["partially-paid"] + now["partially-paid"] - CANONICAL_INVOICE_COUNTS["partially-paid"],
  };
}

const newestFirst = (a: string, b: string) => b.localeCompare(a);

export function buildAnalytics(financial: FinancialData, plans: PlansData, operations: OperationsData): AnalyticsModel {
  const invoices = invoiceCounts(financial);
  const quoteCounts: Record<QuoteStatus, number> = { ...QUOTE_BASELINE.counts };
  const bookingTotal = sum(Object.values(BOOKING_BREAKDOWN));
  const jobTotal = sum(Object.values(JOB_BREAKDOWN));
  const received = getPaymentsReceivedTotal(financial);

  return {
    kpis: {
      bookings: overviewMetrics.bookings,
      completedJobs: overviewMetrics.completedJobs,
      quoteValue: QUOTE_BASELINE.totalValue,
      invoiced: getTotalInvoiced(financial),
      paymentsReceived: received,
    },
    bookings: { total: bookingTotal, ...BOOKING_BREAKDOWN },
    jobs: { total: jobTotal, ...JOB_BREAKDOWN },
    recentBookings: operations.bookings
      .filter((booking) => booking.status !== "pending" && booking.date <= PROTOTYPE_TODAY)
      .sort((a, b) => newestFirst(`${a.date}T${a.start}`, `${b.date}T${b.start}`))
      .slice(0, 5),
    recentCompletedJobs: operations.jobs
      .filter((job) => job.status === "completed")
      // Completions made in a session all carry the prototype's fixed "now", so ties fall back to the later visit first.
      .sort(
        (a, b) =>
          newestFirst(a.completion?.at ?? `${a.date}T${a.end}`, b.completion?.at ?? `${b.date}T${b.end}`) ||
          newestFirst(`${a.date}T${a.start}`, `${b.date}T${b.start}`) ||
          newestFirst(a.id, b.id),
      )
      .slice(0, 3),
    weekly: WEEKLY_ACTIVITY,
    services: SERVICE_ACTIVITY.map((row) => ({ ...row, name: getServiceById(row.serviceId)?.name ?? row.serviceId })),
    quotes: { count: sum(Object.values(quoteCounts)), totalValue: QUOTE_BASELINE.totalValue, approvedValue: QUOTE_BASELINE.approvedValue, counts: quoteCounts },
    invoices: { count: sum(Object.values(invoices)), total: getTotalInvoiced(financial), outstanding: getOutstandingBalance(financial), counts: invoices },
    payments: {
      recorded: getRecordedPaymentsCount(financial),
      received,
      voided: financial.payments.filter((payment) => payment.status === "voided"),
      recent: financial.payments
        .filter((payment) => payment.status === "recorded")
        .sort((a, b) => newestFirst(a.date, b.date) || newestFirst(a.id, b.id))
        .slice(0, 4),
    },
    plans: getPlanMetrics(plans, operations),
  };
}

/** What every figure reads when the selected range has no recorded activity. */
export const EMPTY_KPIS: AnalyticsModel["kpis"] = { bookings: 0, completedJobs: 0, quoteValue: 0, invoiced: 0, paymentsReceived: 0 };

/* ───────────────────────── date ranges ───────────────────────── */

export type DateRange = { id: RangeId; from: string; to: string };

/** The range a URL asks for; anything missing or invalid is the default (this month). */
export function resolveRange(range: string | null, from: string | null, to: string | null): DateRange {
  if (range === "custom" && isValidDate(from) && isValidDate(to) && from <= to) return { id: "custom", from, to };
  const preset = RANGE_PRESETS.find((item) => item.id === range) ?? RANGE_PRESETS.find((item) => item.id === DEFAULT_RANGE_ID)!;
  return { id: preset.id, from: preset.from, to: preset.to };
}

export function validateCustomRange(from: string, to: string): string | undefined {
  if (!isValidDate(from) || !isValidDate(to)) return "Enter a start date and an end date.";
  if (from > to) return "The end date must be on or after the start date.";
  return undefined;
}

/** Whether the range touches the period the reports describe. Outside it nothing is recorded, so it shows the empty state. */
export function hasActivity(range: DateRange): boolean {
  return range.from <= REPORT_PERIOD.to && range.to >= REPORT_PERIOD.from;
}

/** Whether the range is exactly the reporting period. Any other range that has activity reports the whole period. */
export function isReportPeriod(range: DateRange): boolean {
  return range.from === REPORT_PERIOD.from && range.to === REPORT_PERIOD.to;
}

/** "Oct 1 – Oct 31, 2024" (or each end in full, in the saved date style). */
export function formatRange(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (sameYear && getDisplayPreferences().dateFormat === "mdy-short") return `${formatMonthDay(from)} – ${formatMonthDay(to)}, ${to.slice(0, 4)}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export const rangeLabel = (range: DateRange) => RANGE_PRESETS.find((item) => item.id === range.id)?.label ?? "Custom range";
