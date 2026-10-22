/**
 * Financials: the queries and the business operations.
 *
 * Like the other query modules, every function takes an open transaction (`tx`) and the organization it works for, and names
 * that organization in every statement's WHERE clause. They are meant to be called from `withTenant(...)`, where Row Level
 * Security enforces the same boundary again. The seed calls the same functions on the owner connection, so the data it writes
 * is exactly what the application reads.
 *
 * The operations (`recordPaymentTx`, `voidPaymentTx`, `createInvoiceFromQuoteTx`, `createQuoteTx`, `updateQuoteStatusTx`) hold the
 * business rules that depend on stored records: that every id a request names belongs to THIS business, that a payment fits the
 * invoice's balance, that a quote is approved before it is billed. They throw a Refusal (lib/refusal) to roll the whole change
 * back, and they are what the server actions and the concurrency specs call.
 *
 * No `server-only` import on purpose: scripts and tests use these too. Nothing under src/ that is a Client Component may
 * import this file (a test enforces it).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FinancialData, QuoteStatus } from "@/data/financials";
import { localToInstant } from "@/lib/business-time";
import {
  canInvoiceError,
  invoiceReference,
  paymentAmountError,
  paymentReference,
  quoteReference,
  quoteTransitionError,
  type NewInvoiceFromQuote,
  type NewPayment,
  type NewQuote,
  type VoidInput,
} from "@/lib/financial-rules";
import { lineCents, toCents } from "@/lib/money";
import { refuse } from "@/lib/refusal";
import { invoiceFromRow, paymentFromRow, quoteFromRow, type FinLookup } from "./fin-mappers";
import { loadRefs, takeNumber, type IdOptions, type Refs } from "./ops-queries";
import type { Tx } from "./index";
import { bookings, invoiceLineItems, invoices, jobs, organizationSequences, payments, quoteLineItems, quotes, teamMembers } from "./schema";
import type { InvoiceLineRow, QuoteLineRow } from "./schema";
import { stableId } from "./stable-id";

const idFor = (options: IdOptions, organizationId: string, kind: string, reference: string) =>
  options.stableIds ? { id: stableId(organizationId, kind, reference) } : {};

/* ───────────────────────── what points at what ───────────────────────── */

/** The operations' references (customers, properties, Services, team) plus the jobs and bookings a document may name. */
export type FinRefs = Refs & {
  jobs: ReadonlyMap<number, { id: string; customerId: string | null }>;
  bookings: ReadonlyMap<number, { id: string; customerId: string | null }>;
  jobNumberById: ReadonlyMap<string, number>;
  bookingNumberById: ReadonlyMap<string, number>;
};

export async function loadFinRefs(tx: Tx, organizationId: string): Promise<FinRefs> {
  const base = await loadRefs(tx, organizationId);
  const jobRows = await tx.select({ id: jobs.id, number: jobs.number, customerId: jobs.customerId }).from(jobs).where(eq(jobs.organizationId, organizationId));
  const bookingRows = await tx.select({ id: bookings.id, number: bookings.number, customerId: bookings.customerId }).from(bookings).where(eq(bookings.organizationId, organizationId));
  return {
    ...base,
    jobs: new Map(jobRows.map((row) => [row.number, { id: row.id, customerId: row.customerId }])),
    bookings: new Map(bookingRows.map((row) => [row.number, { id: row.id, customerId: row.customerId }])),
    jobNumberById: new Map(jobRows.map((row) => [row.id, row.number])),
    bookingNumberById: new Map(bookingRows.map((row) => [row.id, row.number])),
  };
}

/* ───────────────────────── reading ───────────────────────── */

const groupBy = <T extends { sortOrder: number }>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
  return grouped;
};

