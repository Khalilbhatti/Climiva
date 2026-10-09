import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { getCustomerById, getPropertyById } from "../src/data/customers";
import {
  getBalanceAfter,
  getCustomerFinancials,
  getInvoiceAfterVoid,
  getInvoiceBalance,
  getInvoiceById,
  getInvoicePaid,
  getInvoiceRecorded,
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
} from "../src/data/financials";
import { overviewMetrics } from "../src/data/fixtures";
import { getBookingById, getJobById, getPartyName } from "../src/data/operations";
import { getServiceById } from "../src/data/services";
import { getTeamMemberById } from "../src/data/team";
import { BOOK, CUSTOMERS, DIR, FINANCIALS, INVOICES, OPERATIONS, PAYMENTS, QUOTES, SERVICES, TEAM_DATA } from "./apex-data";
import { withInvoiceFromQuote, withPayment, withVoid } from "./financial-edits";

// Pure data/selector tests: no browser needed. What recording, voiding and invoicing DO (they happen on the server, in PostgreSQL) is
// tested in financials-database.spec.ts and financials-flows.spec.ts; here the selectors are asked what the figures are for given records.

const snapshot = () => JSON.stringify(FINANCIALS);

test.describe("canonical financial baseline (post-#PAY-1008)", () => {
  test("payments recorded = 7 and amount received = $2,130; the voided payment contributes nothing", () => {
    expect(getRecordedPaymentsCount(FINANCIALS)).toBe(7);
    expect(getPaymentsReceivedTotal(FINANCIALS)).toBe(2130);
    expect(PAYMENTS).toHaveLength(8);

    const voided = getPaymentById("PAY-1001", FINANCIALS)!;
    expect(voided).toMatchObject({ status: "voided", amount: 285, invoiceId: "INV-1044" });
    expect(voided.void).toMatchObject({ reason: "Payment entered by mistake", by: "alex-morgan" });
    // The same total with the voided record removed: it never counted.
    expect(getPaymentsReceivedTotal({ ...FINANCIALS, payments: PAYMENTS.filter((payment) => payment.id !== "PAY-1001") })).toBe(2130);
  });

  test("outstanding invoices are exactly INV-1050 ($300) and INV-1051 ($380): 2 invoices, $680", () => {
    const outstanding = getOutstandingInvoices(FINANCIALS);
    expect(outstanding.map((invoice) => invoice.id)).toEqual(["INV-1050", "INV-1051"]);
    expect(getOutstandingBalance(FINANCIALS)).toBe(680);

    const arthur = getInvoiceById("INV-1050", FINANCIALS)!;
    expect(getPartyName(arthur, DIR)).toBe("Arthur Pendleton");
    const figures = (invoice: typeof arthur) => [getInvoiceTotal(invoice), getInvoicePaid(invoice, FINANCIALS), getInvoiceBalance(invoice, FINANCIALS), getInvoiceStatus(invoice, FINANCIALS)];
    expect(figures(arthur)).toEqual([500, 200, 300, "partially-paid"]);
    // The $200 is carried on the invoice, not invented as a payment: there is no recorded payment behind it.
    expect(getInvoiceRecorded(arthur, FINANCIALS)).toBe(0);
    expect(getPaymentsForInvoice("INV-1050", FINANCIALS)).toEqual([]);

    const maya = getInvoiceById("INV-1051", FINANCIALS)!;
    expect(getPartyName(maya, DIR)).toBe("Maya Lin");
    expect(figures(maya)).toEqual([380, 0, 380, "unpaid"]);
  });

  test("INV-1044 is fully paid by PAY-1008 and never offered for payment", () => {
    const invoice = getInvoiceById("INV-1044", FINANCIALS)!;
    expect(getPartyName(invoice, DIR)).toBe("Sarah Mitchell");
    expect([getInvoiceTotal(invoice), getInvoicePaid(invoice, FINANCIALS), getInvoiceBalance(invoice, FINANCIALS), getInvoiceStatus(invoice, FINANCIALS)]).toEqual([285, 285, 0, "paid"]);
    expect(getPaymentsForInvoice("INV-1044", FINANCIALS).map((payment) => [payment.id, payment.status])).toEqual([
      ["PAY-1008", "recorded"],
      ["PAY-1001", "voided"],
    ]);
    expect(getOutstandingInvoices(FINANCIALS).some((item) => item.id === "INV-1044")).toBe(false);
    // The invoice is not linked to QT-884 (the source contradicted itself; the link is not restored).
    expect(invoice.quoteId).toBeUndefined();
  });

  test("every other invoice is paid in full by its single payment", () => {
    for (const invoice of INVOICES.filter((item) => !["INV-1050", "INV-1051"].includes(item.id))) {
      expect(getInvoiceStatus(invoice, FINANCIALS), invoice.id).toBe("paid");
    }
    expect(INVOICES).toHaveLength(9);
  });

  test("the Overview totals are derived and equal the approved baseline", () => {
    expect(getPaymentsReceivedTotal(FINANCIALS)).toBe(overviewMetrics.paymentsReceived);
    expect(getRecordedPaymentsCount(FINANCIALS)).toBe(overviewMetrics.recordedPayments);
    expect(getTotalInvoiced(FINANCIALS)).toBe(overviewMetrics.totalInvoiced);
  });

  test("Total Invoiced is the $6,240 reporting baseline: the canonical invoices are inside it, a new invoice is added to it", () => {
    expect(INVOICES.every((invoice) => invoice.imported)).toBe(true);
    // The nine canonical invoices add up to less than the baseline, which covers more invoicing history than these records.
    expect(INVOICES.reduce((total, invoice) => total + getInvoiceTotal(invoice), 0)).toBeLessThan(overviewMetrics.totalInvoiced);
    const { data, invoice } = withInvoiceFromQuote(FINANCIALS, "QT-884");
    expect(getTotalInvoiced(data)).toBe(overviewMetrics.totalInvoiced + getInvoiceTotal(invoice));
  });
});

