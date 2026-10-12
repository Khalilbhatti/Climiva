/**
 * Analytics: what the report export offers. Analytics is a reading view of records that live in other modules; it owns no records
 * and keeps nothing of its own. Its figures are computed by the reporting layer (db/reporting-queries, lib/analytics-rules) from
 * the active business's rows, plus an explicit, separate imported history for the sample business (analytics_imported_baselines).
 * Nothing about any business's figures is written down in this file: the approved aggregates of the sample business live in the
 * seed (scripts/db/seed-data/reporting.ts) and reach a browser only as that business's own report.
 *
 * Sources: design-reference/stitch/ analytics_* screens. Conflicts are listed in docs/stitch-screen-map.md §12.
 */

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