/** Every quote, invoice and payment of one business, as the screens use them. */
export async function loadFinancials(tx: Tx, organizationId: string, timeZone: string, refs?: FinRefs): Promise<FinancialData> {
  const resolved = refs ?? (await loadFinRefs(tx, organizationId));
  const quoteRows = await tx.select().from(quotes).where(eq(quotes.organizationId, organizationId)).orderBy(asc(quotes.number));
  const quoteLineRows = await tx.select().from(quoteLineItems).where(eq(quoteLineItems.organizationId, organizationId)).orderBy(asc(quoteLineItems.sortOrder));
  const invoiceRows = await tx.select().from(invoices).where(eq(invoices.organizationId, organizationId)).orderBy(asc(invoices.number));
  const invoiceLineRows = await tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.organizationId, organizationId)).orderBy(asc(invoiceLineItems.sortOrder));
  const paymentRows = await tx.select().from(payments).where(eq(payments.organizationId, organizationId)).orderBy(asc(payments.number));

  const lookup: FinLookup = {
    ...resolved.slugs,
    jobs: new Map([...resolved.jobNumberById].map(([id, number]) => [id, `JB-${number}`])),
    bookings: new Map([...resolved.bookingNumberById].map(([id, number]) => [id, `BK-${number}`])),
    quotes: new Map(quoteRows.map((row) => [row.id, quoteReference(row.number)])),
    invoices: new Map(invoiceRows.map((row) => [row.id, invoiceReference(row.number)])),
  };
  const quoteLines = groupBy<QuoteLineRow>(quoteLineRows, (row) => row.quoteId);
  const invoiceLines = groupBy<InvoiceLineRow>(invoiceLineRows, (row) => row.invoiceId);

  return {
    quotes: quoteRows.map((row) => quoteFromRow(row, quoteLines.get(row.id) ?? [], lookup)),
    invoices: invoiceRows.map((row) => invoiceFromRow(row, invoiceLines.get(row.id) ?? [], lookup)),
    payments: paymentRows.map((row) => paymentFromRow(row, lookup, timeZone)),
  };
}

/* ───────────────────────── numbers ───────────────────────── */

const NUMBER_TABLES = { quote: quotes, invoice: invoices, payment: payments } as const;

/**
 * A new document number for the ACTIVE organization: taken from its counter under a row lock (never MAX + 1), and checked against
 * the rows that exist so a counter that fell behind its data cannot repeat a number.
 */
async function allocateNumber(tx: Tx, organizationId: string, kind: keyof typeof NUMBER_TABLES): Promise<number> {
  const table = NUMBER_TABLES[kind];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const number = await takeNumber(tx, kind);
    const taken = await tx.select({ id: table.id }).from(table).where(and(eq(table.organizationId, organizationId), eq(table.number, number))).limit(1);
    if (taken.length === 0) return number;
  }
  throw new Error(`Could not find a free ${kind} number.`);
}

/* ───────────────────────── the business operations ───────────────────────── */

export type FinContext = {
  tx: Tx;
  organizationId: string;
  timeZone: string;
  refs: FinRefs;
  /** Today in the business's time zone ("2024-10-25"). */
  today: string;
  /** The instant a system event happening now is stamped with. */
  stamp: Date;
  /** The signed-in person (a team record linked to them is who "recorded" or "voided" a payment). */
  actorUserId: string;
};

const GONE_INVOICE = "That invoice no longer exists. Reload the page and try again.";
const GONE_PAYMENT = "That payment no longer exists. Reload the page and try again.";
const GONE_QUOTE = "That quote no longer exists. Reload the page and try again.";

/** Serialize everything that spends or restores one invoice's balance. The database takes the same lock in its own guard. */
async function lockInvoicePayments(tx: Tx, invoiceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invoice-payments:${invoiceId}`}, 0))`);
}

/** What an invoice has, in whole cents: its lines' total, what was carried in, what its recorded payments add up to. */
export async function invoiceFigures(tx: Tx, organizationId: string, invoiceId: string) {
  const [invoice] = await tx
    .select({ carried: invoices.previouslyPaidCents })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, invoiceId)))
    .limit(1);
  const [lines] = await tx
    .select({ total: sql<string>`coalesce(sum(${invoiceLineItems.lineTotalCents}), 0)` })
    .from(invoiceLineItems)
    .where(and(eq(invoiceLineItems.organizationId, organizationId), eq(invoiceLineItems.invoiceId, invoiceId)));
  const [received] = await tx
    .select({ total: sql<string>`coalesce(sum(${payments.amountCents}), 0)` })
    .from(payments)
    .where(and(eq(payments.organizationId, organizationId), eq(payments.invoiceId, invoiceId), eq(payments.status, "recorded")));
  const totalCents = Number(lines.total);
  const carriedCents = invoice?.carried ?? 0;
  const receivedCents = Number(received.total);
  return { totalCents, carriedCents, receivedCents, balanceCents: Math.max(0, totalCents - carriedCents - receivedCents) };
}

