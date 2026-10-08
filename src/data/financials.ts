/**
 * Quotes, Invoices and Payments.
 *
 * Three independent records that point at each other by id: a Payment names its Invoice, an Invoice may
 * name the Quote, Job and Booking it came from, and any of them names a Customer. Nothing here is stored
 * twice. An invoice's status, paid amount and balance, and every total on the Payments and Overview pages,
 * are derived from the records below by the selectors in this file, so the screens cannot drift apart.
 *
 * Sources: design-reference/stitch/ quotes_invoices, quote_qt_884_detail, create_invoice_from_approved_quote,
 * invoice_inv_1044_* and the payments_* / payment_pay_1001_* / *_record_payment_* screens, with the baseline
 * locked by the audit board ("post-#PAY-1008": 7 payments, $2,130 received, 2 open invoices, $680 balance).
 * Every conflict is listed in docs/stitch-screen-map.md §9. In short:
 *  - INV-1044 is fully paid by PAY-1008; PAY-1001 is the historical voided payment and counts for nothing.
 *  - INV-1050 shows $200 already paid on the Stitch screens but no payment record backs it, and the
 *    approved received total ($2,130) is exactly the seven active payments. That $200 is therefore carried
 *    on the invoice as `previouslyPaid`, not invented as a payment.
 *  - People without a Customers record (Kevin Vance, Arthur Pendleton, Maya Lin…) are a `contactName`
 *    snapshot, the same pattern bookings and jobs use.
 *
 * Fixtures are read-only. Demo edits (record payment, void, create invoice) live in
 * components/financials/FinancialProvider and reset on reload.
 */
import { addDays } from "@/lib/dates";
import { overviewMetrics } from "./fixtures";
import { getServiceById } from "./services";

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
  rate: number;
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
  /** "2024-10-24" */
  createdOn: string;
  approvedOn?: string;
  validThrough?: string;
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
  /** "2024-10-25" */
  date: string;
  terms: PaymentTerms;
  lineItems: readonly LineItem[];
  /** Amount received before payment records were kept; counts toward the balance but is not a Payment. */
  previouslyPaid?: number;
  message?: string;
};

