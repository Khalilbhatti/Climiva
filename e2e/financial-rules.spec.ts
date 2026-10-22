/**
 * What a browser may ask of Quotes, Invoices and Payments, as the server reads it (src/lib/financial-rules.ts). Pure functions:
 * these are the checks a forged request meets BEFORE it reaches the database, which then holds the same rules again
 * (financials-database.spec.ts).
 */
import { expect, test } from "playwright/test";
import { PAYMENT_METHODS, VOID_REASONS, type QuoteStatus } from "../src/data/financials";
import {
  MAX_LINE_CENTS,
  MAX_QUOTE_CENTS,
  MAX_QUOTE_LINES,
  QUOTE_TRANSITIONS,
  canInvoiceError,
  financialNumber,
  invoiceReference,
  parseInvoiceFromQuote,
  parseNewPayment,
  parseNewQuote,
  parseQuoteStatus,
  parseVoidPayment,
  paymentAmountError,
  paymentReference,
  quoteLinesTotalCents,
  quoteReference,
  quoteTransitionError,
} from "../src/lib/financial-rules";

const STATUSES: QuoteStatus[] = ["draft", "sent", "approved", "declined", "expired"];
const payment = (over: Record<string, unknown> = {}) => ({ invoiceId: "INV-1050", amount: 300, method: "check", date: "2024-10-25", ...over });

test.describe("document numbers", () => {
  test("a reference is a prefix and a number, and nothing else", () => {
    expect(financialNumber("INV", "INV-1044")).toBe(1044);
    expect(financialNumber("QT", "QT-884")).toBe(884);
    expect(financialNumber("PAY", "PAY-1")).toBe(1);
    for (const bad of ["INV-0", "INV-", "INV 1044", "inv-1044", " INV-1044", "INV-1044 ", "INV-1044x", "INV--5", "INV-1234567890", "QT-884", "", "1044"]) {
      expect(financialNumber("INV", bad), JSON.stringify(bad)).toBeUndefined();
    }
    for (const bad of [null, undefined, 1044, {}, ["INV-1044"], true]) expect(financialNumber("INV", bad), String(bad)).toBeUndefined();
  });

  test("a number reads back as the same reference", () => {
    expect(quoteReference(884)).toBe("QT-884");
    expect(invoiceReference(1052)).toBe("INV-1052");
    expect(paymentReference(1009)).toBe("PAY-1009");
    expect(financialNumber("INV", invoiceReference(1052))).toBe(1052);
  });
});

