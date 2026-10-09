/**
 * Financials: rows <-> the shapes the screens already use.
 *
 * The UI types (Quote, Invoice, Payment, LineItem) predate the database and stay as they are; this file is the only place that
 * knows how they map to columns. A record's `id` in the UI is its display number ("INV-1044"); the people and things it points at
 * are their public references: slugs for customers, properties, Services and team members, "JB-204" and "BK-1042" for the job and
 * booking, "QT-884" for the quote an invoice came from. The database uuids never leave the server. Amounts leave as dollars (cents
 * divided by 100), a display value; a document's dates are the business's calendar dates and cross unchanged; the instants
 * (recorded, voided) are written out in the organization's time zone here, on the server.
 *
 * No `server-only` here on purpose: the seed and the tests import it too.
 */
import type { Invoice, LineItem, Payment, PaymentMethod, PaymentTerms, Quote, QuoteStatus } from "@/data/financials";
import { instantToLocal } from "@/lib/business-time";
import { invoiceReference, paymentReference, quoteReference } from "@/lib/financial-rules";
import { fromCents } from "@/lib/money";
import type { InvoiceLineRow, InvoiceRow, PaymentRow, QuoteLineRow, QuoteRow } from "./schema";
import type { SlugLookup } from "./ops-mappers";

const orUndefined = <T,>(value: T | null | undefined): T | undefined => (value === null || value === undefined ? undefined : value);

/** What a financial row points at, by database id: the public reference of each. */
export type FinLookup = SlugLookup & {
  jobs: ReadonlyMap<string, string>;
  bookings: ReadonlyMap<string, string>;
  quotes: ReadonlyMap<string, string>;
  invoices: ReadonlyMap<string, string>;
};

type PartyRow = { customerId: string | null; contactName: string | null; propertyId: string | null; serviceId: string | null; jobId: string | null; bookingId: string | null };

function party(row: PartyRow, lookup: FinLookup) {
  return {
    customerId: row.customerId ? lookup.customers.get(row.customerId) : undefined,
    contactName: orUndefined(row.contactName),
    propertyId: row.propertyId ? lookup.properties.get(row.propertyId) : undefined,
    serviceId: row.serviceId ? lookup.services.get(row.serviceId) : undefined,
    jobId: row.jobId ? lookup.jobs.get(row.jobId) : undefined,
    bookingId: row.bookingId ? lookup.bookings.get(row.bookingId) : undefined,
  };
}

export function lineFromRow(row: QuoteLineRow | InvoiceLineRow, lookup: FinLookup): LineItem {
  return {
    id: `line-${row.sortOrder}`,
    description: row.description,
    detail: orUndefined(row.detail),
    quantity: Number(row.quantity),
    unit: orUndefined(row.unit),
    rate: fromCents(row.unitPriceCents),
    serviceId: row.serviceId ? lookup.services.get(row.serviceId) : undefined,
  };
}

/**
 * A quote's activity is its life read off the dates each step happened on, newest first (on a tie, the later step first): there
 * is no second log to keep in step with the status.
 */
export function quoteActivity(row: QuoteRow): { label: string; on: string }[] {
  const steps: { label: string; on: string | null; rank: number }[] = [
    { label: "Quote created", on: row.createdOn, rank: 1 },
    { label: "Quote sent", on: row.sentOn, rank: 2 },
    { label: "Quote approved", on: row.approvedOn, rank: 3 },
    { label: "Quote declined", on: row.declinedOn, rank: 3 },
    { label: "Quote expired", on: row.expiredOn, rank: 3 },
  ];
  return steps
    .filter((step): step is { label: string; on: string; rank: number } => step.on !== null)
    .sort((a, b) => b.on.localeCompare(a.on) || b.rank - a.rank)
    .map(({ label, on }) => ({ label, on }));
}

export function quoteFromRow(row: QuoteRow, lines: readonly QuoteLineRow[], lookup: FinLookup): Quote {
  const activity = quoteActivity(row);
  return {
    id: quoteReference(row.number),
    ...party(row, lookup),
    status: row.status as QuoteStatus,
    lineItems: [...lines].sort((a, b) => a.sortOrder - b.sortOrder).map((line) => lineFromRow(line, lookup)),
    createdOn: row.createdOn,
    approvedOn: orUndefined(row.approvedOn),
    validThrough: orUndefined(row.validThrough),
    updatedOn: activity[0].on,
    message: orUndefined(row.message),
    activity,
  };
}

export function invoiceFromRow(row: InvoiceRow, lines: readonly InvoiceLineRow[], lookup: FinLookup): Invoice {
  return {
    id: invoiceReference(row.number),
    ...party(row, lookup),
    quoteId: row.quoteId ? lookup.quotes.get(row.quoteId) : undefined,
    date: row.issueDate,
    terms: row.paymentTerms as PaymentTerms,
    lineItems: [...lines].sort((a, b) => a.sortOrder - b.sortOrder).map((line) => lineFromRow(line, lookup)),
    previouslyPaid: row.previouslyPaidCents > 0 ? fromCents(row.previouslyPaidCents) : undefined,
    imported: row.imported ? true : undefined,
    message: orUndefined(row.message),
  };
}

export function paymentFromRow(row: PaymentRow, lookup: FinLookup, timeZone: string): Payment {
  const voided = row.status === "voided" && row.voidedAt !== null;
  return {
    id: paymentReference(row.number),
    invoiceId: lookup.invoices.get(row.invoiceId) ?? "",
    amount: fromCents(row.amountCents),
    method: row.method as PaymentMethod,
    date: row.paidOn,
    checkNumber: orUndefined(row.checkNumber),
    note: orUndefined(row.note),
    status: row.status as Payment["status"],
    recordedBy: row.recordedBy ? lookup.members.get(row.recordedBy) : undefined,
    void: voided
      ? {
          reason: row.voidReason ?? "",
          on: instantToLocal(row.voidedAt!, timeZone).slice(0, 10),
          by: row.voidedBy ? lookup.members.get(row.voidedBy) : undefined,
          note: orUndefined(row.voidNote),
        }
      : undefined,
  };
}