/** The Team member (if any) that the signed-in person is, to record who recorded or voided a payment. */
async function actorMember(ctx: FinContext): Promise<string | null> {
  const rows = await ctx.tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, ctx.organizationId), eq(teamMembers.userId, ctx.actorUserId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Record a payment against an invoice, atomically: lock the invoice, check the amount fits its balance, number the payment, write
 * it. Two payments made at once cannot both spend the same balance (the second waits, then sees the first). Returns the payment's
 * reference.
 */
export async function recordPaymentTx(ctx: FinContext, input: NewPayment): Promise<string> {
  const { tx, organizationId } = ctx;
  const [invoice] = await tx
    .select({ id: invoices.id, customerId: invoices.customerId })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.number, input.invoiceNumber)))
    .limit(1);
  if (!invoice) return refuse(GONE_INVOICE);

  await lockInvoicePayments(tx, invoice.id);
  const { balanceCents } = await invoiceFigures(tx, organizationId, invoice.id);
  const problem = paymentAmountError(input.amountCents, balanceCents);
  if (problem) refuse(problem, { amount: problem });
  if (input.date > ctx.today) refuse("The payment date can't be in the future.", { date: "The payment date can't be in the future." });

  const number = await allocateNumber(tx, organizationId, "payment");
  await tx.insert(payments).values({
    organizationId,
    number,
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    amountCents: input.amountCents,
    method: input.method,
    status: "recorded",
    paidOn: input.date,
    checkNumber: input.checkNumber ?? null,
    note: input.note ?? null,
    recordedBy: await actorMember(ctx),
    recordedAt: ctx.stamp,
  });
  return paymentReference(number);
}

/** Void a recorded payment: it stays in history, stops counting, and reopens the invoice's balance. Once only. */
export async function voidPaymentTx(ctx: FinContext, input: VoidInput): Promise<void> {
  const { tx, organizationId } = ctx;
  const [payment] = await tx
    .select({ id: payments.id, invoiceId: payments.invoiceId, status: payments.status })
    .from(payments)
    .where(and(eq(payments.organizationId, organizationId), eq(payments.number, input.paymentNumber)))
    .limit(1)
    .for("update");
  if (!payment) return refuse(GONE_PAYMENT);
  await lockInvoicePayments(tx, payment.invoiceId);
  // Read again under the lock: another request may have voided it while this one waited.
  const [current] = await tx.select({ status: payments.status }).from(payments).where(and(eq(payments.organizationId, organizationId), eq(payments.id, payment.id))).limit(1);
  if (current?.status !== "recorded") refuse("That payment has already been voided.");

  await tx
    .update(payments)
    .set({ status: "voided", voidedAt: ctx.stamp, voidReason: input.reason, voidNote: input.note ?? null, voidedBy: await actorMember(ctx) })
    .where(and(eq(payments.organizationId, organizationId), eq(payments.id, payment.id)));
}

/** Copy lines into a new document. The total of a line is worked out here, in whole cents, and the database checks it again. */
type LineInput = { description: string; detail?: string; quantity: number; unit?: string; unitPriceCents: number; serviceId?: string };

function lineValues(organizationId: string, lines: readonly LineInput[], serviceIdBySlug: ReadonlyMap<string, string>) {
  return lines.map((line, index) => ({
    organizationId,
    sortOrder: index + 1,
    description: line.description,
    detail: line.detail ?? null,
    quantity: line.quantity.toFixed(2),
    unit: line.unit ?? null,
    unitPriceCents: line.unitPriceCents,
    lineTotalCents: lineCents(line.quantity, line.unitPriceCents),
    serviceId: line.serviceId ? (serviceIdBySlug.get(line.serviceId) ?? refuse("One of the line items names a service that isn't in your catalog.")) : null,
  }));
}