test.describe("recording a payment", () => {
  test("a valid request is read into cents, and carries nothing the client could use to name another tenant or customer", () => {
    const parsed = parseNewPayment(payment({ organizationId: "00000000-0000-0000-0000-000000000000", customerId: "somebody-else", status: "voided", recordedBy: "x" }));
    expect(parsed).toEqual({ ok: true, value: { invoiceNumber: 1050, amountCents: 30000, method: "check", date: "2024-10-25", checkNumber: undefined, note: undefined } });
  });

  test("the amount is exact: two decimals at most, above zero", () => {
    expect(parseNewPayment(payment({ amount: "100.10" }))).toMatchObject({ ok: true, value: { amountCents: 10010 } });
    expect(parseNewPayment(payment({ amount: 0.1 + 0.2 }))).toMatchObject({ ok: true, value: { amountCents: 30 } });
    for (const amount of [0, -1, 0.001, 10.005, "10.005", "abc", "", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, [100]]) {
      const parsed = parseNewPayment(payment({ amount }));
      expect(parsed.ok, JSON.stringify(amount)).toBe(false);
    }
  });

  test("only the existing payment methods", () => {
    for (const { id } of PAYMENT_METHODS) expect(parseNewPayment(payment({ method: id })).ok, id).toBe(true);
    for (const method of ["wire", "paypal", "stripe", "crypto", "", null, undefined, 1]) expect(parseNewPayment(payment({ method })).ok, String(method)).toBe(false);
  });

  test("the date is a real calendar date", () => {
    for (const date of ["2024-02-30", "2024-13-01", "10/25/2024", "2024-10-25T10:00", "", null, undefined, 20241025]) {
      expect(parseNewPayment(payment({ date })).ok, String(date)).toBe(false);
    }
    expect(parseNewPayment(payment({ date: "2024-02-29" })).ok).toBe(true); // a leap day
  });

  test("a check number belongs to a check only; the note is trimmed and bounded", () => {
    expect(parseNewPayment(payment({ checkNumber: " 2210 " }))).toMatchObject({ value: { checkNumber: "2210" } });
    expect(parseNewPayment(payment({ method: "card", checkNumber: "2210" }))).toMatchObject({ value: { checkNumber: undefined } });
    expect(parseNewPayment(payment({ note: "  Deposit by phone  " }))).toMatchObject({ value: { note: "Deposit by phone" } });
    expect(parseNewPayment(payment({ note: "x".repeat(1001) })).ok).toBe(false);
    expect(parseNewPayment(payment({ checkNumber: "9".repeat(41) })).ok).toBe(false);
  });

  test("the invoice must be named as INV-nnn", () => {
    for (const invoiceId of ["", "INV-0", "PAY-1050", "1050", null, undefined, 1050, "INV-1050; drop table payments"]) {
      expect(parseNewPayment(payment({ invoiceId })).ok, String(invoiceId)).toBe(false);
    }
    for (const input of [null, undefined, "INV-1050", 300, [], true]) expect(parseNewPayment(input).ok, String(input)).toBe(false);
  });

  test("an amount fits the balance or it is refused, with the range in the message", () => {
    expect(paymentAmountError(30000, 30000)).toBeUndefined();
    expect(paymentAmountError(1, 30000)).toBeUndefined();
    expect(paymentAmountError(30001, 30000)).toBe("Enter an amount between $0.01 and $300.00.");
    expect(paymentAmountError(0, 30000)).toMatch(/between \$0\.01 and \$300\.00/);
    expect(paymentAmountError(-5, 30000)).toMatch(/between/);
    // Nothing at all can be recorded against a balance of $0.
    expect(paymentAmountError(100, 0)).toMatch(/no balance due/);
    expect(paymentAmountError(1, -1)).toMatch(/no balance due/);
  });
});

test.describe("voiding a payment", () => {
  test("a reason from the list is required; the note is optional", () => {
    for (const reason of VOID_REASONS) expect(parseVoidPayment("PAY-1008", reason, undefined).ok, reason).toBe(true);
    expect(parseVoidPayment("PAY-1008", "Duplicate payment", "  entered twice  ")).toEqual({ ok: true, value: { paymentNumber: 1008, reason: "Duplicate payment", note: "entered twice" } });
    expect(parseVoidPayment("PAY-1008", "Duplicate payment", "")).toMatchObject({ ok: true, value: { note: undefined } });
    for (const reason of ["", "because", undefined, null, 1]) expect(parseVoidPayment("PAY-1008", reason, undefined).ok, String(reason)).toBe(false);
    expect(parseVoidPayment("PAY-1008", "Other", "x".repeat(1001)).ok).toBe(false);
    for (const reference of ["INV-1008", "PAY-0", "1008", undefined, null]) expect(parseVoidPayment(reference, "Other", undefined).ok, String(reference)).toBe(false);
  });
});

test.describe("invoices from quotes", () => {
  test("terms must be one of the four, and the quote is named as QT-nnn", () => {
    expect(parseInvoiceFromQuote("QT-884", { terms: "net-15", message: " Thank you. " })).toEqual({ ok: true, value: { quoteNumber: 884, terms: "net-15", message: "Thank you." } });
    for (const terms of ["net-90", "", undefined, null, 15]) expect(parseInvoiceFromQuote("QT-884", { terms }).ok, String(terms)).toBe(false);
    for (const quote of ["INV-884", "QT-0", undefined, null]) expect(parseInvoiceFromQuote(quote, { terms: "net-7" }).ok, String(quote)).toBe(false);
    expect(parseInvoiceFromQuote("QT-884", null).ok).toBe(false);
    expect(parseInvoiceFromQuote("QT-884", { terms: "net-7", message: "x".repeat(2001) }).ok).toBe(false);
  });

  test("only an approved quote with no invoice can be invoiced", () => {
    expect(canInvoiceError({ status: "approved" }, false)).toBeUndefined();
    expect(canInvoiceError({ status: "approved" }, true)).toBe("That quote already has an invoice.");
    for (const status of ["draft", "sent", "declined", "expired"]) expect(canInvoiceError({ status }, false), status).toBe("An invoice is created from an approved quote.");
  });
});

