/**
 * Reconciling a seeded business to its approved reporting figures.
 *
 * The sample business's approved aggregates (scripts/db/seed-data/reporting) describe history its detailed records do not hold one
 * by one. This turns each approved figure into an IMPORTED ADJUSTMENT: the approved figure minus whatever the business's detailed
 * rows (already written) contribute to it, computed with the SAME reporting functions the application reports with, over the
 * detailed rows alone. Written once, at seed time, to analytics_imported_baselines by the owner connection; the application can
 * read the rows and nothing else.
 *
 * Then a report is the detailed rows plus these adjustments, so
 *   - while the rows are as seeded, the report is exactly the approved figure (nothing is counted twice, because the adjustment
 *     already excludes what the rows contribute);
 *   - a booking, job, quote, invoice or payment added later, or a status that changes, moves the report by its own contribution.
 * An adjustment is signed: where the approved figure is smaller than the sample records it sits beside, it is negative.
 */
import { eq } from "drizzle-orm";
import { getPlanContribution } from "../../src/data/maintenance-plans";
import { getReviewContribution } from "../../src/data/reviews";
import { loadAdjustments } from "../../src/db/adjustments";
import type { Tx } from "../../src/db";
import { loadMaintenance } from "../../src/db/maint-queries";
import { resolveAudience } from "../../src/db/marketing-queries";
import { loadOperations } from "../../src/db/ops-queries";
import { getPeriodReport } from "../../src/db/reporting-queries";
import { loadReviews } from "../../src/db/review-queries";
import { analyticsImportedBaselines } from "../../src/db/schema";
import { BOOKING_STATUSES, INVOICE_STATUSES, JOB_STATUSES, KEY, QUOTE_STATUSES, type DateRange } from "../../src/lib/analytics-rules";
import type { ApprovedReporting } from "./seed-data/reporting";

type Insert = typeof analyticsImportedBaselines.$inferInsert;

/** Remove every imported adjustment of one organization (tests reset a worker's copy of the sample business with this). */
export async function clearReporting(tx: Tx, organizationId: string): Promise<void> {
  await tx.delete(analyticsImportedBaselines).where(eq(analyticsImportedBaselines.organizationId, organizationId));
}

export async function reconcileReporting(tx: Tx, organizationId: string, timeZone: string, approved: ApprovedReporting, today?: string): Promise<void> {
  await clearReporting(tx, organizationId);
  const period = { periodStart: approved.period.from, periodEnd: approved.period.to };
  const range: DateRange = { id: "custom", from: approved.period.from, to: approved.period.to };
  const detail = await getPeriodReport(tx, organizationId, range, { includeImported: false });
  const rows: Insert[] = [];

  const count = (metricKey: string, dimension: string | null, approvedValue: number, detailedValue: number, withPeriod: boolean) =>
    rows.push({
      organizationId,
      metricKey,
      dimension,
      ...(withPeriod ? period : {}),
      integerValue: approvedValue - detailedValue,
      metadata: { approved: approvedValue, detailed: detailedValue },
    });
  const money = (metricKey: string, dimension: string | null, approvedValue: number, detailedValue: number) =>
    rows.push({ organizationId, metricKey, dimension, ...period, moneyCents: approvedValue - detailedValue, metadata: { approved: approvedValue, detailed: detailedValue, unit: "cents" } });

  if (approved.bookings) {
    for (const status of BOOKING_STATUSES) count(KEY.bookingsByStatus, status, approved.bookings[status], detail.bookings[status], true);
  }
  if (approved.jobs) {
    const detailed = { completed: detail.jobs.completed, scheduled: detail.jobs.scheduled, "in-progress": detail.jobs.inProgress };
    for (const status of JOB_STATUSES) count(KEY.jobsByStatus, status, approved.jobs[status], detailed[status], true);
  }
  if (approved.weekly) {
    const columns = new Map(detail.weekly.map((column) => [column.start, column]));
    for (const week of approved.weekly) {
      const column = columns.get(week.start);
      if (!column) throw new Error(`The approved week of ${week.start} is not a week of the reporting period.`);
      count(KEY.bookingsByWeek, week.start, week.bookings, column.bookings, true);
      count(KEY.completedJobsByWeek, week.start, week.completedJobs, column.completedJobs, true);
    }
  }
  if (approved.services) {
    const slugs = new Set([...approved.services.map((row) => row.serviceId), ...detail.services.map((row) => row.serviceId)]);
    for (const slug of [...slugs].sort()) {
      const want = approved.services.find((row) => row.serviceId === slug);
      const have = detail.services.find((row) => row.serviceId === slug);
      count(KEY.bookingsByService, slug, want?.bookings ?? 0, have?.bookings ?? 0, true);
      count(KEY.completedJobsByService, slug, want?.completedJobs ?? 0, have?.completedJobs ?? 0, true);
    }
  }
  if (approved.quotes) {
    for (const status of QUOTE_STATUSES) count(KEY.quoteCountByStatus, status, approved.quotes.counts[status], detail.quotes.counts[status], true);
    money(KEY.quoteValue, null, approved.quotes.valueCents, detail.quotes.totalValueCents);
    money(KEY.quoteApprovedValue, null, approved.quotes.approvedValueCents, detail.quotes.approvedValueCents);
  }
  if (approved.invoices) {
    for (const status of INVOICE_STATUSES) count(KEY.invoiceCountByStatus, status, approved.invoices.counts[status], detail.invoices.counts[status], true);
    money(KEY.invoiceValue, null, approved.invoices.totalCents, detail.invoices.totalCents);
  }

  // "As of today" figures: plans, reviews and the audience sizes have no period.
  if (approved.plans) {
    if (!today) throw new Error("Reconciling plans needs the business's today.");
    const own = getPlanContribution(await loadMaintenance(tx, organizationId), await loadOperations(tx, organizationId, timeZone), today);
    count(KEY.planActive, null, approved.plans.active, own.active, false);
    count(KEY.planVisitsDue, null, approved.plans.visitsDue, own.visitsDue, false);
    count(KEY.planRenewals, null, approved.plans.renewals, own.renewals, false);
    count(KEY.planPaused, null, approved.plans.paused, own.paused, false);
    count(KEY.planEnded, null, approved.plans.ended, own.ended, false);
  }
  if (approved.reviews) {
    const own = getReviewContribution(await loadReviews(tx, organizationId, timeZone));
    count(KEY.reviewCount, null, approved.reviews.count, own.count, false);
    count(KEY.reviewRatingSum, null, approved.reviews.ratingSum, own.ratingSum, false);
    count(KEY.reviewAwaiting, null, approved.reviews.awaiting, own.awaiting, false);
    count(KEY.reviewRequests, null, approved.reviews.requests, own.requests, false);
  }
  if (approved.audiences) {
    if (!today) throw new Error("Reconciling audiences needs the business's today.");
    for (const channel of ["email", "sms"] as const) {
      for (const audience of ["all-customers", "due-for-maintenance", "maintenance-customers", "active-plans"] as const) {
        const resolved = await resolveAudience(tx, organizationId, today, channel, audience, [], []);
        count(KEY.audienceExtra, `${channel}:${audience}`, approved.audiences[audience], resolved.contacts.length, false);
      }
    }
  }

  if (rows.length > 0) await tx.insert(analyticsImportedBaselines).values(rows);
  // The adjustments must read back exactly as written: a cheap guard that the metric keys and periods are what the report reads.
  const stored = await loadAdjustments(tx, organizationId);
  if (stored.length !== rows.length) throw new Error(`Wrote ${rows.length} reporting adjustments but read back ${stored.length}.`);
}
