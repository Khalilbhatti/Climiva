/**
 * Analytics in the browser: the few things that are about showing a report rather than building it.
 *
 * The figures themselves are not computed here. A report is worked out on the server from the business's own rows in PostgreSQL
 * (db/reporting-queries, with the pure rules in lib/analytics-rules), arrives as one typed object, and is shown and exported as it
 * is. What is read here is only the list of recent records beside the totals, picked from the Bookings, Jobs and Payments the
 * workspace already holds, inside the report's date range, so a total on Analytics and the owning module can be followed to the
 * same records.
 */
import type { FinancialData, Payment } from "@/data/financials";
import { BOOKING_SOURCES, type Booking, type BookingSource, type Job, type OperationsData } from "@/data/operations";
import { formatMonthDay } from "./dates";
import { getDisplayPreferences } from "./display-preferences";
import { formatDate } from "./format";

export { rangeLabel, validateCustomRange } from "./analytics-rules";

/** "Oct 1 – Oct 31, 2024" (or each end in full, in the saved date style). */
export function formatRange(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (sameYear && getDisplayPreferences().dateFormat === "mdy-short") return `${formatMonthDay(from)} – ${formatMonthDay(to)}, ${to.slice(0, 4)}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

const newestFirst = (a: string, b: string) => b.localeCompare(a);

export type RecentRecords = { bookings: Booking[]; completedJobs: Job[]; payments: Payment[] };

/** The latest bookings (not pending, already due), completed jobs and recorded payments inside a date range, newest first. */
export function recentRecords(operations: OperationsData, financial: FinancialData, range: { from: string; to: string }, today: string): RecentRecords {
  const inRange = (date: string) => date >= range.from && date <= range.to;
  return {
    bookings: operations.bookings
      .filter((booking) => booking.status !== "pending" && booking.date <= today && inRange(booking.date))
      .sort((a, b) => newestFirst(`${a.date}T${a.start}`, `${b.date}T${b.start}`))
      .slice(0, 5),
    completedJobs: operations.jobs
      .filter((job) => job.status === "completed" && inRange(job.date))
      // Completions made in a session all carry the same "now", so ties fall back to the later visit first.
      .sort(
        (a, b) =>
          newestFirst(a.completion?.at ?? `${a.date}T${a.end}`, b.completion?.at ?? `${b.date}T${b.end}`) ||
          newestFirst(`${a.date}T${a.start}`, `${b.date}T${b.start}`) ||
          newestFirst(a.id, b.id),
      )
      .slice(0, 3),
    payments: financial.payments
      .filter((payment) => payment.status === "recorded" && inRange(payment.date))
      .sort((a, b) => newestFirst(a.date, b.date) || newestFirst(a.id, b.id))
      .slice(0, 4),
  };
}

export type SourceCounts = {
  /** Booking records dated inside the range, whatever their status. */
  records: number;
  /** One entry per source that has at least one booking, in the order the sources are listed everywhere. */
  bySource: { source: BookingSource; count: number }[];
  /** Records that say where they came from. Imported history carries no source, so it is never in these. */
  recorded: number;
};

/**
 * Where the bookings in a range came from, counted from the booking records the workspace holds. It is a different question from "how many bookings": the
 * report's total can include imported history that has no source, so these counts are of records, and are labelled so on the page. Nothing here is estimated.
 */
export function bookingsBySource(operations: Pick<OperationsData, "bookings">, range: { from: string; to: string }): SourceCounts {
  const inRange = operations.bookings.filter((booking) => booking.date >= range.from && booking.date <= range.to);
  const bySource = BOOKING_SOURCES.map((source) => ({ source, count: inRange.filter((booking) => booking.source === source).length })).filter((entry) => entry.count > 0);
  return { records: inRange.length, bySource, recorded: bySource.reduce((total, entry) => total + entry.count, 0) };
}
