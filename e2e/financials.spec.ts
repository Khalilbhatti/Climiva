import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { CUSTOMERS, getCustomerById, getPropertyById } from "../src/data/customers";
import {
  FINANCIALS,
  INVOICES,
  PAYMENTS,
  QUOTES,
  getInvoiceBalance,
  getInvoiceById,
  getInvoicePaid,
  getInvoiceStatus,
  getInvoiceTotal,
  getInvoicesForQuote,
  getOutstandingBalance,
  getOutstandingInvoices,
  getPaymentById,
  getPaymentsForInvoice,
  getPaymentsReceivedTotal,
  getQuoteById,
  getQuoteTotal,
  getRecordedPaymentsCount,
  getTotalInvoiced,
  type FinancialData,
} from "../src/data/financials";
import { overviewMetrics } from "../src/data/fixtures";
import { getBookingById, getJobById, getPartyName } from "../src/data/operations";
import { getServiceById } from "../src/data/services";
import { getTeamMemberById } from "../src/data/team";
import { createInvoiceFromQuote, recordPayment, voidPayment } from "../src/lib/financial-state";

// Pure data/selector/state tests: no browser needed.

const snapshot = () => JSON.stringify(FINANCIALS);
const pay = (data: FinancialData, invoiceId: string, amount: number) =>
  recordPayment(data, { invoiceId, amount, method: "check", date: "2024-10-25" });

test.describe("canonical financial baseline (post-#PAY-1008)", () => {
  test("payments recorded = 7 and amount received = $2,130; the voided payment contributes nothing", () => {
    expect(getRecordedPaymentsCount()).toBe(7);
    expect(getPaymentsReceivedTotal()).toBe(2130);
    expect(PAYMENTS).toHaveLength(8);

    const voided = getPaymentById("PAY-1001")!;
    expect(voided).toMatchObject({ status: "voided", amount: 285, invoiceId: "INV-1044" });
    expect(voided.void).toMatchObject({ reason: "Payment entered by mistake", by: "alex-morgan" });
    // The same total with the voided record removed: it never counted.
    expect(getPaymentsReceivedTotal({ ...FINANCIALS, payments: PAYMENTS.filter((payment) => payment.id !== "PAY-1001") })).toBe(2130);
  });

  test("outstanding invoices are exactly INV-1050 ($300) and INV-1051 ($380): 2 invoices, $680", () => {
    const outstanding = getOutstandingInvoices();
    expect(outstanding.map((invoice) => invoice.id)).toEqual(["INV-1050", "INV-1051"]);
    expect(getOutstandingBalance()).toBe(680);

    const arthur = getInvoiceById("INV-1050")!;
    expect(getPartyName(arthur)).toBe("Arthur Pendleton");
    expect([getInvoiceTotal(arthur), getInvoicePaid(arthur), getInvoiceBalance(arthur), getInvoiceStatus(arthur)]).toEqual([500, 200, 300, "partially-paid"]);

    const maya = getInvoiceById("INV-1051")!;
    expect(getPartyName(maya)).toBe("Maya Lin");
    expect([getInvoiceTotal(maya), getInvoicePaid(maya), getInvoiceBalance(maya), getInvoiceStatus(maya)]).toEqual([380, 0, 380, "unpaid"]);
  });

  test("INV-1044 is fully paid by PAY-1008 and never offered for payment", () => {
    const invoice = getInvoiceById("INV-1044")!;
    expect(getPartyName(invoice)).toBe("Sarah Mitchell");
    expect([getInvoiceTotal(invoice), getInvoicePaid(invoice), getInvoiceBalance(invoice), getInvoiceStatus(invoice)]).toEqual([285, 285, 0, "paid"]);
    expect(getPaymentsForInvoice("INV-1044").map((payment) => [payment.id, payment.status])).toEqual([
      ["PAY-1008", "recorded"],
      ["PAY-1001", "voided"],
    ]);
    expect(getOutstandingInvoices().some((item) => item.id === "INV-1044")).toBe(false);
    // Payments can't be piled onto a paid invoice either.
    expect(pay(FINANCIALS, "INV-1044", 10).payment).toBeUndefined();
  });

  test("every other invoice is paid in full by its single payment", () => {
    for (const invoice of INVOICES.filter((item) => !["INV-1050", "INV-1051"].includes(item.id))) {
      expect(getInvoiceStatus(invoice), invoice.id).toBe("paid");
    }
    expect(INVOICES).toHaveLength(9);
  });

  test("the Overview totals are derived and equal the approved baseline", () => {
    expect(getPaymentsReceivedTotal()).toBe(overviewMetrics.paymentsReceived);
    expect(getRecordedPaymentsCount()).toBe(overviewMetrics.recordedPayments);
    expect(getTotalInvoiced()).toBe(overviewMetrics.totalInvoiced);
  });
});