test.describe("a quote's life", () => {
  test("draft goes to sent; sent goes to approved, declined or expired; those three are final", () => {
    const allowed: [QuoteStatus, QuoteStatus][] = [];
    for (const from of STATUSES) for (const to of STATUSES) if (quoteTransitionError(from, to) === undefined) allowed.push([from, to]);
    expect(allowed).toEqual([
      ["draft", "sent"],
      ["sent", "approved"],
      ["sent", "declined"],
      ["sent", "expired"],
    ]);
    expect(QUOTE_TRANSITIONS.approved).toEqual([]);
  });

  test("the refusals say why", () => {
    expect(quoteTransitionError("approved", "declined")).toMatch(/final/);
    expect(quoteTransitionError("draft", "approved")).toMatch(/can't become/);
    expect(quoteTransitionError("sent", "sent")).toMatch(/already/);
  });

  test("a status that is not one of the five is not understood", () => {
    expect(parseQuoteStatus("approved")).toBe("approved");
    for (const value of ["APPROVED", "paid", "", null, undefined, 1]) expect(parseQuoteStatus(value), String(value)).toBeUndefined();
  });
});

test.describe("creating a quote", () => {
  const line = (over: Record<string, unknown> = {}) => ({ description: "Capacitor", quantity: 1, rate: 89.5, ...over });
  const quote = (over: Record<string, unknown> = {}) => ({ customerId: "sarah-mitchell", lines: [line()], ...over });

  test("a valid quote is read into cents, for a customer or for a name", () => {
    const parsed = parseNewQuote(quote({ propertyId: "prop-sarah-home", jobId: "JB-204", lines: [line(), line({ description: "Labor", quantity: 1.5, unit: "hrs", rate: "130" })] }));
    expect(parsed).toMatchObject({ ok: true, value: { customerId: "sarah-mitchell", propertyId: "prop-sarah-home", jobNumber: 204 } });
    if (parsed.ok) expect(parsed.value.lines.map((item) => [item.quantity, item.unitPriceCents])).toEqual([[1, 8950], [1.5, 13000]]);
    expect(parseNewQuote({ contactName: "Pat Newcomer", lines: [line()] }).ok).toBe(true);
  });

  test("exactly one of a customer and a name; a property needs its customer", () => {
    expect(parseNewQuote({ lines: [line()] }).ok).toBe(false);
    expect(parseNewQuote(quote({ contactName: "Pat" })).ok).toBe(false);
    expect(parseNewQuote({ contactName: "Pat", propertyId: "prop-x", lines: [line()] }).ok).toBe(false);
  });

  test("between one and fifty lines, each with a description, a positive two-decimal quantity and an exact price", () => {
    expect(parseNewQuote(quote({ lines: [] })).ok).toBe(false);
    expect(parseNewQuote(quote({ lines: Array.from({ length: MAX_QUOTE_LINES + 1 }, () => line()) })).ok).toBe(false);
    expect(parseNewQuote(quote({ lines: Array.from({ length: MAX_QUOTE_LINES }, () => line()) })).ok).toBe(true);
    for (const bad of [{ description: "" }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.005 }, { quantity: "1" }, { rate: 12.345 }, { rate: -1 }, { rate: "abc" }, { serviceId: "Not A Slug" }]) {
      expect(parseNewQuote(quote({ lines: [line(bad)] })).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("a bad line is said to be bad in words that name the line and the field", () => {
    const wrong = (over: Record<string, unknown>) => parseNewQuote(quote({ lines: [line(), line(over)] }));
    expect(wrong({ description: "" })).toMatchObject({ ok: false, error: "Line 2: describe the work, in 200 characters or fewer.", fields: { line2Description: expect.any(String) } });
    expect(wrong({ quantity: 0 })).toMatchObject({ ok: false, error: "Line 2: enter a quantity above zero, with at most two decimals.", fields: { line2Quantity: expect.any(String) } });
    expect(wrong({ rate: -1 })).toMatchObject({ ok: false, error: "Line 2: enter a price of $0.00 or more, with at most two decimals.", fields: { line2Rate: expect.any(String) } });
    expect(wrong({ rate: 0.001 }).ok).toBe(false);
    expect(wrong({ rate: 0 }).ok).toBe(true);
  });

  test("the total is the lines added up in whole cents; a total sent with the request is checked against it, never stored", () => {
    const lines = [line({ quantity: 1, rate: "89.50" }), line({ quantity: 1.5, rate: "33.33" }), line({ quantity: 3, rate: 12.1 })];
    // 8950 + round(1.5 x 3333 = 4999.5) 5000 + 3630.
    expect(quoteLinesTotalCents(lines.map((item) => ({ quantity: item.quantity, unitPriceCents: Math.round(Number(item.rate) * 100) })))).toBe(17580);
    expect(parseNewQuote(quote({ lines, expectedTotal: 175.8 })).ok).toBe(true);
    expect(parseNewQuote(quote({ lines, expectedTotal: "175.80" })).ok).toBe(true);
    for (const wrong of [175.79, 175.81, 0, "x", -175.8, 1e9]) expect(parseNewQuote(quote({ lines, expectedTotal: wrong })).ok, String(wrong)).toBe(false);
    expect(parseNewQuote(quote({ lines, expectedTotal: 140 }))).toMatchObject({ ok: false, error: "The total on screen does not match the line items. Reload the page and try again." });
    // Without it the request is read as before, and no other total in it is ever read.
    const stored = parseNewQuote(quote({ lines, total: 1, subtotal: 1, totalCents: 1 }));
    expect(stored.ok).toBe(true);
    expect(stored.ok && JSON.stringify(stored.value)).not.toContain("subtotal");
    // 0.1 + 0.2 in dollars is not 0.3; in cents it is.
    expect(quoteLinesTotalCents([{ quantity: 1, unitPriceCents: 10 }, { quantity: 1, unitPriceCents: 20 }])).toBe(30);
    expect(parseNewQuote(quote({ lines: [line({ rate: 0.1 }), line({ rate: 0.2 })], expectedTotal: 0.1 + 0.2 })).ok).toBe(true);
  });

  test("a line and a quote have a size, so a huge quantity times a huge price is said in words, not left to the database", () => {
    expect(MAX_LINE_CENTS).toBeLessThan(2_147_483_647);
    expect(MAX_QUOTE_CENTS).toBeLessThan(2_147_483_647);
    expect(parseNewQuote(quote({ lines: [line({ quantity: 99999.99, rate: 99999999 })] }))).toMatchObject({ ok: false, error: expect.stringContaining("more than one line can hold") });
    expect(parseNewQuote(quote({ lines: [line({ quantity: 1, rate: 10_000_000 })] })).ok).toBe(true);
    expect(parseNewQuote(quote({ lines: [line({ quantity: 1, rate: 10_000_000.01 })] })).ok).toBe(false);
    const heavy = Array.from({ length: 3 }, () => line({ quantity: 1, rate: 9_000_000 }));
    expect(parseNewQuote(quote({ lines: heavy }))).toMatchObject({ ok: false, error: expect.stringContaining("more than a quote can hold") });
  });

  test("references and dates are checked", () => {
    expect(parseNewQuote(quote({ jobId: "INV-204" })).ok).toBe(false);
    expect(parseNewQuote(quote({ bookingId: "BK-1042" })).ok).toBe(true);
    expect(parseNewQuote(quote({ validThrough: "2024-02-30" })).ok).toBe(false);
    expect(parseNewQuote(quote({ validThrough: "2024-11-23" })).ok).toBe(true);
    for (const input of [null, "quote", 5, []]) expect(parseNewQuote(input).ok).toBe(false);
  });
});