/** Create an unpaid invoice from an approved quote that has none. The quote is not changed. Returns the invoice's reference. */
export async function createInvoiceFromQuoteTx(ctx: FinContext, input: NewInvoiceFromQuote): Promise<string> {
  const { tx, organizationId } = ctx;
  const [quote] = await tx
    .select()
    .from(quotes)
    .where(and(eq(quotes.organizationId, organizationId), eq(quotes.number, input.quoteNumber)))
    .limit(1)
    .for("update");
  if (!quote) return refuse(GONE_QUOTE);
  const existing = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.organizationId, organizationId), eq(invoices.quoteId, quote.id))).limit(1);
  const problem = canInvoiceError(quote, existing.length > 0);
  if (problem) refuse(problem);

  const lines = await tx.select().from(quoteLineItems).where(and(eq(quoteLineItems.organizationId, organizationId), eq(quoteLineItems.quoteId, quote.id))).orderBy(asc(quoteLineItems.sortOrder));
  const number = await allocateNumber(tx, organizationId, "invoice");
  const [invoice] = await tx
    .insert(invoices)
    .values({
      organizationId,
      number,
      customerId: quote.customerId,
      contactName: quote.contactName,
      propertyId: quote.propertyId,
      serviceId: quote.serviceId,
      jobId: quote.jobId,
      bookingId: quote.bookingId,
      quoteId: quote.id,
      issueDate: ctx.today,
      paymentTerms: input.terms,
      message: input.message ?? null,
    })
    .returning({ id: invoices.id });
  await tx.insert(invoiceLineItems).values(
    lines.map((line) => ({
      organizationId,
      invoiceId: invoice.id,
      sortOrder: line.sortOrder,
      description: line.description,
      detail: line.detail,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
      serviceId: line.serviceId,
    })),
  );
  return invoiceReference(number);
}

/** Create a draft quote with its lines. Every id it names must belong to this business. Returns the quote's reference. */
export async function createQuoteTx(ctx: FinContext, input: NewQuote): Promise<string> {
  const { tx, organizationId, refs } = ctx;

  // The rules still read a quote for a named contact (the table allows one), but a quote made here is for a customer of this business.
  if (!input.customerId) refuse("Choose the customer this quote is for.", { customerId: "Choose a customer." });
  let customerId: string | null = null;
  let propertyId: string | null = null;
  if (input.customerId) {
    customerId = refs.idBySlug.customers.get(input.customerId) ?? null;
    if (!customerId) refuse("That customer is not in your customers any more. Choose another or reload the page.");
    if (input.propertyId) {
      propertyId = refs.idBySlug.properties.get(input.propertyId) ?? null;
      if (!propertyId || refs.propertyOwner.get(propertyId) !== customerId) refuse("That property doesn't belong to this customer.");
    }
  }
  const serviceId = input.serviceId ? (refs.idBySlug.services.get(input.serviceId) ?? refuse("That service is not in your catalog any more.")) : null;
  const job = input.jobNumber === undefined ? undefined : (refs.jobs.get(input.jobNumber) ?? refuse("That job no longer exists."));
  const booking = input.bookingNumber === undefined ? undefined : (refs.bookings.get(input.bookingNumber) ?? refuse("That booking no longer exists."));
  for (const linked of [job, booking]) {
    if (linked && customerId && linked.customerId && linked.customerId !== customerId) refuse("That job or booking belongs to another customer.");
  }

  if (input.validThrough && input.validThrough < ctx.today) refuse("The quote can't be good through a day that has already passed.", { validThrough: "Choose today or a later day." });

  const number = await allocateNumber(tx, organizationId, "quote");
  const [quote] = await tx
    .insert(quotes)
    .values({
      organizationId,
      number,
      customerId,
      contactName: customerId ? null : (input.contactName ?? null),
      propertyId,
      serviceId,
      jobId: job?.id ?? null,
      bookingId: booking?.id ?? null,
      status: "draft",
      createdOn: ctx.today,
      validThrough: input.validThrough ?? null,
      message: input.message ?? null,
    })
    .returning({ id: quotes.id });
  await tx.insert(quoteLineItems).values(lineValues(organizationId, input.lines, refs.idBySlug.services).map((line) => ({ ...line, quoteId: quote.id })));
  return quoteReference(number);
}