test.describe("financial records reference the shared records", () => {
  test("customers, properties, services, jobs, bookings and team members all resolve", () => {
    for (const record of [...QUOTES, ...INVOICES]) {
      expect(Boolean(record.customerId) !== Boolean(record.contactName), `${record.id}: customerId xor contactName`).toBe(true);
      if (record.customerId) expect(getCustomerById(record.customerId, BOOK), `${record.id}: customer`).toBeDefined();
      if (record.propertyId) expect(getPropertyById(record.propertyId, BOOK)?.customerId, `${record.id}: property`).toBe(record.customerId);
      if (record.serviceId) expect(getServiceById(record.serviceId, SERVICES), `${record.id}: service`).toBeDefined();
      if (record.jobId) expect(getJobById(record.jobId, OPERATIONS), `${record.id}: job`).toBeDefined();
      if (record.bookingId) expect(getBookingById(record.bookingId, OPERATIONS), `${record.id}: booking`).toBeDefined();
    }
    for (const invoice of INVOICES) if (invoice.quoteId) expect(getQuoteById(invoice.quoteId, FINANCIALS), invoice.id).toBeDefined();
    for (const payment of PAYMENTS) {
      expect(getInvoiceById(payment.invoiceId, FINANCIALS), payment.id).toBeDefined();
      expect(getTeamMemberById(payment.recordedBy, TEAM_DATA), payment.id).toBeDefined();
    }
  });

  test("Sarah's quote, invoice and payments share her canonical customer, property, job and booking", () => {
    const quote = getQuoteById("QT-884", FINANCIALS)!;
    const invoice = getInvoiceById("INV-1044", FINANCIALS)!;
    for (const record of [quote, invoice]) {
      expect(record).toMatchObject({ customerId: "sarah-mitchell", propertyId: "prop-sarah-home", jobId: "JB-204", bookingId: "BK-1042" });
    }
    expect(getJobById("JB-204", OPERATIONS)!.customerId).toBe("sarah-mitchell");
    expect(getQuoteTotal(quote)).toBe(285);
    expect(getInvoiceTotal(invoice)).toBe(285);
    expect(getPartyName(getInvoiceById("INV-1048", FINANCIALS)!, DIR)).toBe("Elena Rodriguez");
    expect(JSON.stringify(FINANCIALS)).not.toContain("Rostova");
  });

  test("people without a Customers record are snapshots, not invented customers", () => {
    const names = INVOICES.filter((invoice) => invoice.contactName).map((invoice) => invoice.contactName);
    expect(names).toEqual(["Kevin Vance", "Amanda Diaz", "Marcus Bell", "Robert Miller", "Arthur Pendleton", "Maya Lin"]);
    for (const name of names) expect(CUSTOMERS.some((customer) => customer.name === name)).toBe(false);
  });

  test("QT-884 is approved and has no invoice yet; the other quotes keep their statuses", () => {
    expect(getQuoteById("QT-884", FINANCIALS)!.status).toBe("approved");
    expect(getInvoicesForQuote("QT-884", FINANCIALS)).toEqual([]);
    expect(QUOTES.map((quote) => [quote.id, quote.status])).toEqual([
      ["QT-884", "approved"],
      ["QT-891", "sent"],
      ["QT-893", "draft"],
      ["QT-879", "declined"],
    ]);
  });

  test("a customer's financial history is their own quotes, invoices and the payments on those invoices", () => {
    const sarah = getCustomerFinancials("sarah-mitchell", FINANCIALS);
    expect(sarah.quotes.map((quote) => quote.id)).toEqual(["QT-884"]);
    expect(sarah.invoices.map((invoice) => invoice.id)).toEqual(["INV-1044"]);
    expect(sarah.payments.map((payment) => [payment.id, payment.status])).toEqual([
      ["PAY-1008", "recorded"],
      ["PAY-1001", "voided"],
    ]);
    expect(getCustomerFinancials("a-customer-without-records", FINANCIALS)).toEqual({ quotes: [], invoices: [], payments: [] });
  });
});

