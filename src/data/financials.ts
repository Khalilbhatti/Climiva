/**
 * Quotes, Invoices and Payments: the types, the labels and the pure selectors. The records themselves live in PostgreSQL, per
 * organization, and reach the browser for the ACTIVE organization only (src/db/fin-queries, components/financials/FinancialProvider).
 * The canonical Apex Climate records are seed data (scripts/db/seed-data/financials.ts) and ship to no browser.
 *
 * Three independent records that point at each other: a Payment names its Invoice, an Invoice may name the Quote, Job and
 * Booking it came from, and any of them names a Customer. Nothing here is stored twice. An invoice's status, paid amount and
 * balance, and every total on the Payments and Overview pages, are DERIVED from the records by the selectors below, so the
 * screens cannot drift apart and no status can contradict the payments behind it.
 *
 * Money. Amounts are dollars here (89.5) because that is what the screens show, but they are only display values: every sum,
 * difference and product goes through lib/money, which calculates in integer cents. The database stores cents only.
 *
 * Notes on the canonical records (design-reference/stitch quotes_invoices, quote_qt_884_detail, create_invoice_from_approved_quote,
 * invoice_inv_1044_* and the payments_* screens; every conflict is listed in docs/stitch-screen-map.md §9):
 *  - INV-1044 is fully paid by PAY-1008; PAY-1001 is the historical voided payment and counts for nothing.
 *  - INV-1050 shows $200 already paid on the Stitch screens but no payment record backs it, and the approved received total
 *    ($2,130) is exactly the seven active payments. That $200 is therefore carried on the invoice as `previouslyPaid` (an
 *    IMPORTED invoice: money received before payment records were kept), not invented as a payment.
 *  - People without a Customers record (Kevin Vance, Arthur Pendleton, Maya Lin…) are a `contactName` snapshot, the same
 *    pattern bookings and jobs use.
 */
import { addDays } from "@/lib/dates";
import { addMoney, fromCents, lineCents, subtractMoney, sumCents, toCents } from "@/lib/money";
import { getServiceById, type Service } from "./services";

/* ───────────────────────── types ───────────────────────── */

export type QuoteStatus = "draft" | "sent" | "approved" | "declined" | "expired";
export type InvoiceStatus = "paid" | "unpaid" | "partially-paid";
export type PaymentStatus = "recorded" | "voided";
export type PaymentMethod = "check" | "card" | "cash" | "bank-transfer" | "other";

export type LineItem = {
  id: string;
  description: string;
  detail?: string;
  quantity: number;
  /** "hrs" when the quantity is hours; omitted for plain counts. */
  unit?: string;
  /** Dollars per unit (a display value: the database holds cents). */
  rate: number;
  /** The Service this line was priced from, when it was. A free-form line has none. */
  serviceId?: string;
};

export type Party = {
  /** Exactly one of customerId / contactName is set. */
  customerId?: string;
  /** Snapshot for someone without a Customers record. */
  contactName?: string;
  propertyId?: string;
};

export type Quote = Party & {
  /** "QT-884" */
  id: string;
  serviceId?: string;
  jobId?: string;
  bookingId?: string;
  status: QuoteStatus;
  lineItems: readonly LineItem[];
  /** "2024-10-24", the business's calendar date */
  createdOn: string;
  approvedOn?: string;
  validThrough?: string;
  /** The date of the latest thing that happened to the quote. */
  updatedOn: string;
  message?: string;
  activity: readonly { label: string; on: string }[];
};

export type PaymentTerms = "due-on-receipt" | "net-7" | "net-15" | "net-30";
export const PAYMENT_TERMS: readonly { id: PaymentTerms; label: string; days: number }[] = [
  { id: "due-on-receipt", label: "Due on receipt", days: 0 },
  { id: "net-7", label: "Net 7", days: 7 },
  { id: "net-15", label: "Net 15", days: 15 },
  { id: "net-30", label: "Net 30", days: 30 },
];

export type Invoice = Party & {
  /** "INV-1044" */
  id: string;
  quoteId?: string;
  serviceId?: string;
  jobId?: string;
  bookingId?: string;
  /** "2024-10-25", the business's calendar date */
  date: string;
  terms: PaymentTerms;
  lineItems: readonly LineItem[];
  /** Amount received before payment records were kept; counts toward the balance but is not a Payment. Only an imported invoice has one. */
  previouslyPaid?: number;
  /** Carried in from before this system kept its own records (it belongs to the reporting baseline, not to what was invoiced since). */
  imported?: boolean;
  message?: string;
};