test.describe("financial records reference the shared records", () => {
  test("customers, properties, services, jobs, bookings and team members all resolve", () => {
    for (const record of [...QUOTES, ...INVOICES]) {
      expect(Boolean(record.customerId) !== Boolean(record.contactName), `${record.id}: customerId xor contactName`).toBe(true);
      if (record.customerId) expect(getCustomerById(record.customerId), `${record.id}: customer`).toBeDefined();
      if (record.propertyId) expect(getPropertyById(record.propertyId)?.customerId, `${record.id}: property`).toBe(record.customerId);
      if (record.serviceId) expect(getServiceById(record.serviceId), `${record.id}: service`).toBeDefined();
      if (record.jobId) expect(getJobById(record.jobId), `${record.id}: job`).toBeDefined();
      if (record.bookingId) expect(getBookingById(record.bookingId), `${record.id}: booking`).toBeDefined();
    }
    for (const invoice of INVOICES) if (invoice.quoteId) expect(getQuoteById(invoice.quoteId), invoice.id).toBeDefined();
    for (const payment of PAYMENTS) {
      expect(getInvoiceById(payment.invoiceId), payment.id).toBeDefined();
      expect(getTeamMemberById(payment.recordedBy), payment.id).toBeDefined();
    }
  });

  test("Sarah's quote, invoice and payments share her canonical customer, property, job and booking", () => {
    const quote = getQuoteById("QT-884")!;
    const invoice = getInvoiceById("INV-1044")!;
    for (const record of [quote, invoice]) {
      expect(record).toMatchObject({ customerId: "sarah-mitchell", propertyId: "prop-sarah-home", jobId: "JB-204", bookingId: "BK-1042" });
    }
    expect(getJobById("JB-204")!.customerId).toBe("sarah-mitchell");
    expect(getQuoteTotal(quote)).toBe(285);
    expect(getInvoiceTotal(invoice)).toBe(285);
    expect(getPartyName(getInvoiceById("INV-1048")!)).toBe("Elena Rodriguez");
    expect(JSON.stringify(FINANCIALS)).not.toContain("Rostova");
  });

  test("people without a Customers record are snapshots, not invented customers", () => {
    const names = INVOICES.filter((invoice) => invoice.contactName).map((invoice) => invoice.contactName);
    expect(names).toEqual(["Kevin Vance", "Amanda Diaz", "Marcus Bell", "Robert Miller", "Arthur Pendleton", "Maya Lin"]);
    for (const name of names) expect(CUSTOMERS.some((customer) => customer.name === name)).toBe(false);
  });

  test("QT-884 is approved and has no invoice yet; the other quotes keep their statuses", () => {
    expect(getQuoteById("QT-884")!.status).toBe("approved");
    expect(getInvoicesForQuote("QT-884")).toEqual([]);
    expect(QUOTES.map((quote) => [quote.id, quote.status])).toEqual([
      ["QT-884", "approved"],
      ["QT-891", "sent"],
      ["QT-893", "draft"],
      ["QT-879", "declined"],
    ]);
  });
});