test.describe("what the selectors answer once a payment is recorded", () => {
  test("a full $300 payment on INV-1050 reconciles every total", () => {
    const before = snapshot();
    const { data, payment } = withPayment(FINANCIALS, "INV-1050", 300);

    expect(payment.id).toBe("PAY-1009");
    const invoice = getInvoiceById("INV-1050", data)!;
    expect([getInvoiceBalance(invoice, data), getInvoiceStatus(invoice, data)]).toEqual([0, "paid"]);

    expect(getRecordedPaymentsCount(data)).toBe(8);
    expect(getPaymentsReceivedTotal(data)).toBe(2430);
    expect(getOutstandingInvoices(data).map((item) => item.id)).toEqual(["INV-1051"]);
    expect(getOutstandingBalance(data)).toBe(380);

    // Nothing historical moves.
    expect(getPaymentById("PAY-1008", data)).toEqual(getPaymentById("PAY-1008", FINANCIALS));
    expect(getPaymentById("PAY-1001", data)).toMatchObject({ status: "voided" });
    expect(getInvoiceStatus(getInvoiceById("INV-1044", data)!, data)).toBe("paid");
    expect(getInvoiceBalance(getInvoiceById("INV-1051", data)!, data)).toBe(380);
    expect(getPaymentsReceivedTotal(data)).toBe(overviewMetrics.paymentsReceived + 300);
    expect(snapshot()).toBe(before);
  });

  test("a partial payment leaves the invoice partially paid and outstanding", () => {
    const { data } = withPayment(FINANCIALS, "INV-1051", 100);
    const invoice = getInvoiceById("INV-1051", data)!;
    expect([getInvoiceBalance(invoice, data), getInvoiceStatus(invoice, data)]).toEqual([280, "partially-paid"]);
    expect(getOutstandingInvoices(data)).toHaveLength(2);
    expect(getOutstandingBalance(data)).toBe(580);
    expect(getPaymentsReceivedTotal(data)).toBe(2230);
    // The Record payment screen shows the balance after before it is recorded.
    expect(getBalanceAfter(getInvoiceById("INV-1051", FINANCIALS)!, FINANCIALS, 100)).toBe(280);
    expect(getBalanceAfter(getInvoiceById("INV-1051", FINANCIALS)!, FINANCIALS, 380)).toBe(0);
  });

  test("two payments make a paid invoice, and cents add up exactly (no float drift)", () => {
    const first = withPayment(FINANCIALS, "INV-1050", 100.1);
    const second = withPayment(first.data, "INV-1050", 199.9);
    expect(second.payment.id).toBe("PAY-1010");
    const invoice = getInvoiceById("INV-1050", second.data)!;
    expect([getInvoiceRecorded(invoice, second.data), getInvoiceBalance(invoice, second.data), getInvoiceStatus(invoice, second.data)]).toEqual([300, 0, "paid"]);
    expect(getPaymentsReceivedTotal(second.data)).toBe(2430);
  });
});

