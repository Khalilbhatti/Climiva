/**
 * Business financials: the money a business receives from its customers. Quotes, Invoices and Payments.
 *
 * This is NOT Climvia's own billing (what Climvia may one day charge a business for using Climvia). That is a different
 * domain with different tables and does not exist yet; nothing here is shared with it.
 *
 * Every table carries its own `organization_id` and reaches its parents through composite (organization_id, id) foreign keys, so
 * an Apex payment cannot name a Northstar invoice, an invoice cannot name another business's job or customer, and a line cannot
 * name another business's Service, whoever writes the row. Row Level Security (0007) lets members of the ACTIVE organization read
 * and owners and admins write; nothing is ever deleted (an invoice is paid, a payment is VOIDED).
 *
 * Money is an integer number of cents (see lib/money): no float, no `money` type. A quantity is numeric(10,2) and a line total is
 * `round(quantity * unit_price_cents)`, which a CHECK repeats. Invoice and quote TOTALS are not stored: they are the sum of the
 * line totals, and an invoice's paid amount, balance and status are derived from its payments, so none of them can drift.
 *
 * Dates. A document's dates (issued, sent, approved, due, the day a payment was received) are the business's own calendar dates
 * and are never converted. Only events of the system (recorded, voided) are instants (timestamptz), shown in the organization's
 * time zone.
 *
 * Human identifiers ("QT-884", "INV-1044", "PAY-1008") are an integer `number` unique within the organization, allocated by
 * app_next_number() (see 0005/0007) like booking and job numbers.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { bookings, jobs } from "./operations";
import { customerProperties, customers } from "./customers";
import { organizations } from "./organizations";
import { services } from "./services";
import { teamMembers } from "./team";

export const QUOTE_STATUS_VALUES = ["draft", "sent", "approved", "declined", "expired"] as const;
export const PAYMENT_TERMS_VALUES = ["due-on-receipt", "net-7", "net-15", "net-30"] as const;
export const PAYMENT_METHOD_VALUES = ["check", "card", "cash", "bank-transfer", "other"] as const;
export const PAYMENT_STATUS_VALUES = ["recorded", "voided"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/* ───────────────────────── quotes ───────────────────────── */

/**
 * A priced proposal. Exactly one of `customer_id` / `contact_name` says who it is for. Its life (draft, sent, approved, declined,
 * expired) is recorded by the date each step happened on, so the activity list is a derivation, not a second log.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The "QT-" number. */
    number: integer("number").notNull(),
    customerId: uuid("customer_id"),
    contactName: text("contact_name"),
    propertyId: uuid("property_id"),
    /** The Service the work is, shown as "related work". */
    serviceId: uuid("service_id"),
    jobId: uuid("job_id"),
    bookingId: uuid("booking_id"),
    status: text("status").notNull(),
    createdOn: date("created_on", { mode: "string" }).notNull(),
    sentOn: date("sent_on", { mode: "string" }),
    approvedOn: date("approved_on", { mode: "string" }),
    declinedOn: date("declined_on", { mode: "string" }),
    expiredOn: date("expired_on", { mode: "string" }),
    /** The last day the quote can be approved. */
    validThrough: date("valid_through", { mode: "string" }),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "quotes_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({
      name: "quotes_property_fk",
      columns: [table.organizationId, table.customerId, table.propertyId],
      foreignColumns: [customerProperties.organizationId, customerProperties.customerId, customerProperties.id],
    }),
    foreignKey({ name: "quotes_service_fk", columns: [table.organizationId, table.serviceId], foreignColumns: [services.organizationId, services.id] }),
    foreignKey({ name: "quotes_job_fk", columns: [table.organizationId, table.jobId], foreignColumns: [jobs.organizationId, jobs.id] }),
    foreignKey({ name: "quotes_booking_fk", columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id] }),
    unique("quotes_org_id_unique").on(table.organizationId, table.id),
    unique("quotes_org_number_unique").on(table.organizationId, table.number),
    index("quotes_org_status_idx").on(table.organizationId, table.status),
    index("quotes_org_customer_idx").on(table.organizationId, table.customerId),
    index("quotes_org_job_idx").on(table.organizationId, table.jobId),
    index("quotes_org_created_idx").on(table.organizationId, table.createdOn),
    check("quotes_number_positive", sql`${table.number} >= 1`),
    check("quotes_status", sql`${table.status} in (${list(QUOTE_STATUS_VALUES)})`),
    check("quotes_party", sql`(${table.customerId} is null) = (${table.contactName} is not null)`),
    check("quotes_property_needs_customer", sql`${table.propertyId} is null or ${table.customerId} is not null`),
    // The status says what happened, and the date says when: a quote is never Approved without an approval date, and so on.
    check(
      "quotes_status_dates",
      sql`(${table.status} <> 'sent' or ${table.sentOn} is not null)
        and (${table.status} <> 'approved' or (${table.sentOn} is not null and ${table.approvedOn} is not null))
        and (${table.status} <> 'declined' or (${table.sentOn} is not null and ${table.declinedOn} is not null))
        and (${table.status} <> 'expired' or (${table.sentOn} is not null and ${table.expiredOn} is not null))
        and (${table.status} = 'approved' or ${table.approvedOn} is null)
        and (${table.status} = 'declined' or ${table.declinedOn} is null)
        and (${table.status} = 'expired' or ${table.expiredOn} is null)
        and (${table.status} <> 'draft' or ${table.sentOn} is null)`,
    ),
  ],
).enableRLS();