/** Move a quote forward: the status changes and the date that step happened on is today's. */
export async function updateQuoteStatusTx(ctx: FinContext, quoteNumber: number, to: QuoteStatus): Promise<void> {
  const { tx, organizationId } = ctx;
  const [quote] = await tx
    .select({ id: quotes.id, status: quotes.status })
    .from(quotes)
    .where(and(eq(quotes.organizationId, organizationId), eq(quotes.number, quoteNumber)))
    .limit(1)
    .for("update");
  if (!quote) return refuse(GONE_QUOTE);
  const problem = quoteTransitionError(quote.status as QuoteStatus, to);
  if (problem) refuse(problem);

  const dates = { sent: { sentOn: ctx.today }, approved: { approvedOn: ctx.today }, declined: { declinedOn: ctx.today }, expired: { expiredOn: ctx.today } } as const;
  await tx
    .update(quotes)
    .set({ status: to, ...(to === "draft" ? {} : dates[to]) })
    .where(and(eq(quotes.organizationId, organizationId), eq(quotes.id, quote.id)));
}

/* ───────────────────────── seed and tests ───────────────────────── */

const highest = (references: readonly string[], prefix: string) =>
  references.reduce((max, reference) => Math.max(max, Number(reference.replace(`${prefix}-`, "")) || 0), 0);

/**
 * Write a whole set of financial records for one business (the sample business, the second seed business, a test copy). Quotes
 * and invoices keep the numbers their references carry, the counters continue after the largest of them (and start at 1001 for a
 * business with none), documents' dates cross unchanged, and instants are read from the local wall-clock in the business's zone.
 * Quotes go first, then invoices (which name them), then payments. Must run after the operations (documents name jobs and bookings).
 */