test.describe("record payment (state transition)", () => {
  test("a full $300 payment on INV-1050 creates PAY-1009 and reconciles every total", () => {
    const before = snapshot();
    const { data, payment } = pay(FINANCIALS, "INV-1050", 300);

    expect(payment).toMatchObject({ id: "PAY-1009", invoiceId: "INV-1050", amount: 300, status: "recorded", method: "check" });
    const invoice = getInvoiceById("INV-1050", data)!;
    expect([getInvoiceBalance(invoice, data), getInvoiceStatus(invoice, data)]).toEqual([0, "paid"]);

    expect(getRecordedPaymentsCount(data)).toBe(8);
    expect(getPaymentsReceivedTotal(data)).toBe(2430);
    expect(getOutstandingInvoices(data).map((item) => item.id)).toEqual(["INV-1051"]);
    expect(getOutstandingBalance(data)).toBe(380);

    // Nothing historical moves.
    expect(getPaymentById("PAY-1008", data)).toEqual(getPaymentById("PAY-1008"));
    expect(getPaymentById("PAY-1001", data)).toMatchObject({ status: "voided" });
    expect(getInvoiceStatus(getInvoiceById("INV-1044", data)!, data)).toBe("paid");
    expect(getInvoiceBalance(getInvoiceById("INV-1051", data)!, data)).toBe(380);
    expect(getPaymentsReceivedTotal(data)).toBe(overviewMetrics.paymentsReceived + 300);
    expect(snapshot()).toBe(before);
  });

  test("a partial payment leaves the invoice partially paid and outstanding", () => {
    const { data, payment } = pay(FINANCIALS, "INV-1051", 100);
    expect(payment?.id).toBe("PAY-1009");
    const invoice = getInvoiceById("INV-1051", data)!;
    expect([getInvoiceBalance(invoice, data), getInvoiceStatus(invoice, data)]).toEqual([280, "partially-paid"]);
    expect(getOutstandingInvoices(data)).toHaveLength(2);
    expect(getOutstandingBalance(data)).toBe(580);
    expect(getPaymentsReceivedTotal(data)).toBe(2230);
  });

  test("invalid amounts are refused and change nothing", () => {
    for (const amount of [0, -5, 300.01, Number.NaN]) {
      const result = pay(FINANCIALS, "INV-1050", amount);
      expect(result.payment, `amount ${amount}`).toBeUndefined();
      expect(result.data).toBe(FINANCIALS);
    }
    expect(pay(FINANCIALS, "INV-9999", 10).payment).toBeUndefined();
  });

  test("a second payment cannot exceed what is left, and payments get consecutive numbers", () => {
    const first = pay(FINANCIALS, "INV-1050", 100);
    expect(pay(first.data, "INV-1050", 200.01).payment).toBeUndefined();
    const second = pay(first.data, "INV-1050", 200);
    expect(second.payment?.id).toBe("PAY-1010");
    expect(getInvoiceStatus(getInvoiceById("INV-1050", second.data)!, second.data)).toBe("paid");
  });

  test("record never touches invoices, quotes or the voided record, and creates no invoice", () => {
    const { data } = pay(FINANCIALS, "INV-1050", 300);
    expect(data.invoices).toBe(FINANCIALS.invoices);
    expect(data.quotes).toBe(FINANCIALS.quotes);
    expect(data.payments).toHaveLength(PAYMENTS.length + 1);
  });
});

test.describe("void payment (separate, historical flow)", () => {
  test("voiding PAY-1008 reopens INV-1044 and restores the earlier totals; it creates no payment", () => {
    const before = snapshot();
    const data = voidPayment(FINANCIALS, "PAY-1008", "Duplicate payment", "  entered twice ");

    expect(getPaymentById("PAY-1008", data)).toMatchObject({ status: "voided", void: { reason: "Duplicate payment", by: "alex-morgan", note: "entered twice" } });
    const invoice = getInvoiceById("INV-1044", data)!;
    expect([getInvoiceBalance(invoice, data), getInvoiceStatus(invoice, data)]).toEqual([285, "unpaid"]);
    expect(getRecordedPaymentsCount(data)).toBe(6);
    expect(getPaymentsReceivedTotal(data)).toBe(1845);
    expect(getOutstandingInvoices(data).map((item) => item.id)).toEqual(["INV-1044", "INV-1050", "INV-1051"]);
    expect(getOutstandingBalance(data)).toBe(965);

    expect(data.payments).toHaveLength(PAYMENTS.length); // no new payment, so no PAY-1009
    expect(data.payments.some((payment) => payment.id === "PAY-1009")).toBe(false);
    expect(snapshot()).toBe(before);
  });

  test("voiding does nothing to a payment that is already voided, and PAY-1001 stays historical", () => {
    expect(voidPayment(FINANCIALS, "PAY-1001", "Other").payments).toEqual(PAYMENTS);
    expect(getPaymentById("PAY-1001")!.void?.on).toBe("2024-10-25");
  });

  test("a payment recorded after a void is numbered after the existing records", () => {
    const voided = voidPayment(FINANCIALS, "PAY-1008", "Incorrect amount");
    const { payment } = pay(voided, "INV-1044", 285);
    expect(payment?.id).toBe("PAY-1009");
  });
});

