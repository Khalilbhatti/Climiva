/**
 * Analytics is a reading view. These checks pin its figures to the approved baselines, show that the parts that follow
 * the session read the shared selectors (so they cannot disagree with the owning modules), and exercise the date-range
 * rules and the report files without a browser.
 */
import { expect, test } from "playwright/test";
import {
  BOOKING_BREAKDOWN,
  EXPORT_MODULES,
  INVOICE_BASELINE_COUNTS,
  JOB_BREAKDOWN,
  QUOTE_BASELINE,
  SERVICE_ACTIVITY,
  WEEKLY_ACTIVITY,
} from "../src/data/analytics";
import { FINANCIALS, INVOICES, QUOTES, getInvoicesForQuote } from "../src/data/financials";
import { overviewMetrics } from "../src/data/fixtures";
import { PLANS_DATA, getPlanMetrics } from "../src/data/maintenance-plans";
import { OPERATIONS } from "../src/data/operations";
import { buildAnalytics, formatRange, hasActivity, isReportPeriod, resolveRange, validateCustomRange } from "../src/lib/analytics-state";
import { createInvoiceFromQuote, recordPayment, voidPayment } from "../src/lib/financial-state";
import { completeJob, startJob } from "../src/lib/operations-state";
import { buildReport, reportFileName, toCsv, toPdf } from "../src/lib/report-export";
import { SERVICES } from "./apex-data";

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const baseline = () => buildAnalytics(FINANCIALS, PLANS_DATA, OPERATIONS, SERVICES);

