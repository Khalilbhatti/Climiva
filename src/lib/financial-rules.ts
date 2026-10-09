/**
 * What a browser may ask of Quotes, Invoices and Payments, and what state each may be in when it does: the rules, checked on the
 * server. Pure functions: no database, no framework. The server actions call these before they write, and the database holds the
 * same rules again (constraints, guards and grants in the financial migrations), so a forged request cannot do what a screen would
 * never offer.
 *
 * These check SHAPE and the rules that need only the request in hand. The rules that depend on the business's other records (the
 * invoice exists and has a balance, the customer is the business's own) are checked against the data the action loads under the
 * verified organization.
 *
 * Money is parsed and compared in whole cents (lib/money); nothing here does arithmetic on dollars.
 */
import { PAYMENT_METHODS, PAYMENT_TERMS, VOID_REASONS, type PaymentMethod, type PaymentTerms, type QuoteStatus } from "@/data/financials";
import { isValidDate } from "./dates";
import { amountToCents, fromCents } from "./money";
import { formatUSD } from "./format";
import { isRecord, text, type Parsed } from "./validation";

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

/* ───────────────────────── identifiers ───────────────────────── */

export type FinancialPrefix = "QT" | "INV" | "PAY";

/** "INV-1044" → 1044; anything else → undefined. */
export function financialNumber(prefix: FinancialPrefix, reference: unknown): number | undefined {
  if (typeof reference !== "string") return undefined;
  const match = new RegExp(`^${prefix}-(\\d{1,9})$`).exec(reference);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

export const quoteReference = (number: number) => `QT-${number}`;
export const invoiceReference = (number: number) => `INV-${number}`;
export const paymentReference = (number: number) => `PAY-${number}`;

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const slugOf = (value: unknown): string | undefined => (typeof value === "string" && SLUG.test(value) ? value : undefined);
const jobNumberOf = (value: unknown): number | undefined => {
  const match = typeof value === "string" ? /^JB-(\d{1,9})$/.exec(value) : null;
  return match ? Number(match[1]) : undefined;
};
const bookingNumberOf = (value: unknown): number | undefined => {
  const match = typeof value === "string" ? /^BK-(\d{1,9})$/.exec(value) : null;
  return match ? Number(match[1]) : undefined;
};

/* ───────────────────────── payments ───────────────────────── */

export type NewPayment = {
  invoiceNumber: number;
  amountCents: number;
  method: PaymentMethod;
  /** The day the business received the money. */
  date: string;
  checkNumber?: string;
  note?: string;
};

export function parseNewPayment(input: unknown): Parsed<NewPayment> {
  if (!isRecord(input)) return fail("The payment details were not understood.");
  const invoiceNumber = financialNumber("INV", input.invoiceId);
  const method = PAYMENT_METHODS.find((item) => item.id === input.method)?.id;
  if (invoiceNumber === undefined || !method) return fail("The payment details were not understood.");

  const amountCents = amountToCents(input.amount);
  if (amountCents === undefined || amountCents <= 0) return fail("Enter an amount above $0.00, with at most two decimals.", { amount: "Enter an amount above $0.00, with at most two decimals." });

  if (typeof input.date !== "string" || !isValidDate(input.date)) return fail("Enter the date the payment was received.", { date: "Enter the date the payment was received." });

  const checkNumber = input.checkNumber === undefined || input.checkNumber === "" ? undefined : text(input.checkNumber, 40)?.trim();
  const note = input.note === undefined || input.note === "" ? undefined : text(input.note, 1000)?.trim();
  if ((input.checkNumber !== undefined && input.checkNumber !== "" && checkNumber === undefined) || (input.note !== undefined && input.note !== "" && note === undefined)) {
    return fail("The payment details were not understood.");
  }
  return { ok: true, value: { invoiceNumber, amountCents, method, date: input.date, checkNumber: method === "check" ? checkNumber || undefined : undefined, note: note || undefined } };
}

/** Why `amountCents` cannot be taken against an invoice with `balanceCents` due, or undefined when it can. */
export function paymentAmountError(amountCents: number, balanceCents: number): string | undefined {
  if (balanceCents <= 0) return "That invoice has no balance due, so no payment can be recorded against it.";
  if (amountCents <= 0 || amountCents > balanceCents) return `Enter an amount between ${formatUSD(0.01, 2)} and ${formatUSD(fromCents(balanceCents), 2)}.`;
  return undefined;
}

export type VoidInput = { paymentNumber: number; reason: (typeof VOID_REASONS)[number]; note?: string };

export function parseVoidPayment(paymentReference: unknown, reason: unknown, note: unknown): Parsed<VoidInput> {
  const paymentNumber = financialNumber("PAY", paymentReference);
  if (paymentNumber === undefined) return fail("That payment was not understood.");
  const found = VOID_REASONS.find((item) => item === reason);
  if (!found) return fail("Select a reason for voiding this payment.", { reason: "Select a reason for voiding this payment." });
  const trimmed = note === undefined || note === "" ? undefined : text(note, 1000)?.trim();
  if (note !== undefined && note !== "" && trimmed === undefined) return fail("Keep the note under 1,000 characters.");
  return { ok: true, value: { paymentNumber, reason: found, note: trimmed || undefined } };
}

/* ───────────────────────── invoices ───────────────────────── */

export type NewInvoiceFromQuote = { quoteNumber: number; terms: PaymentTerms; message?: string };

export function parseInvoiceFromQuote(quoteReferenceValue: unknown, input: unknown): Parsed<NewInvoiceFromQuote> {
  const quoteNumber = financialNumber("QT", quoteReferenceValue);
  if (quoteNumber === undefined || !isRecord(input)) return fail("The invoice details were not understood.");
  const terms = PAYMENT_TERMS.find((item) => item.id === input.terms)?.id;
  if (!terms) return fail("Choose the payment terms.", { terms: "Choose the payment terms." });
  const message = input.message === undefined || input.message === "" ? undefined : text(input.message, 2000)?.trim();
  if (input.message !== undefined && input.message !== "" && message === undefined) return fail("Keep the message under 2,000 characters.");
  return { ok: true, value: { quoteNumber, terms, message: message || undefined } };
}

/** Why an invoice cannot be created from this quote, or undefined when it can. */
export function canInvoiceError(quote: { status: string }, alreadyInvoiced: boolean): string | undefined {
  if (quote.status !== "approved") return "An invoice is created from an approved quote.";
  if (alreadyInvoiced) return "That quote already has an invoice.";
  return undefined;
}

/* ───────────────────────── quotes ───────────────────────── */

/** draft → sent → approved | declined | expired. The last three are final. */
export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ["sent"],
  sent: ["approved", "declined", "expired"],
  approved: [],
  declined: [],
  expired: [],
};