test.describe("create invoice from an approved quote", () => {
  test("QT-884 becomes unpaid INV-1052 for the same customer, job and line items, with no payment", () => {
    const before = snapshot();
    const { data, invoice } = createInvoiceFromQuote(FINANCIALS, "QT-884", { terms: "net-15", message: " Thank you. " });

    expect(invoice).toMatchObject({
      id: "INV-1052",
      quoteId: "QT-884",
      customerId: "sarah-mitchell",
      propertyId: "prop-sarah-home",
      jobId: "JB-204",
      bookingId: "BK-1042",
      terms: "net-15",
      message: "Thank you.",
      date: "2024-10-25",
    });
    expect(getInvoiceTotal(invoice!)).toBe(285);
    expect(getInvoiceStatus(invoice!, data)).toBe("unpaid");
    expect(getInvoicesForQuote("QT-884", data)).toHaveLength(1);

    // No payment is created and the quote is untouched; the new invoice is simply outstanding.
    expect(data.payments).toBe(FINANCIALS.payments);
    expect(data.quotes).toBe(FINANCIALS.quotes);
    expect(getRecordedPaymentsCount(data)).toBe(7);
    expect(getOutstandingInvoices(data).map((item) => item.id)).toEqual(["INV-1050", "INV-1051", "INV-1052"]);
    expect(getOutstandingBalance(data)).toBe(965);
    expect(getTotalInvoiced(data)).toBe(overviewMetrics.totalInvoiced + 285);
    expect(snapshot()).toBe(before);
  });

  test("an invoice can't be created twice, or from a quote that isn't approved", () => {
    const { data } = createInvoiceFromQuote(FINANCIALS, "QT-884", { terms: "due-on-receipt" });
    expect(createInvoiceFromQuote(data, "QT-884", { terms: "due-on-receipt" }).invoice).toBeUndefined();
    for (const quoteId of ["QT-891", "QT-893", "QT-879", "QT-000"]) {
      expect(createInvoiceFromQuote(FINANCIALS, quoteId, { terms: "due-on-receipt" }).invoice, quoteId).toBeUndefined();
    }
  });

  test("the new invoice can be paid like any other", () => {
    const created = createInvoiceFromQuote(FINANCIALS, "QT-884", { terms: "due-on-receipt" });
    const { data, payment } = pay(created.data, "INV-1052", 285);
    expect(payment?.id).toBe("PAY-1009");
    expect(getInvoiceStatus(getInvoiceById("INV-1052", data)!, data)).toBe("paid");
  });
});

test.describe("source guardrails (financials)", () => {
  const PROHIBITED = [
    "Elena Rostova",
    "ledger",
    "dispatch",
    "telemetry",
    "fleet",
    "GPS tracking",
    "reconciliation engine",
    "accounting sync",
    "payment gateway",
    "AI scheduling",
    "technician performance score",
    "Stripe",
    "settlement",
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?|css|md)$/.test(entry) ? [path] : [];
    });
  }

  test("production source contains none of the prohibited financial or operational concepts", () => {
    const hits: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const phrase of PROHIBITED) if (text.includes(phrase.toLowerCase())) hits.push(`${file}: ${phrase}`);
    }
    expect(hits).toEqual([]);
  });

  test("financial code never reads the real clock or the browser's timezone", () => {
    const files = [...sourceFiles("src/components/financials"), ...sourceFiles("src/components/team"), "src/data/financials.ts", "src/data/team.ts", "src/lib/financial-state.ts", "src/lib/team-state.ts"];
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [/new Date\(\s*\)/, /Date\.now\(/, /Intl\.DateTimeFormat/, /toLocale(Date|Time)?String/, /getTimezoneOffset/]) {
        if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