export type QuoteRow = typeof quotes.$inferSelect;

/** One priced line of a quote. A line may name the Service it was priced from; a free-form line has none. */
export const quoteLineItems = pgTable(
  "quote_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").notNull(),
    /** 1, 2, 3 …: the order the lines are shown in. */
    sortOrder: integer("sort_order").notNull(),
    description: text("description").notNull(),
    detail: text("detail"),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    /** "hrs" when the quantity is hours. */
    unit: text("unit"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    serviceId: uuid("service_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "quote_lines_quote_fk", columns: [table.organizationId, table.quoteId], foreignColumns: [quotes.organizationId, quotes.id] }).onDelete("cascade"),
    foreignKey({ name: "quote_lines_service_fk", columns: [table.organizationId, table.serviceId], foreignColumns: [services.organizationId, services.id] }),
    unique("quote_lines_order_unique").on(table.quoteId, table.sortOrder),
    index("quote_lines_quote_idx").on(table.organizationId, table.quoteId),
    check("quote_lines_quantity", sql`${table.quantity} > 0`),
    check("quote_lines_price", sql`${table.unitPriceCents} >= 0`),
    check("quote_lines_total", sql`${table.lineTotalCents} = round(${table.quantity} * ${table.unitPriceCents})`),
  ],
).enableRLS();

export type QuoteLineRow = typeof quoteLineItems.$inferSelect;

/* ───────────────────────── invoices ───────────────────────── */

/**
 * A bill. It has no status, paid amount or balance of its own: those are derived from its lines and its payments. It may come from
 * a Quote (`quote_id`, at most one invoice per quote) but does not have to.
 *
 * `imported` marks an invoice carried in from before this system kept its own records (the Apex sample's history). Only an
 * imported invoice may carry `previously_paid_cents`: money received before payment records were kept, which counts toward the
 * balance but is not a Payment. The runtime role can create neither (see 0007): only the seed writes them.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The "INV-" number. */
    number: integer("number").notNull(),
    customerId: uuid("customer_id"),
    contactName: text("contact_name"),
    propertyId: uuid("property_id"),
    serviceId: uuid("service_id"),
    jobId: uuid("job_id"),
    bookingId: uuid("booking_id"),
    quoteId: uuid("quote_id"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    paymentTerms: text("payment_terms").notNull(),
    /** issue_date plus the terms' days, worked out by PostgreSQL so it cannot disagree with them. */
    dueDate: date("due_date", { mode: "string" }).generatedAlwaysAs(
      sql`issue_date + (case payment_terms when 'net-7' then 7 when 'net-15' then 15 when 'net-30' then 30 else 0 end)`,
    ),
    message: text("message"),
    imported: boolean("imported").notNull().default(false),
    previouslyPaidCents: integer("previously_paid_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "invoices_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({
      name: "invoices_property_fk",
      columns: [table.organizationId, table.customerId, table.propertyId],
      foreignColumns: [customerProperties.organizationId, customerProperties.customerId, customerProperties.id],
    }),
    foreignKey({ name: "invoices_service_fk", columns: [table.organizationId, table.serviceId], foreignColumns: [services.organizationId, services.id] }),
    foreignKey({ name: "invoices_job_fk", columns: [table.organizationId, table.jobId], foreignColumns: [jobs.organizationId, jobs.id] }),
    foreignKey({ name: "invoices_booking_fk", columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id] }),
    foreignKey({ name: "invoices_quote_fk", columns: [table.organizationId, table.quoteId], foreignColumns: [quotes.organizationId, quotes.id] }),
    unique("invoices_org_id_unique").on(table.organizationId, table.id),
    // A payment names (organization, invoice, customer), so it cannot disagree with its invoice about whose it is.
    unique("invoices_org_id_customer_unique").on(table.organizationId, table.id, table.customerId),
    unique("invoices_org_number_unique").on(table.organizationId, table.number),
    // One invoice per quote (a NULL quote is not constrained: not every invoice comes from one).
    unique("invoices_org_quote_unique").on(table.organizationId, table.quoteId),
    index("invoices_org_customer_idx").on(table.organizationId, table.customerId),
    index("invoices_org_job_idx").on(table.organizationId, table.jobId),
    index("invoices_org_issue_idx").on(table.organizationId, table.issueDate),
    index("invoices_org_due_idx").on(table.organizationId, table.dueDate),
    check("invoices_number_positive", sql`${table.number} >= 1`),
    check("invoices_terms", sql`${table.paymentTerms} in (${list(PAYMENT_TERMS_VALUES)})`),
    check("invoices_party", sql`(${table.customerId} is null) = (${table.contactName} is not null)`),
    check("invoices_property_needs_customer", sql`${table.propertyId} is null or ${table.customerId} is not null`),
    check("invoices_previously_paid", sql`${table.previouslyPaidCents} >= 0 and (${table.previouslyPaidCents} = 0 or ${table.imported})`),
  ],
).enableRLS();