export type Payment = {
  /** "PAY-1008" */
  id: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  /** "2024-10-28" */
  date: string;
  checkNumber?: string;
  note?: string;
  status: PaymentStatus;
  recordedBy: string;
  /** Present once voided: the record stays in history but no longer counts. */
  void?: { reason: string; on: string; by: string; note?: string };
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

/* ───────────────────────── fixtures ───────────────────────── */

/** QT-884 and the Stitch invoice screens share these three lines. */
const CAPACITOR_JOB_LINES: readonly LineItem[] = [
  {
    id: "line-1",
    description: "Titan HD 45/5 µF 440V Dual Run Capacitor",
    detail: "Replacement dual run capacitor for outdoor condensing unit",
    quantity: 1,
    rate: 89.5,
  },
  {
    id: "line-2",
    description: "Diagnostic & Compressor Electrical Recovery Labor",
    detail: "Diagnostic testing, capacitor replacement, wiring inspection and system restart verification",
    quantity: 1.5,
    unit: "hrs",
    rate: 130,
  },
  { id: "line-3", description: "Rounding adjustment", detail: "Standard balance adjustment", quantity: 1, rate: 0.5 },
];

/** A single-line item for records where Stitch only gives a description and a total. */
const oneLine = (id: string, description: string, rate: number): readonly LineItem[] => [
  { id: `${id}-1`, description, quantity: 1, rate },
];

export const QUOTES: readonly Quote[] = [
  {
    id: "QT-884",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "ac-repair-diagnostics",
    jobId: "JB-204",
    bookingId: "BK-1042",
    status: "approved",
    lineItems: CAPACITOR_JOB_LINES,
    createdOn: "2024-10-24",
    approvedOn: "2024-10-24",
    validThrough: "2024-11-23",
    updatedOn: "2024-10-24",
    message:
      "Recommended replacement of the failed dual run capacitor identified during AC diagnostic service. The quoted amount includes the replacement part and installation labor.",
    activity: [
      { label: "Quote approved", on: "2024-10-24" },
      { label: "Quote sent", on: "2024-10-24" },
      { label: "Quote created", on: "2024-10-24" },
    ],
  },
  {
    id: "QT-891",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    serviceId: "heat-pump-diagnostics-repair",
    status: "sent",
    lineItems: oneLine("qt-891", "Heat Pump Diagnostics & Repair", 1240),
    createdOn: "2024-10-23",
    updatedOn: "2024-10-23",
    activity: [
      { label: "Quote sent", on: "2024-10-23" },
      { label: "Quote created", on: "2024-10-23" },
    ],
  },
  {
    id: "QT-893",
    contactName: "Claire Dubois",
    serviceId: "heat-pump-diagnostics-repair",
    status: "draft",
    lineItems: oneLine("qt-893", "Heat Pump Diagnostics & Repair", 4850),
    createdOn: "2024-10-24",
    updatedOn: "2024-10-24",
    activity: [{ label: "Quote created", on: "2024-10-24" }],
  },
  {
    id: "QT-879",
    customerId: "bradley-cooper",
    propertyId: "prop-bradley-bungalow",
    serviceId: "annual-cooling-tune-up",
    status: "declined",
    lineItems: oneLine("qt-879", "Annual Cooling Tune-Up & Maintenance", 195),
    createdOn: "2024-10-17",
    updatedOn: "2024-10-18",
    activity: [
      { label: "Quote declined", on: "2024-10-18" },
      { label: "Quote sent", on: "2024-10-17" },
      { label: "Quote created", on: "2024-10-17" },
    ],
  },
];

const GENERIC_LINE = "HVAC service visit";

export const INVOICES: readonly Invoice[] = [
  { id: "INV-1043", contactName: "Kevin Vance", date: "2024-10-25", terms: "due-on-receipt", lineItems: oneLine("inv-1043", GENERIC_LINE, 285) },
  {
    id: "INV-1044",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "ac-repair-diagnostics",
    jobId: "JB-204",
    bookingId: "BK-1042",
    date: "2024-10-25",
    terms: "due-on-receipt",
    lineItems: CAPACITOR_JOB_LINES,
    message: "Thank you for choosing Apex Climate Heating & Air. This invoice covers the approved AC Repair & Diagnostics work.",
  },
  { id: "INV-1045", contactName: "Amanda Diaz", date: "2024-10-25", terms: "due-on-receipt", lineItems: oneLine("inv-1045", GENERIC_LINE, 400) },
  { id: "INV-1046", contactName: "Marcus Bell", date: "2024-10-26", terms: "due-on-receipt", lineItems: oneLine("inv-1046", GENERIC_LINE, 180) },
  { id: "INV-1047", contactName: "Robert Miller", date: "2024-10-26", terms: "due-on-receipt", lineItems: oneLine("inv-1047", GENERIC_LINE, 210) },
  {
    id: "INV-1048",
    customerId: "elena-rodriguez",
    propertyId: "prop-elena-condo",
    date: "2024-10-26",
    terms: "due-on-receipt",
    lineItems: oneLine("inv-1048", GENERIC_LINE, 450),
  },
  {
    id: "INV-1049",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    date: "2024-10-27",
    terms: "due-on-receipt",
    lineItems: oneLine("inv-1049", GENERIC_LINE, 320),
  },
  {
    id: "INV-1050",
    contactName: "Arthur Pendleton",
    date: "2024-10-27",
    terms: "due-on-receipt",
    lineItems: oneLine("inv-1050", "Blower Motor Replacement & Diagnostics", 500),
    previouslyPaid: 200,
  },
  {
    id: "INV-1051",
    contactName: "Maya Lin",
    date: "2024-10-28",
    terms: "due-on-receipt",
    lineItems: oneLine("inv-1051", "Dual-Zone Thermostat Wiring & Commissioning", 380),
  },
];

const recorded = (id: string, invoiceId: string, amount: number, method: PaymentMethod, date: string): Payment => ({
  id,
  invoiceId,
  amount,
  method,
  date,
  status: "recorded",
  recordedBy: "alex-morgan",
});

export const PAYMENTS: readonly Payment[] = [
  {
    // The historical corrective scenario: recorded by mistake, then voided. It counts toward nothing.
    ...recorded("PAY-1001", "INV-1044", 285, "check", "2024-10-25"),
    status: "voided",
    void: { reason: "Payment entered by mistake", on: "2024-10-25", by: "alex-morgan" },
  },
  recorded("PAY-1002", "INV-1043", 285, "check", "2024-10-25"),
  recorded("PAY-1003", "INV-1045", 400, "card", "2024-10-25"),
  recorded("PAY-1004", "INV-1046", 180, "cash", "2024-10-26"),
  recorded("PAY-1005", "INV-1047", 210, "check", "2024-10-26"),
  recorded("PAY-1006", "INV-1048", 450, "bank-transfer", "2024-10-27"),
  recorded("PAY-1007", "INV-1049", 320, "card", "2024-10-28"),
  recorded("PAY-1008", "INV-1044", 285, "check", "2024-10-28"),
];

export const FINANCIALS: FinancialData = { quotes: QUOTES, invoices: INVOICES, payments: PAYMENTS };

/* ───────────────────────── derived values ─────────────────────────
 * Each selector takes optional data so the canonical fixtures and the in-memory demo state share logic. */

/** Money is kept in dollars with at most two decimals; round to avoid float noise. */
export const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

export const getLineAmount = (item: LineItem) => roundMoney(item.quantity * item.rate);
export const getLineItemsTotal = (items: readonly LineItem[]) => roundMoney(items.reduce((sum, item) => sum + getLineAmount(item), 0));

export function getQuoteById(id: string, data: FinancialData = FINANCIALS): Quote | undefined {
  return data.quotes.find((quote) => quote.id === id);
}
export function getInvoiceById(id: string, data: FinancialData = FINANCIALS): Invoice | undefined {
  return data.invoices.find((invoice) => invoice.id === id);
}
export function getPaymentById(id: string, data: FinancialData = FINANCIALS): Payment | undefined {
  return data.payments.find((payment) => payment.id === id);
}

export const getQuoteTotal = (quote: Quote) => getLineItemsTotal(quote.lineItems);
export const getInvoiceTotal = (invoice: Invoice) => getLineItemsTotal(invoice.lineItems);

/** All payment records for an invoice, voided ones included, newest first. */
export function getPaymentsForInvoice(invoiceId: string, data: FinancialData = FINANCIALS): Payment[] {
  return data.payments.filter((payment) => payment.invoiceId === invoiceId).sort((a, b) => b.id.localeCompare(a.id));
}

export const getActivePaymentsForInvoice = (invoiceId: string, data: FinancialData = FINANCIALS) =>
  getPaymentsForInvoice(invoiceId, data).filter((payment) => payment.status === "recorded");

/** What has been received against the invoice: money before payment records, plus active payments. */
export function getInvoicePaid(invoice: Invoice, data: FinancialData = FINANCIALS): number {
  const recordedTotal = getActivePaymentsForInvoice(invoice.id, data).reduce((sum, payment) => sum + payment.amount, 0);
  return roundMoney((invoice.previouslyPaid ?? 0) + recordedTotal);
}

export function getInvoiceBalance(invoice: Invoice, data: FinancialData = FINANCIALS): number {
  return Math.max(0, roundMoney(getInvoiceTotal(invoice) - getInvoicePaid(invoice, data)));
}

export function getInvoiceStatus(invoice: Invoice, data: FinancialData = FINANCIALS): InvoiceStatus {
  if (getInvoiceBalance(invoice, data) === 0) return "paid";
  return getInvoicePaid(invoice, data) > 0 ? "partially-paid" : "unpaid";
}

/** Invoices that still have a balance, oldest first. */
export function getOutstandingInvoices(data: FinancialData = FINANCIALS): Invoice[] {
  return data.invoices.filter((invoice) => getInvoiceBalance(invoice, data) > 0).sort((a, b) => a.id.localeCompare(b.id));
}

export const getOutstandingBalance = (data: FinancialData = FINANCIALS) =>
  roundMoney(getOutstandingInvoices(data).reduce((sum, invoice) => sum + getInvoiceBalance(invoice, data), 0));

const activePayments = (data: FinancialData) => data.payments.filter((payment) => payment.status === "recorded");

/** Payments that count: recorded, never voided. */
export const getRecordedPaymentsCount = (data: FinancialData = FINANCIALS) => activePayments(data).length;
export const getPaymentsReceivedTotal = (data: FinancialData = FINANCIALS) =>
  roundMoney(activePayments(data).reduce((sum, payment) => sum + payment.amount, 0));

export function getInvoicesForQuote(quoteId: string, data: FinancialData = FINANCIALS): Invoice[] {
  return data.invoices.filter((invoice) => invoice.quoteId === quoteId);
}

/** Invoices created this session (not in the canonical set) are added on top of the approved Overview total. */
const CANONICAL_INVOICE_IDS = new Set(INVOICES.map((invoice) => invoice.id));

/**
 * The Overview's "Total Invoiced". The approved $6,240 covers invoicing history this demo does not carry as
 * records, so it stays a fixed baseline; invoices created during the session are added to it.
 */
export function getTotalInvoiced(data: FinancialData = FINANCIALS): number {
  const created = data.invoices.filter((invoice) => !CANONICAL_INVOICE_IDS.has(invoice.id));
  return roundMoney(overviewMetrics.totalInvoiced + created.reduce((sum, invoice) => sum + getInvoiceTotal(invoice), 0));
}

/** The service named by a record, or its first line item when the record has none. */
export function getRelatedWork(record: { serviceId?: string; lineItems: readonly LineItem[] }): string {
  return (record.serviceId && getServiceById(record.serviceId)?.name) || record.lineItems[0]?.description || "—";
}

/** "Due on receipt", or "Net 15 · due 2024-11-09" (the caller formats the date). */
export function getInvoiceDue(invoice: Invoice): { terms: string; dueDate?: string } {
  const terms = PAYMENT_TERMS.find((item) => item.id === invoice.terms)!;
  return terms.days === 0 ? { terms: terms.label } : { terms: terms.label, dueDate: addDays(invoice.date, terms.days) };
}
