/**
 * Analytics baselines: the approved aggregates the reports open on. Analytics is a reading view of records that live in
 * other modules; it owns no records and keeps nothing of its own. These constants exist only because the approved
 * totals describe a month of history that the representative fixtures do not carry record by record, exactly like the
 * Overview's Bookings (24) and Completed Jobs (18). Every figure that CAN follow the session (money, invoice statuses,
 * payments, maintenance plans) is derived from the shared selectors in lib/analytics-state and these constants are the
 * baseline it starts from.
 *
 * Sources: design-reference/stitch/ analytics_* screens. Conflicts are listed in docs/stitch-screen-map.md §12.
 */
import { overviewMetrics } from "./fixtures";

/** The reporting period the approved aggregates describe (October 2024, the prototype's month). */
export const REPORT_PERIOD = { from: "2024-10-01", to: "2024-10-31" } as const;

/** Bookings by status. They sum to the Overview's 24. */
export const BOOKING_BREAKDOWN = { confirmed: 14, completed: 6, pending: 2, cancelled: 2 } as const;

/** Jobs by status. They sum to 24 logged jobs, 18 of them completed (the Overview's Completed Jobs). */
export const JOB_BREAKDOWN = { completed: overviewMetrics.completedJobs, scheduled: 4, inProgress: 2 } as const;

/** Quotes: counts by status, the total quoted and the value of the approved ones. Quotes are never edited in a session. */
export const QUOTE_BASELINE = {
  counts: { approved: 5, sent: 3, draft: 2, declined: 1, expired: 1 },
  totalValue: 4820,
  approvedValue: 2975,
} as const;

/** Invoices by status at the baseline; invoices created and payments recorded in a session move them. */
export const INVOICE_BASELINE_COUNTS = { paid: 12, unpaid: 4, "partially-paid": 2 } as const;

/** Bookings and completed jobs per week of the period. They sum to 24 and 18. */
export const WEEKLY_ACTIVITY: readonly { label: string; bookings: number; completedJobs: number }[] = [
  { label: "Oct 1–6", bookings: 5, completedJobs: 3 },
  { label: "Oct 7–13", bookings: 6, completedJobs: 5 },
  { label: "Oct 14–20", bookings: 7, completedJobs: 4 },
  { label: "Oct 21–27", bookings: 4, completedJobs: 4 },
  { label: "Oct 28–31", bookings: 2, completedJobs: 2 },
];

/** Bookings and completed jobs per Service. Services with no bookings in the period are not listed. They sum to 24 and 18. */
export const SERVICE_ACTIVITY: readonly { serviceId: string; bookings: number; completedJobs: number }[] = [
  { serviceId: "ac-repair-diagnostics", bookings: 9, completedJobs: 7 },
  { serviceId: "annual-cooling-tune-up", bookings: 8, completedJobs: 6 },
  { serviceId: "heat-pump-diagnostics-repair", bookings: 4, completedJobs: 3 },
  { serviceId: "furnace-safety-inspection", bookings: 2, completedJobs: 2 },
  { serviceId: "ductless-mini-split-estimate", bookings: 1, completedJobs: 0 },
];

/* ───────────────────────── date ranges ───────────────────────── */

export type RangeId = "this-month" | "last-month" | "this-quarter" | "custom";

export const RANGE_PRESETS: readonly { id: Exclude<RangeId, "custom">; label: string; from: string; to: string }[] = [
  { id: "this-month", label: "This month", from: "2024-10-01", to: "2024-10-31" },
  { id: "last-month", label: "Last month", from: "2024-09-01", to: "2024-09-30" },
  { id: "this-quarter", label: "This quarter", from: "2024-10-01", to: "2024-12-31" },
];

/** What the picker opens on, and what Reset returns to. */
export const DEFAULT_RANGE_ID = "this-month";

/* ───────────────────────── export ───────────────────────── */

export type ExportModuleId = "summary" | "bookings" | "jobs" | "financial" | "payments" | "plans";

export const EXPORT_MODULES: readonly { id: ExportModuleId; label: string; description: string }[] = [
  { id: "summary", label: "Summary KPIs", description: "Summary KPI totals across Bookings, Jobs, Quotes, Invoices, and Payments" },
  { id: "bookings", label: "Bookings", description: "Booking records and statuses" },
  { id: "jobs", label: "Jobs", description: "Job records and statuses" },
  { id: "financial", label: "Quotes & Invoices", description: "Quote and Invoice totals and statuses" },
  { id: "payments", label: "Payments", description: "Recorded Payments, including voided ones" },
  { id: "plans", label: "Maintenance Plans", description: "Plan and included-visit summaries" },
];

export type ExportFormat = "csv" | "pdf";

export const EXPORT_FORMATS: readonly { id: ExportFormat; label: string; description: string }[] = [
  { id: "csv", label: "CSV (.csv)", description: "Spreadsheet-compatible data" },
  { id: "pdf", label: "PDF (.pdf)", description: "Formatted report" },
];