export type Payment = {
  /** "PAY-1008" */
  id: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  /** "2024-10-28": the day the business received the money (the business's calendar date) */
  date: string;
  checkNumber?: string;
  note?: string;
  status: PaymentStatus;
  /** The Team member who recorded it, when they have a Team record. */
  recordedBy?: string;
  /** Present once voided: the record stays in history but no longer counts. */
  void?: { reason: string; on: string; by?: string; note?: string };
};

export type FinancialData = {
  quotes: readonly Quote[];
  invoices: readonly Invoice[];
  payments: readonly Payment[];
};

export const PAYMENT_METHODS: readonly { id: PaymentMethod; label: string }[] = [
  { id: "check", label: "Check" },
  { id: "card", label: "Card" },
  { id: "cash", label: "Cash" },
  { id: "bank-transfer", label: "Bank transfer" },
  { id: "other", label: "Other" },
];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = Object.fromEntries(
  PAYMENT_METHODS.map((method) => [method.id, method.label]),
) as Record<PaymentMethod, string>;

export const VOID_REASONS = [
  "Payment entered by mistake",
  "Incorrect amount",
  "Incorrect payment method",
  "Duplicate payment",
  "Payment was not actually received",
  "Other",
] as const;

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  declined: "Declined",
  expired: "Expired",
};
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  "partially-paid": "Partially paid",
};
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { recorded: "Recorded", voided: "Voided" };

/** What a business with no financial records has (a new organization): no quotes, invoices or payments. */
export const EMPTY_FINANCIALS: FinancialData = { quotes: [], invoices: [], payments: [] };

/* ───────────────────────── derived values ─────────────────────────
 * Each selector takes the active business's financial data. All arithmetic is integer cents (lib/money). */

const lineCentsOf = (item: LineItem) => lineCents(item.quantity, toCents(item.rate));

export const getLineAmount = (item: LineItem) => fromCents(lineCentsOf(item));
export const getLineItemsTotal = (items: readonly LineItem[]) => fromCents(sumCents(items.map(lineCentsOf)));

export function getQuoteById(id: string, data: FinancialData): Quote | undefined {
  return data.quotes.find((quote) => quote.id === id);
}
export function getInvoiceById(id: string, data: FinancialData): Invoice | undefined {
  return data.invoices.find((invoice) => invoice.id === id);
}
export function getPaymentById(id: string, data: FinancialData): Payment | undefined {
  return data.payments.find((payment) => payment.id === id);
}

export const getQuoteTotal = (quote: Quote) => getLineItemsTotal(quote.lineItems);
export const getInvoiceTotal = (invoice: Invoice) => getLineItemsTotal(invoice.lineItems);

/** The number part of "PAY-1008", for ordering "newest first" by number rather than by text ("PAY-999" is older than "PAY-1000"). */
const numberPart = (id: string) => Number(id.replace(/^\D+-/, ""));
export const newestFirst = (a: { id: string }, b: { id: string }) => numberPart(b.id) - numberPart(a.id) || b.id.localeCompare(a.id);

/** All payment records for an invoice, voided ones included, newest first. */
export function getPaymentsForInvoice(invoiceId: string, data: FinancialData): Payment[] {
  return data.payments.filter((payment) => payment.invoiceId === invoiceId).sort(newestFirst);
}

export const getActivePaymentsForInvoice = (invoiceId: string, data: FinancialData) =>
  getPaymentsForInvoice(invoiceId, data).filter((payment) => payment.status === "recorded");

/** What the invoice's recorded (non-voided) payments add up to. */
export const getInvoiceRecorded = (invoice: Invoice, data: FinancialData): number =>
  addMoney(...getActivePaymentsForInvoice(invoice.id, data).map((payment) => payment.amount));

/** What has been received against the invoice: money before payment records, plus active payments. */
export const getInvoicePaid = (invoice: Invoice, data: FinancialData): number => addMoney(invoice.previouslyPaid ?? 0, getInvoiceRecorded(invoice, data));

