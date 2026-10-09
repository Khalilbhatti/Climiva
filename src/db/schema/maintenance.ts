/**
 * Maintenance Plans: a service agreement between a business and its customer (for example "Comfort Care", $189 a year, two
 * included visits). It is NOT Climvia's own SaaS billing (what Climvia may one day charge a business); that is a
 * different domain with different tables and does not exist yet. Nothing here is shared with it, and nothing here bills anyone:
 * a plan's price describes the agreement, it is not an invoice, a payment or an entitlement engine.
 *
 * Three tables, all organization-scoped, all reaching their parents through composite (organization_id, id) foreign keys so an
 * Apex plan cannot name a Northstar customer or property, and an Apex visit cannot name a Northstar booking, whoever writes it:
 *   maintenance_plans          the agreement: who and where, its terms, its status
 *   maintenance_plan_coverage  what it covers ("Cooling maintenance", "Heating maintenance"), with how many visits of each
 *   maintenance_plan_visits    the included visits, in order; a visit is NOT a booking, but it points at the real Booking
 *                              that schedules it (the ONE record of the appointment)
 *
 * Coverage labels are not Services. They name what a plan includes and say how a visit is booked (which Service of the
 * catalog it is booked as is configuration in the application, see data/maintenance-plans COVERAGE); they never reference the
 * `services` table, so nothing is added to the public catalog.
 *
 * A visit's status (due, scheduled, completed) is kept in step with its Booking by the database (see 0009): scheduling sets it,
 * cancelling the booking reopens it, completing the booking completes it. History is never deleted: a cancelled booking stays
 * pointed at until the visit is booked again.
 *
 * Money is whole cents (lib/money). Dates are the business's calendar dates and are never converted.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { customerProperties, customers } from "./customers";
import { bookings } from "./operations";
import { organizations } from "./organizations";

export const PLAN_STATUS_VALUES = ["active", "pending", "paused", "ended"] as const;
export const PLAN_CADENCE_VALUES = ["year", "month", "one-time"] as const;
export const COVERAGE_KEY_VALUES = ["cooling", "heating"] as const;
export const VISIT_STATUS_VALUES = ["due", "scheduled", "completed"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/* ───────────────────────── plans ───────────────────────── */

/**
 * An agreement for a customer's property. Exactly one of `customer_id` / `contact_name` says who it is for: a person without a
 * Customers record is carried as a name and an address snapshot, the same pattern bookings, jobs and invoices use.
 * `imported` marks a plan carried in from before this system kept its own records (the sample business's history): those are
 * already inside the workspace totals the screens report, so a plan created since adds to them. The runtime role can create
 * only plans that are not imported.
 */
export const maintenancePlans = pgTable(
  "maintenance_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The reference the screens and addresses use ("plan-sarah-comfort-care"), unique within the organization. */
    slug: text("slug").notNull(),
    customerId: uuid("customer_id"),
    contactName: text("contact_name"),
    propertyId: uuid("property_id"),
    /** The address of the covered property for someone without a Customers record. */
    propertyText: text("property_text"),
    name: text("name").notNull(),
    status: text("status").notNull(),
    /** Why a plan is paused or ended. */
    statusNote: text("status_note"),
    /** What the agreement costs per `cadence`: information about the agreement, never charged by Climvia. Whole cents. */
    priceCents: integer("price_cents").notNull(),
    cadence: text("cadence").notNull(),
    startDate: date("start_date", { mode: "string" }),
    /** The renewal / end date. NULL for an open-ended plan. */
    endDate: date("end_date", { mode: "string" }),
    visitsPerYear: integer("visits_per_year").notNull(),
    note: text("note"),
    imported: boolean("imported").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "plans_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    // The property must be this customer's own (and this business's).
    foreignKey({
      name: "plans_property_fk",
      columns: [table.organizationId, table.customerId, table.propertyId],
      foreignColumns: [customerProperties.organizationId, customerProperties.customerId, customerProperties.id],
    }),
    unique("plans_org_id_unique").on(table.organizationId, table.id),
    unique("plans_org_slug_unique").on(table.organizationId, table.slug),
    index("plans_org_status_idx").on(table.organizationId, table.status),
    index("plans_org_customer_idx").on(table.organizationId, table.customerId),
    index("plans_org_property_idx").on(table.organizationId, table.propertyId),
    index("plans_org_end_idx").on(table.organizationId, table.endDate),
    check("plans_slug", sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{0,119}$'`),
    check("plans_status", sql`${table.status} in (${list(PLAN_STATUS_VALUES)})`),
    check("plans_cadence", sql`${table.cadence} in (${list(PLAN_CADENCE_VALUES)})`),
    check("plans_name", sql`char_length(btrim(${table.name})) between 1 and 120`),
    check("plans_price", sql`${table.priceCents} >= 0`),
    check("plans_visits", sql`${table.visitsPerYear} between 0 and 24`),
    check("plans_term", sql`${table.startDate} is null or ${table.endDate} is null or ${table.endDate} > ${table.startDate}`),
    // Exactly one of: a Customers record, or a name.
    check("plans_party", sql`(${table.customerId} is null) = (${table.contactName} is not null)`),
    check("plans_property_needs_customer", sql`${table.propertyId} is null or ${table.customerId} is not null`),
    // An address snapshot belongs to someone without a Customers record; a customer's address is their property's.
    check("plans_address_snapshot", sql`${table.propertyText} is null or ${table.customerId} is null`),
  ],
).enableRLS();

