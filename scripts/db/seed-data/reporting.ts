/**
 * The approved reporting aggregates of the seeded businesses: the figures the product's reports open on.
 *
 * Seed data only. Nothing under src imports this file, and a test checks that none of it reaches the browser's JavaScript. At seed
 * time each figure is turned into an IMPORTED ADJUSTMENT (scripts/db/reporting-seed): the approved figure minus what the business's
 * detailed rows contribute to it, written to analytics_imported_baselines. The application then reports the detailed rows plus the
 * adjustments, so these numbers appear on the screens exactly while the rows are as seeded, and move only by what changes after.
 *
 * Apex's are the approved Stitch figures (Analytics for October 2024, the Overview, Maintenance Plans, Reviews and Marketing).
 * They were written independently of Apex's detailed sample records, which is why some adjustments are negative (the approved
 * quoted value is less than the sample quotes add up to; the approved weekly and per-Service tables hold fewer bookings in some
 * places than the sample records do). The reconciliation is documented in docs/saas-architecture.md.
 *
 * Northstar has a few small figures of its own, so tenant separation is visible: nothing here is Apex's.
 */
import type { InvoiceStatus, QuoteStatus } from "../../../src/data/financials";
import type { AudienceId } from "../../../src/data/marketing";

export type ApprovedReporting = {
  /** The period the operational figures describe (the business's calendar days). */
  period: { from: string; to: string };
  bookings?: Record<"confirmed" | "completed" | "pending" | "cancelled", number>;
  jobs?: Record<"completed" | "scheduled" | "in-progress", number>;
  /** Per week of the period: the first day of the week, Bookings, and completed Jobs. */
  weekly?: readonly { start: string; bookings: number; completedJobs: number }[];
  /** Per Service (its reference): Bookings and completed Jobs. */
  services?: readonly { serviceId: string; bookings: number; completedJobs: number }[];
  quotes?: { counts: Record<QuoteStatus, number>; valueCents: number; approvedValueCents: number };
  invoices?: { counts: Record<InvoiceStatus, number>; totalCents: number };
  /** As of the business's today: no period. */
  plans?: { active: number; visitsDue: number; renewals: number; paused: number; ended: number };
  reviews?: { count: number; average: number; ratingSum: number; awaiting: number; requests: number };
  /** How many customers each audience reaches (the same for email and SMS). */
  audiences?: Record<Exclude<AudienceId, "selected">, number>;
};

/** October 2024, the product's reporting month. */
export const APEX_REPORT_PERIOD = { from: "2024-10-01", to: "2024-10-31" } as const;

export const APEX_APPROVED: ApprovedReporting = {
  period: APEX_REPORT_PERIOD,
  // Bookings by status. They sum to the Overview's 24.
  bookings: { confirmed: 14, completed: 6, pending: 2, cancelled: 2 },
  // Jobs by status. They sum to 24 logged jobs, 18 of them completed (the Overview's Completed Jobs).
  jobs: { completed: 18, scheduled: 4, "in-progress": 2 },
  // Bookings and completed Jobs per week of the period. They sum to 24 and 18.
  weekly: [
    { start: "2024-10-01", bookings: 5, completedJobs: 3 },
    { start: "2024-10-07", bookings: 6, completedJobs: 5 },
    { start: "2024-10-14", bookings: 7, completedJobs: 4 },
    { start: "2024-10-21", bookings: 4, completedJobs: 4 },
    { start: "2024-10-28", bookings: 2, completedJobs: 2 },
  ],
  // Bookings and completed Jobs per Service. Services with no bookings in the period are not listed. They sum to 24 and 18.
  services: [
    { serviceId: "ac-repair-diagnostics", bookings: 9, completedJobs: 7 },
    { serviceId: "annual-cooling-tune-up", bookings: 8, completedJobs: 6 },
    { serviceId: "heat-pump-diagnostics-repair", bookings: 4, completedJobs: 3 },
    { serviceId: "furnace-safety-inspection", bookings: 2, completedJobs: 2 },
    { serviceId: "ductless-mini-split-estimate", bookings: 1, completedJobs: 0 },
  ],
  // Quotes: counts by status, the total quoted ($4,820) and the value of the approved ones ($2,975).
  quotes: { counts: { approved: 5, sent: 3, draft: 2, declined: 1, expired: 1 }, valueCents: 482_000, approvedValueCents: 297_500 },
  // Invoices by status and what they add up to ($6,240).
  invoices: { counts: { paid: 12, unpaid: 4, "partially-paid": 2 }, totalCents: 624_000 },
  // The Maintenance Plans screens' workspace totals.
  plans: { active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1 },
  // The Reviews screens' workspace totals: 12 reviews rated 56 points in all (an average of 4.7), 3 awaiting a reply, 5 requests.
  reviews: { count: 12, average: 4.7, ratingSum: 56, awaiting: 3, requests: 5 },
  // The audience sizes the campaign builder shows (the full customer base, not the sample's records).
  audiences: { "all-customers": 146, "due-for-maintenance": 38, "maintenance-customers": 42, "active-plans": 18 },
};

export const NORTHSTAR_APPROVED: ApprovedReporting = {
  period: APEX_REPORT_PERIOD,
  bookings: { confirmed: 3, completed: 2, pending: 1, cancelled: 0 },
  jobs: { completed: 2, scheduled: 1, "in-progress": 0 },
  weekly: [
    { start: "2024-10-01", bookings: 1, completedJobs: 0 },
    { start: "2024-10-07", bookings: 2, completedJobs: 1 },
    { start: "2024-10-14", bookings: 1, completedJobs: 0 },
    { start: "2024-10-21", bookings: 0, completedJobs: 1 },
    { start: "2024-10-28", bookings: 2, completedJobs: 0 },
  ],
  services: [
    { serviceId: "ac-repair-diagnostics", bookings: 3, completedJobs: 1 },
    { serviceId: "furnace-tune-up", bookings: 3, completedJobs: 1 },
  ],
};