export function quoteTransitionError(from: QuoteStatus, to: QuoteStatus): string | undefined {
  if (from === to) return `That quote is already ${to}.`;
  if (QUOTE_TRANSITIONS[from].length === 0) return `A ${from} quote is final and can't be changed.`;
  if (!QUOTE_TRANSITIONS[from].includes(to)) return `A ${from} quote can't become ${to}.`;
  return undefined;
}

export function parseQuoteStatus(value: unknown): QuoteStatus | undefined {
  return (["draft", "sent", "approved", "declined", "expired"] as const).find((item) => item === value);
}

export type NewQuoteLine = {
  description: string;
  detail?: string;
  /** With at most two decimals. */
  quantity: number;
  unit?: string;
  unitPriceCents: number;
  serviceId?: string;
};

export type NewQuote = {
  /** Exactly one of customerId / contactName. */
  customerId?: string;
  contactName?: string;
  propertyId?: string;
  serviceId?: string;
  jobNumber?: number;
  bookingNumber?: number;
  validThrough?: string;
  message?: string;
  lines: NewQuoteLine[];
};

export const MAX_QUOTE_LINES = 50;

function parseLine(input: unknown): NewQuoteLine | undefined {
  if (!isRecord(input)) return undefined;
  const description = text(input.description, 200)?.trim();
  if (!description) return undefined;
  const detail = input.detail === undefined || input.detail === "" ? undefined : text(input.detail, 500)?.trim();
  const unit = input.unit === undefined || input.unit === "" ? undefined : text(input.unit, 20)?.trim();
  if ((input.detail && detail === undefined) || (input.unit && unit === undefined)) return undefined;
  const quantity = input.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 99_999.99 || Math.abs(quantity * 100 - Math.round(quantity * 100)) > 1e-6) return undefined;
  const unitPriceCents = amountToCents(input.rate);
  if (unitPriceCents === undefined) return undefined;
  const serviceId = input.serviceId === undefined ? undefined : slugOf(input.serviceId);
  if (input.serviceId !== undefined && !serviceId) return undefined;
  return { description, detail: detail || undefined, quantity, unit: unit || undefined, unitPriceCents, serviceId };
}

export function parseNewQuote(input: unknown): Parsed<NewQuote> {
  if (!isRecord(input)) return fail("The quote details were not understood.");
  const customerId = input.customerId === undefined ? undefined : slugOf(input.customerId);
  const propertyId = input.propertyId === undefined ? undefined : slugOf(input.propertyId);
  const serviceId = input.serviceId === undefined ? undefined : slugOf(input.serviceId);
  if ((input.customerId !== undefined && !customerId) || (input.propertyId !== undefined && !propertyId) || (input.serviceId !== undefined && !serviceId)) {
    return fail("The quote details were not understood.");
  }
  const contactName = input.contactName === undefined || input.contactName === "" ? undefined : text(input.contactName, 80)?.trim();
  if (input.contactName !== undefined && input.contactName !== "" && contactName === undefined) return fail("Keep the name to 80 characters or fewer.");
  if (Boolean(customerId) === Boolean(contactName)) return fail("Choose a customer, or enter the name of the person the quote is for.");
  if (propertyId && !customerId) return fail("A property belongs to a customer.");

  const jobNumber = input.jobId === undefined ? undefined : jobNumberOf(input.jobId);
  const bookingNumber = input.bookingId === undefined ? undefined : bookingNumberOf(input.bookingId);
  if ((input.jobId !== undefined && jobNumber === undefined) || (input.bookingId !== undefined && bookingNumber === undefined)) return fail("The quote details were not understood.");

  const validThrough = input.validThrough === undefined || input.validThrough === "" ? undefined : input.validThrough;
  if (validThrough !== undefined && (typeof validThrough !== "string" || !isValidDate(validThrough))) return fail("Enter a valid date the quote is good through.");
  const message = input.message === undefined || input.message === "" ? undefined : text(input.message, 2000)?.trim();
  if (input.message !== undefined && input.message !== "" && message === undefined) return fail("Keep the message under 2,000 characters.");

  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > MAX_QUOTE_LINES) return fail(`A quote needs between 1 and ${MAX_QUOTE_LINES} line items.`);
  const lines: NewQuoteLine[] = [];
  for (const candidate of input.lines) {
    const line = parseLine(candidate);
    if (!line) return fail("Each line item needs a description, a quantity above zero and a price.");
    lines.push(line);
  }
  return { ok: true, value: { customerId, contactName: contactName || undefined, propertyId, serviceId, jobNumber, bookingNumber, validThrough: validThrough as string | undefined, message: message || undefined, lines } };
}