export type MaintenancePlanRow = typeof maintenancePlans.$inferSelect;

/* ───────────────────────── coverage ───────────────────────── */

/**
 * What a plan covers: one row per kind of visit included ("Cooling maintenance" × 1). `coverage_key` is the kind the application
 * knows how to book; `label` is the name shown. Neither references the Service catalog.
 */
export const maintenancePlanCoverage = pgTable(
  "maintenance_plan_coverage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull(),
    coverageKey: text("coverage_key").notNull(),
    label: text("label").notNull(),
    /** How many visits of this kind the plan includes per year. */
    visits: integer("visits").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "plan_coverage_plan_fk", columns: [table.organizationId, table.planId], foreignColumns: [maintenancePlans.organizationId, maintenancePlans.id] }).onDelete("cascade"),
    // A visit names (organization, plan, coverage), so it cannot cover something another plan includes.
    unique("plan_coverage_org_plan_id_unique").on(table.organizationId, table.planId, table.id),
    unique("plan_coverage_key_unique").on(table.planId, table.coverageKey),
    unique("plan_coverage_order_unique").on(table.planId, table.sortOrder),
    index("plan_coverage_plan_idx").on(table.organizationId, table.planId),
    check("plan_coverage_key", sql`${table.coverageKey} in (${list(COVERAGE_KEY_VALUES)})`),
    check("plan_coverage_label", sql`char_length(btrim(${table.label})) between 1 and 80`),
    check("plan_coverage_visits", sql`${table.visits} between 1 and 12`),
  ],
).enableRLS();

export type MaintenancePlanCoverageRow = typeof maintenancePlanCoverage.$inferSelect;

/* ───────────────────────── visits ───────────────────────── */

/**
 * One included visit ("Visit 2 of 2, Cooling maintenance"). It is an entitlement, not an appointment: when it is scheduled,
 * `booking_id` names the real Booking (one booking belongs to at most one visit), and that Booking is the only record of the
 * appointment. `due` = still to book (it may have a target window), `scheduled` = has a live booking, `completed` = done (either
 * before this system kept records, or because its booking was completed).
 */
export const maintenancePlanVisits = pgTable(
  "maintenance_plan_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull(),
    coverageId: uuid("coverage_id"),
    /** The reference the screens use ("plan-sarah-comfort-care-v2"), unique within the organization. */
    ref: text("ref").notNull(),
    /** Position in the plan: "Visit 2 of 2". */
    sequence: integer("sequence").notNull(),
    label: text("label").notNull(),
    /** The target service window. Without one the visit can be booked any time. */
    windowStart: date("window_start", { mode: "string" }),
    windowEnd: date("window_end", { mode: "string" }),
    status: text("status").notNull(),
    /** The Booking that schedules (or last scheduled) this visit. Kept after the booking is cancelled, until the visit is booked again. */
    bookingId: uuid("booking_id"),
    /** The day it was fulfilled. */
    completedOn: date("completed_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "plan_visits_plan_fk", columns: [table.organizationId, table.planId], foreignColumns: [maintenancePlans.organizationId, maintenancePlans.id] }).onDelete("cascade"),
    foreignKey({
      name: "plan_visits_coverage_fk",
      columns: [table.organizationId, table.planId, table.coverageId],
      foreignColumns: [maintenancePlanCoverage.organizationId, maintenancePlanCoverage.planId, maintenancePlanCoverage.id],
    }),
    foreignKey({ name: "plan_visits_booking_fk", columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id] }),
    unique("plan_visits_org_id_unique").on(table.organizationId, table.id),
    unique("plan_visits_org_ref_unique").on(table.organizationId, table.ref),
    unique("plan_visits_order_unique").on(table.planId, table.sequence),
    // A booking schedules at most one visit (a NULL booking is not constrained).
    unique("plan_visits_org_booking_unique").on(table.organizationId, table.bookingId),
    index("plan_visits_plan_idx").on(table.organizationId, table.planId),
    index("plan_visits_org_status_window_idx").on(table.organizationId, table.status, table.windowStart),
    check("plan_visits_ref", sql`${table.ref} ~ '^[a-z0-9][a-z0-9-]{0,159}$'`),
    check("plan_visits_sequence", sql`${table.sequence} >= 1`),
    check("plan_visits_label", sql`char_length(btrim(${table.label})) between 1 and 120`),
    check("plan_visits_status", sql`${table.status} in (${list(VISIT_STATUS_VALUES)})`),
    check("plan_visits_window", sql`(${table.windowStart} is null) = (${table.windowEnd} is null) and (${table.windowStart} is null or ${table.windowEnd} >= ${table.windowStart})`),
    // The status says what happened: scheduled has its booking, and only a completed visit has a completion day (a visit fulfilled
    // before this system kept records may not know its day).
    check("plan_visits_scheduled", sql`${table.status} <> 'scheduled' or ${table.bookingId} is not null`),
    check("plan_visits_completed", sql`${table.completedOn} is null or ${table.status} = 'completed'`),
  ],
).enableRLS();

export type MaintenancePlanVisitRow = typeof maintenancePlanVisits.$inferSelect;