test.describe("approved baselines", () => {
  test("the aggregates add up to the Overview's totals", () => {
    expect(sum(Object.values(BOOKING_BREAKDOWN))).toBe(overviewMetrics.bookings);
    expect(JOB_BREAKDOWN.completed).toBe(overviewMetrics.completedJobs);
    expect(sum(Object.values(JOB_BREAKDOWN))).toBe(24);
    expect(sum(WEEKLY_ACTIVITY.map((week) => week.bookings))).toBe(overviewMetrics.bookings);
    expect(sum(WEEKLY_ACTIVITY.map((week) => week.completedJobs))).toBe(overviewMetrics.completedJobs);
    expect(sum(SERVICE_ACTIVITY.map((row) => row.bookings))).toBe(overviewMetrics.bookings);
    expect(sum(SERVICE_ACTIVITY.map((row) => row.completedJobs))).toBe(overviewMetrics.completedJobs);
    expect(sum(Object.values(INVOICE_BASELINE_COUNTS))).toBe(18);
  });

  test("the status breakdowns are the approved numbers", () => {
    expect(BOOKING_BREAKDOWN).toEqual({ confirmed: 14, completed: 6, pending: 2, cancelled: 2 });
    expect(JOB_BREAKDOWN).toEqual({ completed: 18, scheduled: 4, inProgress: 2 });
    expect(QUOTE_BASELINE.counts).toEqual({ approved: 5, sent: 3, draft: 2, declined: 1, expired: 1 });
    expect(QUOTE_BASELINE.totalValue).toBe(4820);
    expect(QUOTE_BASELINE.approvedValue).toBe(2975);
    expect(INVOICE_BASELINE_COUNTS).toEqual({ paid: 12, unpaid: 4, "partially-paid": 2 });
  });

  test("every Service in the table is a canonical catalog Service, listed once", () => {
    const ids = SERVICE_ACTIVITY.map((row) => row.serviceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(SERVICES.map((service) => service.id)).toContain(id);
  });

  test("at the canonical state the model equals the approved totals", () => {
    const model = baseline();
    expect(model.kpis).toEqual({ bookings: 24, completedJobs: 18, quoteValue: 4820, invoiced: 6240, paymentsReceived: 2130 });
    expect(model.bookings).toEqual({ total: 24, confirmed: 14, completed: 6, pending: 2, cancelled: 2 });
    expect(model.jobs).toEqual({ total: 24, completed: 18, scheduled: 4, inProgress: 2 });
    expect(model.quotes).toMatchObject({ count: 12, totalValue: 4820, approvedValue: 2975 });
    expect(model.invoices).toMatchObject({ count: 18, total: 6240, outstanding: 680, counts: { paid: 12, unpaid: 4, "partially-paid": 2 } });
    expect(model.payments).toMatchObject({ recorded: 7, received: 2130 });
    expect(model.payments.voided.map((payment) => payment.id)).toEqual(["PAY-1001"]);
    expect(model.plans).toMatchObject({ active: 14, visitsDue: 5, renewals: 3, pausedOrEnded: 2 });
  });

  test("the recent lists are records read from the shared stores", () => {
    const model = baseline();
    expect(model.recentCompletedJobs.map((job) => job.id)[0]).toBe("JB-204");
    expect(model.recentCompletedJobs.every((job) => job.status === "completed")).toBe(true);
    expect(model.recentBookings.every((booking) => booking.status !== "pending" && booking.date <= "2024-10-25")).toBe(true);
    expect(model.recentBookings).toHaveLength(5);
    expect(model.payments.recent.map((payment) => payment.id)).toEqual(["PAY-1008", "PAY-1007", "PAY-1006", "PAY-1005"]);
  });
});

test.describe("what follows the session", () => {
  test("a payment on INV-1050 moves received, recorded, outstanding and the invoice statuses together", () => {
    const { data } = recordPayment(FINANCIALS, { invoiceId: "INV-1050", amount: 300, method: "check", date: "2024-10-25" });
    const model = buildAnalytics(data, PLANS_DATA, OPERATIONS, SERVICES);
    expect(model.kpis.paymentsReceived).toBe(2430);
    expect(model.payments).toMatchObject({ recorded: 8, received: 2430 });
    expect(model.invoices.outstanding).toBe(380);
    expect(model.invoices.counts).toEqual({ paid: 13, unpaid: 4, "partially-paid": 1 });
    // The invoiced total and the count do not change when an existing invoice is paid.
    expect(model.invoices).toMatchObject({ total: 6240, count: 18 });
    expect(model.kpis.invoiced).toBe(6240);
  });

  test("an invoice created in the session is layered on $6,240 and adds one unpaid invoice", () => {
    const quote = QUOTES.find((item) => item.status === "approved" && getInvoicesForQuote(item.id).length === 0)!;
    const { data, invoice } = createInvoiceFromQuote(FINANCIALS, quote.id, { terms: "net-30" });
    expect(invoice).toBeDefined();
    const added = invoice!.lineItems.reduce((total, line) => total + line.quantity * line.rate, 0);
    const model = buildAnalytics(data, PLANS_DATA, OPERATIONS, SERVICES);
    expect(model.kpis.invoiced).toBeCloseTo(6240 + added, 2);
    expect(model.invoices.count).toBe(19);
    expect(model.invoices.counts.unpaid).toBe(INVOICE_BASELINE_COUNTS.unpaid + 1);
    expect(model.invoices.outstanding).toBeCloseTo(680 + added, 2);
    expect(INVOICES).not.toContain(invoice);
  });

  test("voiding a payment takes it out of received and adds it to the voided list", () => {
    const voided = voidPayment(FINANCIALS, "PAY-1005", "Entered by mistake");
    const model = buildAnalytics(voided, PLANS_DATA, OPERATIONS, SERVICES);
    expect(model.payments.recorded).toBe(6);
    expect(model.payments.received).toBe(2130 - 210);
    expect(model.payments.voided.map((payment) => payment.id).sort()).toEqual(["PAY-1001", "PAY-1005"]);
    expect(model.payments.recent.map((payment) => payment.id)).not.toContain("PAY-1005");
  });

  test("maintenance plans use the Maintenance Plans selector, so the two screens agree", () => {
    expect(baseline().plans).toEqual(getPlanMetrics(PLANS_DATA, OPERATIONS));
  });

  test("Bookings, Jobs, Quotes, the chart and the Service table are aggregates: working jobs does not move them", () => {
    const worked = completeJob(startJob(OPERATIONS, "JB-201"), "JB-201", "Done.");
    const model = buildAnalytics(FINANCIALS, PLANS_DATA, worked, SERVICES);
    const before = baseline();
    expect(model.kpis).toEqual(before.kpis);
    expect(model.bookings).toEqual(before.bookings);
    expect(model.jobs).toEqual(before.jobs);
    expect(model.weekly).toEqual(before.weekly);
    expect(model.services).toEqual(before.services);
    // The recent list is a record list, so it does follow the work.
    expect(model.recentCompletedJobs[0].id).toBe("JB-201");
  });

  test("the model never mutates the stores it reads", () => {
    const frozen = JSON.stringify({ FINANCIALS, PLANS_DATA, OPERATIONS });
    buildAnalytics(FINANCIALS, PLANS_DATA, OPERATIONS, SERVICES);
    expect(JSON.stringify({ FINANCIALS, PLANS_DATA, OPERATIONS })).toBe(frozen);
  });
});

test.describe("date ranges", () => {
  test("a missing or invalid range is this month, October 1 to 31, 2024", () => {
    for (const range of [resolveRange(null, null, null), resolveRange("nonsense", null, null), resolveRange("custom", "2024-13-40", "2024-10-31"), resolveRange("custom", "2024-10-31", "2024-10-01")]) {
      expect(range).toEqual({ id: "this-month", from: "2024-10-01", to: "2024-10-31" });
    }
  });

  test("presets and a valid custom range resolve to calendar dates", () => {
    expect(resolveRange("last-month", null, null)).toEqual({ id: "last-month", from: "2024-09-01", to: "2024-09-30" });
    expect(resolveRange("this-quarter", null, null)).toEqual({ id: "this-quarter", from: "2024-10-01", to: "2024-12-31" });
    expect(resolveRange("custom", "2024-11-15", "2024-11-20")).toEqual({ id: "custom", from: "2024-11-15", to: "2024-11-20" });
  });

  test("activity exists only where a range touches October 2024", () => {
    const has = (from: string, to: string) => hasActivity({ id: "custom", from, to });
    expect(has("2024-10-01", "2024-10-31")).toBe(true);
    expect(has("2024-09-20", "2024-10-01")).toBe(true);
    expect(has("2024-10-31", "2024-11-05")).toBe(true);
    expect(has("2024-10-15", "2024-10-16")).toBe(true);
    expect(has("2024-09-01", "2024-09-30")).toBe(false);
    expect(has("2024-11-01", "2024-12-01")).toBe(false);
    expect(has("2024-11-15", "2024-11-20")).toBe(false);
  });

  test("only the reporting period itself is exact; a wider or narrower range with activity is not", () => {
    expect(isReportPeriod({ id: "this-month", from: "2024-10-01", to: "2024-10-31" })).toBe(true);
    expect(isReportPeriod({ id: "this-quarter", from: "2024-10-01", to: "2024-12-31" })).toBe(false);
    expect(isReportPeriod({ id: "custom", from: "2024-10-15", to: "2024-10-16" })).toBe(false);
  });

  test("a custom range needs two real dates in order", () => {
    expect(validateCustomRange("2024-10-01", "2024-10-31")).toBeUndefined();
    expect(validateCustomRange("2024-10-01", "2024-10-01")).toBeUndefined();
    expect(validateCustomRange("", "2024-10-31")).toMatch(/start date and an end date/);
    expect(validateCustomRange("2024-10-31", "2024-10-01")).toMatch(/on or after the start date/);
  });

  test("a range is written as 'Oct 1 – Oct 31, 2024', and across years with both ends in full", () => {
    expect(formatRange("2024-10-01", "2024-10-31")).toBe("Oct 1 – Oct 31, 2024");
    expect(formatRange("2024-12-20", "2025-01-05")).toBe("Dec 20, 2024 – Jan 5, 2025");
  });
});

test.describe("report files", () => {
  const range = resolveRange(null, null, null);
  const all = EXPORT_MODULES.map((module) => module.id);

  test("the report holds only the chosen modules, in the picker's order", () => {
    const report = buildReport(baseline(), ["payments", "summary"], range, "Apex Climate Heating & Air");
    expect(report.sections.map((section) => section.title)).toEqual(["Summary KPIs", "Payments"]);
    expect(report.rangeText).toBe("Oct 1 – Oct 31, 2024");
    expect(buildReport(baseline(), [], range, "x").sections).toEqual([]);
  });

  test("the CSV is one Section, Metric, Value table with plain numbers", () => {
    const csv = toCsv(buildReport(baseline(), all, range, "Apex Climate Heating & Air"));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Section,Metric,Value");
    expect(lines).toContain("Report,Business,Apex Climate Heating & Air");
    expect(lines).toContain("Report,Date range,2024-10-01 to 2024-10-31");
    expect(lines).toContain("Summary KPIs,Bookings,24");
    expect(lines).toContain("Summary KPIs,Jobs completed,18");
    expect(lines).toContain("Summary KPIs,Invoiced (USD),6240.00");
    expect(lines).toContain("Payments,Amount received (USD),2130.00");
    expect(lines).toContain("Payments,Voided payments,1");
    expect(lines).toContain("Quotes & Invoices,Invoices partially paid,2");
    expect(lines).toContain("Maintenance Plans,Active plans,14");
    expect(csv).not.toContain("$");
  });

  test("a CSV cell with a comma or a quote is quoted", () => {
    const csv = toCsv(buildReport(baseline(), ["summary"], range, 'Apex, "Heating" & Air'));
    expect(csv).toContain('"Apex, ""Heating"" & Air"');
  });

  test("the file name carries the range and the format", () => {
    const report = buildReport(baseline(), all, range, "x");
    expect(reportFileName(report, "csv")).toBe("climvia-analytics-2024-10-01-to-2024-10-31.csv");
    expect(reportFileName(report, "pdf")).toBe("climvia-analytics-2024-10-01-to-2024-10-31.pdf");
  });

  test("the PDF is a well-formed document: header, trailer, and a cross-reference table that points at every object", () => {
    const bytes = toPdf(buildReport(baseline(), all, range, "Apex Climate Heating & Air"));
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);

    const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const size = Number(/\/Size (\d+)/.exec(text)![1]);
    const entries = text.slice(startxref).split("\n").slice(3, 3 + size - 1);
    expect(entries).toHaveLength(size - 1);
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length), `object ${index + 1}`).toBe(`${index + 1} 0 obj`);
    });
  });

  test("the PDF says what the CSV says", () => {
    const text = Buffer.from(toPdf(buildReport(baseline(), all, range, "Apex Climate Heating & Air"))).toString("latin1");
    for (const phrase of ["Climvia Analytics report", "Apex Climate Heating & Air", "Date range: Oct 1 - Oct 31, 2024", "Summary KPIs", "$6,240.00", "$2,130.00", "Voided payments", "Maintenance Plans"]) {
      expect(text, phrase).toContain(phrase.replace(/[\\()]/g, (char) => `\\${char}`));
    }
  });

  test("a long report continues onto a second page", () => {
    const bytes = toPdf({ ...buildReport(baseline(), all, range, "x"), sections: Array.from({ length: 6 }, (_, index) => ({ title: `Section ${index}`, rows: Array.from({ length: 8 }, (__, row) => ({ label: `Row ${row}`, value: row, kind: "count" as const })) })) });
    const text = Buffer.from(bytes).toString("latin1");
    expect(Number(/\/Count (\d+)/.exec(text)![1])).toBeGreaterThan(1);
  });
});
