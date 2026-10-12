/**
 * Turns the Analytics report into a downloadable file, in the browser. The report is the one the server computed for the active
 * business and the selected date range: the screen and the export read the same object, and one report model feeds both formats,
 * so the screen, the CSV and the PDF always say the same thing. Nothing is sent anywhere: the file is made from what is on screen.
 */
import { EXPORT_MODULES, type ExportFormat, type ExportModuleId } from "@/data/analytics";
import type { AnalyticsReport } from "./analytics-rules";
import { formatRange } from "./analytics-state";
import { formatDate } from "./format";
import { fromCents } from "./money";
import { buildPdf, type PdfLine } from "./pdf";

type ReportRow = { label: string; value: number; kind: "count" | "usd" };
export type ReportSection = { title: string; rows: ReportRow[] };

export type Report = {
  title: string;
  businessName: string;
  /** "Oct 1 – Oct 31, 2024" in the saved date style. */
  rangeText: string;
  /** The same range as ISO dates, for the CSV and the file name. */
  from: string;
  to: string;
  preparedOn: string;
  /** The business's own today, as an ISO date (the CSV carries it as is). */
  preparedOnIso: string;
  sections: ReportSection[];
};

const count = (label: string, value: number): ReportRow => ({ label, value, kind: "count" });
/** Money rows hold whole US dollars and cents: the report stores integer cents, the file shows dollars. */
const usd = (label: string, cents: number): ReportRow => ({ label, value: fromCents(cents), kind: "usd" });

export function buildReport(model: AnalyticsReport, modules: readonly ExportModuleId[], businessName: string): Report {
  const range = model.range;
  const builders: Record<ExportModuleId, () => ReportSection> = {
    summary: () => ({
      title: "Summary KPIs",
      rows: [
        count("Bookings", model.kpis.bookings),
        count("Jobs completed", model.kpis.completedJobs),
        usd("Quote value", model.kpis.quoteValueCents),
        usd("Invoiced", model.kpis.invoicedCents),
        usd("Payments received", model.kpis.paymentsReceivedCents),
      ],
    }),
    bookings: () => ({
      title: "Bookings",
      rows: [
        count("Confirmed", model.bookings.confirmed),
        count("Completed", model.bookings.completed),
        count("Pending confirmation", model.bookings.pending),
        count("Cancelled", model.bookings.cancelled),
        count("Total bookings", model.bookings.total),
      ],
    }),
    jobs: () => ({
      title: "Jobs",
      rows: [
        count("Completed", model.jobs.completed),
        count("Scheduled", model.jobs.scheduled),
        count("In progress", model.jobs.inProgress),
        count("Total jobs", model.jobs.total),
      ],
    }),
    financial: () => ({
      title: "Quotes & Invoices",
      rows: [
        count("Quotes approved", model.quotes.counts.approved),
        count("Quotes sent", model.quotes.counts.sent),
        count("Quotes draft", model.quotes.counts.draft),
        count("Quotes declined", model.quotes.counts.declined),
        count("Quotes expired", model.quotes.counts.expired),
        usd("Total quoted", model.quotes.totalValueCents),
        usd("Approved quote value", model.quotes.approvedValueCents),
        count("Invoices paid", model.invoices.counts.paid),
        count("Invoices unpaid", model.invoices.counts.unpaid),
        count("Invoices partially paid", model.invoices.counts["partially-paid"]),
        usd("Total invoiced", model.invoices.totalCents),
        usd("Outstanding balance", model.invoices.outstandingCents),
      ],
    }),
    payments: () => ({
      title: "Payments",
      rows: [
        count("Payments recorded", model.payments.recorded),
        usd("Amount received", model.payments.receivedCents),
        count("Voided payments", model.payments.voided.length),
      ],
    }),
    plans: () => ({
      title: "Maintenance Plans",
      rows: [
        count("Active plans", model.plans.active),
        count("Visits due", model.plans.visitsDue),
        count("Upcoming renewals", model.plans.renewals),
        count("Paused or ended", model.plans.pausedOrEnded),
      ],
    }),
  };

  return {
    title: "Climvia Analytics report",
    businessName,
    rangeText: formatRange(range.from, range.to),
    from: range.from,
    to: range.to,
    preparedOn: formatDate(model.today),
    preparedOnIso: model.today,
    // The order of the modules in the picker, whichever order they were ticked in.
    sections: EXPORT_MODULES.filter((module) => modules.includes(module.id)).map((module) => builders[module.id]()),
  };
}

const money = (value: number) => value.toFixed(2);
const csvCell = (value: string | number) => (/[",\r\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

/** Section, Metric, Value: one table a spreadsheet opens as it is. Money is plain US dollars, without symbols or commas. */
export function toCsv(report: Report): string {
  const rows: (string | number)[][] = [
    ["Section", "Metric", "Value"],
    ["Report", "Business", report.businessName],
    ["Report", "Date range", `${report.from} to ${report.to}`],
    ["Report", "Prepared on", report.preparedOnIso],
    ...report.sections.flatMap((section) =>
      section.rows.map((row): (string | number)[] => [section.title, row.kind === "usd" ? `${row.label} (USD)` : row.label, row.kind === "usd" ? money(row.value) : row.value]),
    ),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const usdText = (value: number) => `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

export function toPdf(report: Report): Uint8Array {
  const lines: PdfLine[] = [
    { text: report.title, style: "title" },
    { text: report.businessName, style: "body" },
    { text: `Date range: ${report.rangeText}`, style: "body" },
    { text: `Prepared on ${report.preparedOn}`, style: "muted" },
    { text: "" },
  ];
  for (const section of report.sections) {
    lines.push({ text: section.title, style: "heading" });
    for (const row of section.rows) {
      const value = row.kind === "usd" ? usdText(row.value) : String(row.value);
      lines.push({ text: row.label, value, style: "body" });
    }
    lines.push({ text: "" });
  }
  lines.push({ text: "Voided payments are not part of the amount received. Figures are those on screen when the report was made.", style: "muted" });
  return buildPdf(lines);
}

export const reportFileName = (report: Report, format: ExportFormat) => `climvia-analytics-${report.from}-to-${report.to}.${format}`;

/** Saves bytes as a file through the browser, with no request made. */
export function downloadFile(fileName: string, mimeType: string, data: string | Uint8Array): void {
  const blob = new Blob([data as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The browser has started the download by the time the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