export async function insertFinancials(tx: Tx, organizationId: string, timeZone: string, data: FinancialData, refs: FinRefs, options: IdOptions = {}): Promise<void> {
  const need = (map: ReadonlyMap<string, string>, slug: string | undefined, what: string): string | null => {
    if (slug === undefined) return null;
    const id = map.get(slug);
    if (!id) throw new Error(`Unknown ${what} "${slug}".`);
    return id;
  };
  const numberOf = (reference: string) => Number(reference.replace(/^\D+-/, ""));
  const linked = (map: ReadonlyMap<number, { id: string }>, reference: string | undefined, what: string): string | null => {
    if (reference === undefined) return null;
    const row = map.get(numberOf(reference));
    if (!row) throw new Error(`Unknown ${what} "${reference}".`);
    return row.id;
  };
  const on = (quote: { activity: readonly { label: string; on: string }[] }, label: string) => quote.activity.find((entry) => entry.label === label)?.on ?? null;
  const lines = (list: readonly LineInput[]) =>
    list.map((line, index) => ({
      sortOrder: index + 1,
      description: line.description,
      detail: line.detail ?? null,
      quantity: line.quantity.toFixed(2),
      unit: line.unit ?? null,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: lineCents(line.quantity, line.unitPriceCents),
      serviceId: need(refs.idBySlug.services, line.serviceId, "service"),
    }));
  const asInput = (items: readonly { description: string; detail?: string; quantity: number; unit?: string; rate: number; serviceId?: string }[]): LineInput[] =>
    items.map((item) => ({ description: item.description, detail: item.detail, quantity: item.quantity, unit: item.unit, unitPriceCents: toCents(item.rate), serviceId: item.serviceId }));

  const quoteIdByReference = new Map<string, string>();
  for (const quote of data.quotes) {
    const [row] = await tx
      .insert(quotes)
      .values({
        organizationId,
        ...idFor(options, organizationId, "quote", quote.id),
        number: numberOf(quote.id),
        customerId: need(refs.idBySlug.customers, quote.customerId, "customer"),
        contactName: quote.contactName ?? null,
        propertyId: need(refs.idBySlug.properties, quote.propertyId, "property"),
        serviceId: need(refs.idBySlug.services, quote.serviceId, "service"),
        jobId: linked(refs.jobs, quote.jobId, "job"),
        bookingId: linked(refs.bookings, quote.bookingId, "booking"),
        status: quote.status,
        createdOn: quote.createdOn,
        sentOn: on(quote, "Quote sent"),
        approvedOn: quote.approvedOn ?? null,
        declinedOn: on(quote, "Quote declined"),
        expiredOn: on(quote, "Quote expired"),
        validThrough: quote.validThrough ?? null,
        message: quote.message ?? null,
      })
      .returning({ id: quotes.id });
    quoteIdByReference.set(quote.id, row.id);
    await tx.insert(quoteLineItems).values(lines(asInput(quote.lineItems)).map((line, index) => ({ ...line, organizationId, ...idFor(options, organizationId, "quote-line", `${quote.id}/${index + 1}`), quoteId: row.id })));
  }

  const invoiceIdByReference = new Map<string, string>();
  for (const invoice of data.invoices) {
    const quoteId = invoice.quoteId ? quoteIdByReference.get(invoice.quoteId) : undefined;
    if (invoice.quoteId && !quoteId) throw new Error(`Unknown quote "${invoice.quoteId}".`);
    const [row] = await tx
      .insert(invoices)
      .values({
        organizationId,
        ...idFor(options, organizationId, "invoice", invoice.id),
        number: numberOf(invoice.id),
        customerId: need(refs.idBySlug.customers, invoice.customerId, "customer"),
        contactName: invoice.contactName ?? null,
        propertyId: need(refs.idBySlug.properties, invoice.propertyId, "property"),
        serviceId: need(refs.idBySlug.services, invoice.serviceId, "service"),
        jobId: linked(refs.jobs, invoice.jobId, "job"),
        bookingId: linked(refs.bookings, invoice.bookingId, "booking"),
        quoteId: quoteId ?? null,
        issueDate: invoice.date,
        paymentTerms: invoice.terms,
        message: invoice.message ?? null,
        imported: invoice.imported ?? false,
        previouslyPaidCents: toCents(invoice.previouslyPaid ?? 0),
      })
      .returning({ id: invoices.id });
    invoiceIdByReference.set(invoice.id, row.id);
    await tx.insert(invoiceLineItems).values(lines(asInput(invoice.lineItems)).map((line, index) => ({ ...line, organizationId, ...idFor(options, organizationId, "invoice-line", `${invoice.id}/${index + 1}`), invoiceId: row.id })));
  }

  for (const payment of data.payments) {
    const invoiceId = invoiceIdByReference.get(payment.invoiceId);
    if (!invoiceId) throw new Error(`Unknown invoice "${payment.invoiceId}".`);
    await tx.insert(payments).values({
      organizationId,
      ...idFor(options, organizationId, "payment", payment.id),
      number: numberOf(payment.id),
      invoiceId,
      amountCents: toCents(payment.amount),
      method: payment.method,
      status: payment.status,
      paidOn: payment.date,
      checkNumber: payment.checkNumber ?? null,
      note: payment.note ?? null,
      recordedBy: need(refs.idBySlug.members, payment.recordedBy, "team member"),
      recordedAt: localToInstant(`${payment.date}T12:00`, timeZone),
      voidedAt: payment.void ? localToInstant(`${payment.void.on}T17:00`, timeZone) : null,
      voidReason: payment.void?.reason ?? null,
      voidNote: payment.void?.note ?? null,
      voidedBy: payment.void ? need(refs.idBySlug.members, payment.void.by, "team member") : null,
    });
  }

  // The counters continue after what was seeded (QT-894 after QT-893, PAY-1009 after PAY-1008), and start at 1001 for a business with none.
  const next = (kind: "quote" | "invoice" | "payment", references: readonly string[], prefix: string) => ({
    organizationId,
    kind,
    nextValue: references.length > 0 ? highest(references, prefix) + 1 : 1001,
  });
  await tx
    .insert(organizationSequences)
    .values([
      next("quote", data.quotes.map((quote) => quote.id), "QT"),
      next("invoice", data.invoices.map((invoice) => invoice.id), "INV"),
      next("payment", data.payments.map((payment) => payment.id), "PAY"),
    ])
    .onConflictDoUpdate({ target: [organizationSequences.organizationId, organizationSequences.kind], set: { nextValue: sql`excluded.next_value`, updatedAt: sql`now()` } });
}

/** Remove every financial record of one organization (tests reset a worker's copy of the sample business with this). */
export async function clearFinancials(tx: Tx, organizationId: string): Promise<void> {
  // Payments before invoices, invoices before quotes (each names the next); lines go with their documents.
  await tx.delete(payments).where(eq(payments.organizationId, organizationId));
  await tx.delete(invoices).where(eq(invoices.organizationId, organizationId));
  await tx.delete(quotes).where(eq(quotes.organizationId, organizationId));
  await tx.delete(organizationSequences).where(and(eq(organizationSequences.organizationId, organizationId), inArray(organizationSequences.kind, ["quote", "invoice", "payment"])));
}