export function getInvoiceBalance(invoice: Invoice, data: FinancialData): number {
  return Math.max(0, subtractMoney(getInvoiceTotal(invoice), getInvoicePaid(invoice, data)));
}

export function getInvoiceStatus(invoice: Invoice, data: FinancialData): InvoiceStatus {
  if (getInvoiceBalance(invoice, data) === 0) return "paid";
  return getInvoicePaid(invoice, data) > 0 ? "partially-paid" : "unpaid";
}

/** What the invoice would owe after `amount` more is received. */
export const getBalanceAfter = (invoice: Invoice, data: FinancialData, amount: number): number => Math.max(0, subtractMoney(getInvoiceBalance(invoice, data), amount));

/** What an invoice's figures would be if `payment` were voided now (the Void payment screen shows them before it happens). */
export function getInvoiceAfterVoid(invoice: Invoice, payment: Payment, data: FinancialData): { paid: number; balance: number; status: InvoiceStatus } {
  const paid = payment.status === "recorded" ? Math.max(0, subtractMoney(getInvoicePaid(invoice, data), payment.amount)) : getInvoicePaid(invoice, data);
  const balance = Math.max(0, subtractMoney(getInvoiceTotal(invoice), paid));
  return { paid, balance, status: balance === 0 ? "paid" : paid > 0 ? "partially-paid" : "unpaid" };
}

/** Invoices that still have a balance, oldest first. */
export function getOutstandingInvoices(data: FinancialData): Invoice[] {
  return data.invoices.filter((invoice) => getInvoiceBalance(invoice, data) > 0).sort((a, b) => -newestFirst(a, b));
}

export const getOutstandingBalance = (data: FinancialData) => addMoney(...getOutstandingInvoices(data).map((invoice) => getInvoiceBalance(invoice, data)));

const activePayments = (data: FinancialData) => data.payments.filter((payment) => payment.status === "recorded");

/** Payments that count: recorded, never voided. */
export const getRecordedPaymentsCount = (data: FinancialData) => activePayments(data).length;
export const getPaymentsReceivedTotal = (data: FinancialData) => addMoney(...activePayments(data).map((payment) => payment.amount));

/** The figures every screen shows, worked out in ONE place from the records. */
export function getFinancialTotals(data: FinancialData) {
  return {
    recordedPayments: getRecordedPaymentsCount(data),
    received: getPaymentsReceivedTotal(data),
    outstandingInvoices: getOutstandingInvoices(data).length,
    outstandingBalance: getOutstandingBalance(data),
  };
}

export function getInvoicesForQuote(quoteId: string, data: FinancialData): Invoice[] {
  return data.invoices.filter((invoice) => invoice.quoteId === quoteId);
}

/** A customer's own quotes, invoices and payments (a payment belongs to a customer through its invoice), newest first. */
export function getCustomerFinancials(customerId: string, data: FinancialData) {
  const quotes = data.quotes.filter((quote) => quote.customerId === customerId).sort(newestFirst);
  const invoices = data.invoices.filter((invoice) => invoice.customerId === customerId).sort(newestFirst);
  const owned = new Set(invoices.map((invoice) => invoice.id));
  const payments = data.payments.filter((payment) => owned.has(payment.invoiceId)).sort(newestFirst);
  return { quotes, invoices, payments };
}

/**
 * What the stored invoices add up to. Not the Overview's or Analytics' "Total invoiced": those are reported by the reporting layer
 * (db/reporting-queries), which adds the sample business's imported invoicing history (an adjustment) to what its rows say.
 */
export function getTotalInvoiced(data: FinancialData): number {
  return addMoney(...data.invoices.map(getInvoiceTotal));
}

/** The service named by a record, or its first line item when the record has none. */
export function getRelatedWork(record: { serviceId?: string; lineItems: readonly LineItem[] }, services: readonly Service[]): string {
  return (record.serviceId && getServiceById(record.serviceId, services)?.name) || record.lineItems[0]?.description || "—";
}

/** "Due on receipt", or "Net 15 · due 2024-11-09" (the caller formats the date). */
export function getInvoiceDue(invoice: Invoice): { terms: string; dueDate?: string } {
  const terms = PAYMENT_TERMS.find((item) => item.id === invoice.terms)!;
  return terms.days === 0 ? { terms: terms.label } : { terms: terms.label, dueDate: addDays(invoice.date, terms.days) };
}