export type InvoiceRow = typeof invoices.$inferSelect;

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    description: text("description").notNull(),
    detail: text("detail"),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    unit: text("unit"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    serviceId: uuid("service_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "invoice_lines_invoice_fk", columns: [table.organizationId, table.invoiceId], foreignColumns: [invoices.organizationId, invoices.id] }).onDelete("cascade"),
    foreignKey({ name: "invoice_lines_service_fk", columns: [table.organizationId, table.serviceId], foreignColumns: [services.organizationId, services.id] }),
    unique("invoice_lines_order_unique").on(table.invoiceId, table.sortOrder),
    index("invoice_lines_invoice_idx").on(table.organizationId, table.invoiceId),
    check("invoice_lines_quantity", sql`${table.quantity} > 0`),
    check("invoice_lines_price", sql`${table.unitPriceCents} >= 0`),
    check("invoice_lines_total", sql`${table.lineTotalCents} = round(${table.quantity} * ${table.unitPriceCents})`),
  ],
).enableRLS();

export type InvoiceLineRow = typeof invoiceLineItems.$inferSelect;

/* ───────────────────────── payments ───────────────────────── */

/**
 * Money a customer paid, as recorded by the business (nothing is processed here: no card or bank is ever contacted). A payment is
 * recorded once and never edited: the runtime role cannot change its invoice, customer, amount or date. A mistake is corrected
 * by VOIDING it (status "voided", with when, why and by whom); a voided payment stays in history and counts toward nothing.
 *
 * `customer_id` is set by PostgreSQL from the payment's invoice (0007) and held to it by a composite foreign key, so a payment
 * can never claim a customer its invoice does not have.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The "PAY-" number. */
    number: integer("number").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    customerId: uuid("customer_id"),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").notNull(),
    status: text("status").notNull(),
    /** The day the business received the money: a calendar date, never converted. */
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    checkNumber: text("check_number"),
    note: text("note"),
    /** The Team member who recorded it, when the person has a Team record. */
    recordedBy: uuid("recorded_by"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    voidNote: text("void_note"),
    voidedBy: uuid("voided_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "payments_invoice_fk", columns: [table.organizationId, table.invoiceId], foreignColumns: [invoices.organizationId, invoices.id] }),
    foreignKey({
      name: "payments_invoice_customer_fk",
      columns: [table.organizationId, table.invoiceId, table.customerId],
      foreignColumns: [invoices.organizationId, invoices.id, invoices.customerId],
    }),
    foreignKey({ name: "payments_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({ name: "payments_recorded_by_fk", columns: [table.organizationId, table.recordedBy], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    foreignKey({ name: "payments_voided_by_fk", columns: [table.organizationId, table.voidedBy], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    unique("payments_org_id_unique").on(table.organizationId, table.id),
    unique("payments_org_number_unique").on(table.organizationId, table.number),
    index("payments_org_invoice_idx").on(table.organizationId, table.invoiceId),
    index("payments_org_customer_idx").on(table.organizationId, table.customerId),
    index("payments_org_paid_idx").on(table.organizationId, table.paidOn),
    index("payments_org_status_idx").on(table.organizationId, table.status),
    check("payments_number_positive", sql`${table.number} >= 1`),
    check("payments_amount", sql`${table.amountCents} > 0`),
    check("payments_method", sql`${table.method} in (${list(PAYMENT_METHOD_VALUES)})`),
    check("payments_status", sql`${table.status} in (${list(PAYMENT_STATUS_VALUES)})`),
    // Voided means all of: a time, a reason. Recorded means none of them.
    check(
      "payments_void",
      sql`(${table.status} = 'voided' and ${table.voidedAt} is not null and ${table.voidReason} is not null)
        or (${table.status} = 'recorded' and ${table.voidedAt} is null and ${table.voidReason} is null and ${table.voidNote} is null and ${table.voidedBy} is null)`,
    ),
  ],
).enableRLS();

export type PaymentRow = typeof payments.$inferSelect;