test.describe("what the selectors answer once a payment is voided", () => {
  test("voiding PAY-1008 reopens INV-1044 and restores the earlier totals; it creates no payment", () => {
    const before = snapshot();
    const data = withVoid(FINANCIALS, "PAY-1008");

    expect(getPaymentById("PAY-1008", data)).toMatchObject({ status: "voided" });
    const invoice = getInvoiceById("INV-1044", data)!;
    expect([getInvoiceBalance(invoice, data), getInvoiceStatus(invoice, data)]).toEqual([285, "unpaid"]);
    expect(getRecordedPaymentsCount(data)).toBe(6);
    expect(getPaymentsReceivedTotal(data)).toBe(1845);
    expect(getOutstandingInvoices(data).map((item) => item.id)).toEqual(["INV-1044", "INV-1050", "INV-1051"]);
    expect(getOutstandingBalance(data)).toBe(965);

    expect(data.payments).toHaveLength(PAYMENTS.length); // no new payment
    expect(snapshot()).toBe(before);
  });

  test("the Void payment screen's preview is what voiding then gives", () => {
    const invoice = getInvoiceById("INV-1044", FINANCIALS)!;
    const payment = getPaymentById("PAY-1008", FINANCIALS)!;
    const preview = getInvoiceAfterVoid(invoice, payment, FINANCIALS);
    const after = withVoid(FINANCIALS, "PAY-1008");
    expect(preview).toEqual({ paid: getInvoicePaid(getInvoiceById("INV-1044", after)!, after), balance: getInvoiceBalance(getInvoiceById("INV-1044", after)!, after), status: "unpaid" });
  });

  test("a voided payment is already out of the figures: previewing its void changes nothing", () => {
    const invoice = getInvoiceById("INV-1044", FINANCIALS)!;
    const voided = getPaymentById("PAY-1001", FINANCIALS)!;
    expect(getInvoiceAfterVoid(invoice, voided, FINANCIALS)).toEqual({ paid: 285, balance: 0, status: "paid" });
    expect(voided.void?.on).toBe("2024-10-25");
  });
});

test.describe("what the selectors answer once an invoice is made from a quote", () => {
  test("QT-884 becomes an unpaid invoice for the same customer, job and line items, with no payment", () => {
    const before = snapshot();
    const { data, invoice } = withInvoiceFromQuote(FINANCIALS, "QT-884", "net-15");

    expect(invoice).toMatchObject({ id: "INV-1052", quoteId: "QT-884", customerId: "sarah-mitchell", propertyId: "prop-sarah-home", jobId: "JB-204", bookingId: "BK-1042", terms: "net-15" });
    expect(getInvoiceTotal(invoice)).toBe(285);
    expect(getInvoiceStatus(invoice, data)).toBe("unpaid");
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
    const files = [
      ...sourceFiles("src/components/financials"),
      ...sourceFiles("src/components/team"),
      "src/data/financials.ts",
      "src/data/team.ts",
      "src/lib/financial-rules.ts",
      "src/lib/money.ts",
      "src/lib/team-state.ts",
      "src/db/fin-mappers.ts",
      "src/db/fin-queries.ts",
      "src/server/actions/financials.ts",
    ];
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [/new Date\(\s*\)/, /Date\.now\(/, /Intl\.DateTimeFormat/, /toLocale(Date|Time)?String/, /getTimezoneOffset/]) {
        if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("the financial source holds no floating-point money arithmetic outside lib/money", () => {
    // Every sum, difference and product of money goes through lib/money (integer cents). A bare `* rate` or `.toFixed(2)` on a
    // dollar amount in the financial code would be the start of a rounding bug.
    const files = ["src/data/financials.ts", "src/lib/financial-rules.ts", "src/db/fin-mappers.ts", "src/db/fin-queries.ts", ...sourceFiles("src/components/financials")];
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // A quantity is not money: quantity.toFixed(2) writes a numeric(10,2) column and its two-decimal check is not a cents conversion.
        // Math.round(x * 100) on anything else is the one thing lib/money exists to own.
        if (/quantity/.test(line)) return;
        if (/Math\.round\([^)]*\*\s*100\)/.test(line) || /\.toFixed\(2\)/.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
