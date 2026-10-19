/**
 * Operations: Bookings, Jobs, their files and the Schedule's internal blocks.
 *
 * Every table carries `organization_id` itself and reaches its parents through composite (organization_id, id) foreign
 * keys, so a Booking cannot point at another business's Customer, Property, Service or Team member, and a Job cannot be
 * made from another business's Booking. None of those references cascades: history is kept.
 *
 * The Schedule has no table of its own. It is DERIVED: a Job is the event when one exists, a confirmed or completed Booking
 * without a Job is an event of its own, and `schedule_blocks` hold the internal blocked time.
 *
 * Time. A Booking or Job is an appointment in the business's own wall-clock time: `service_date` (date) with `start_time`
 * and `end_time` (time), read in the organization's IANA time zone. They are deliberately NOT a timestamptz: "Tuesday at
 * 10:00" must stay Tuesday at 10:00 whatever the server's, the browser's or a later daylight-saving rule's time zone is,
 * and nothing converts them. Events of the SYSTEM (received, confirmed, completed) are instants (timestamptz) and are
 * shown in the organization's time zone by the server. See docs/saas-architecture.md "Operations".
 *
 * Human identifiers ("BK-1042", "JB-204") are stored as `number` and unique only within one organization; the uuid `id`
 * is internal. Numbers are allocated by `app_next_number()` (see the RLS migration), never by MAX(number) + 1.
 *
 * Identity of people and things in the UI is their slug (Phase 10): the mappers translate.
 */
import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, time, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customerProperties, customers, equipment } from "./customers";
import { marketplaceListings } from "./marketplace";
import { organizations } from "./organizations";
import { services } from "./services";
import { teamMembers } from "./team";

export const BOOKING_SOURCE_VALUES = ["Website", "Booking link", "Marketplace", "Maintenance plan", "Phone / Front desk", "Email", "Walk-in", "Other"] as const;
export const BOOKING_STATUS_VALUES = ["pending", "confirmed", "completed", "cancelled"] as const;
export const JOB_STATUS_VALUES = ["scheduled", "in-progress", "completed"] as const;
export const FILE_CATEGORY_VALUES = ["Before work", "Diagnostic / Meter", "Equipment serial", "After completion"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * One counter per organization and kind ("booking", "job", "quote", "invoice", "payment"). Read-only for the runtime role: a number is taken through
 * app_next_number(), which locks the row, so two requests can never be given the same one and one business can never
 * move another's counter.
 */
export const organizationSequences = pgTable(
  "organization_sequences",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The next number to hand out. */
    nextValue: integer("next_value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "organization_sequences_pk", columns: [table.organizationId, table.kind] }),
    check("organization_sequences_kind", sql`${table.kind} in ('booking', 'job', 'quote', 'invoice', 'payment')`),
    check("organization_sequences_positive", sql`${table.nextValue} >= 1`),
  ],
).enableRLS();

/**
 * A request or appointment. Exactly one of `customer_id` / `contact_name` identifies who it is for: a person without a
 * Customers record is carried as a name (and optional contact details) until they become a customer.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The "BK-" number. */
    number: integer("number").notNull(),
    customerId: uuid("customer_id"),
    propertyId: uuid("property_id"),
    serviceId: uuid("service_id").notNull(),
    /** The Team member (not a login) the work is assigned to. */
    assigneeId: uuid("assignee_id"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    contactAddress: text("contact_address"),
    /** Where it came from. NULL when it is not known (an older record); every booking made through the application has one. */
    source: text("source"),
    status: text("status").notNull(),
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    /** Short customer note shown under the service in the list. */
    note: text("note"),
    intakeSystemType: text("intake_system_type"),
    intakeEquipment: text("intake_equipment"),
    intakeReportedIssue: text("intake_reported_issue"),
    internalNotes: text("internal_notes"),
    cancellationReason: text("cancellation_reason"),
    /**
     * A random key a public booking form sends with its submission. A second submission with the same key (a double click, a retry)
     * finds the first booking instead of making another. Null for every booking not made from a public page.
     */
    submissionKey: text("submission_key"),
    /**
     * Marketplace attribution. `marketplace_listing_id` is the listing the booking was made through: written only by the public Marketplace booking
     * function, from the listing the page named, never from anything the visitor sent. `discovery_service` and `discovery_location` are what the visitor
     * was looking at (a Service address and a place address from the results page they came from): checked for shape, informational, never used to
     * decide anything. All three are null for a booking that did not come from the Marketplace.
     */
    marketplaceListingId: uuid("marketplace_listing_id"),
    discoveryService: text("discovery_service"),
    discoveryLocation: text("discovery_location"),
    /** When the request arrived. NULL when it is not known (an older record); every booking made through the application has one. */
    receivedAt: timestamp("received_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "bookings_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    // The property must be this customer's own (and this business's).
    foreignKey({
      name: "bookings_property_fk",
      columns: [table.organizationId, table.customerId, table.propertyId],
      foreignColumns: [customerProperties.organizationId, customerProperties.customerId, customerProperties.id],
    }),
    foreignKey({ name: "bookings_service_fk", columns: [table.organizationId, table.serviceId], foreignColumns: [services.organizationId, services.id] }),
    foreignKey({ name: "bookings_assignee_fk", columns: [table.organizationId, table.assigneeId], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    // Migration 0024 makes this ON DELETE SET NULL (marketplace_listing_id): the column list keeps the booking's own organization.
    foreignKey({ name: "bookings_marketplace_listing_fk", columns: [table.organizationId, table.marketplaceListingId], foreignColumns: [marketplaceListings.organizationId, marketplaceListings.id] }).onDelete("set null"),
    unique("bookings_org_id_unique").on(table.organizationId, table.id),
    unique("bookings_org_number_unique").on(table.organizationId, table.number),
    index("bookings_org_status_date_idx").on(table.organizationId, table.status, table.serviceDate),
    index("bookings_org_customer_idx").on(table.organizationId, table.customerId),
    index("bookings_org_service_idx").on(table.organizationId, table.serviceId),
    index("bookings_org_assignee_idx").on(table.organizationId, table.assigneeId),
    uniqueIndex("bookings_org_submission_key_unique").on(table.organizationId, table.submissionKey).where(sql`${table.submissionKey} is not null`),
    check("bookings_submission_key", sql`${table.submissionKey} is null or char_length(${table.submissionKey}) between 8 and 64`),
    check("bookings_marketplace_source", sql`${table.marketplaceListingId} is null or ${table.source} = 'Marketplace'`),
    check(
      "bookings_discovery_shape",
      sql`(${table.discoveryService} is null or (${table.discoveryService} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.discoveryService}) <= 80)) and (${table.discoveryLocation} is null or (${table.discoveryLocation} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.discoveryLocation}) <= 80))`,
    ),
    index("bookings_marketplace_listing_idx").on(table.marketplaceListingId).where(sql`${table.marketplaceListingId} is not null`),
    check("bookings_number_positive", sql`${table.number} >= 1`),
    check("bookings_source", sql`${table.source} in (${list(BOOKING_SOURCE_VALUES)})`),
    check("bookings_status", sql`${table.status} in (${list(BOOKING_STATUS_VALUES)})`),
    check("bookings_time_order", sql`${table.endTime} > ${table.startTime}`),
    // Exactly one of: a Customers record, or a name.
    check("bookings_party", sql`(${table.customerId} is null) = (${table.contactName} is not null)`),
    check("bookings_contact_without_customer", sql`${table.customerId} is null or (${table.contactPhone} is null and ${table.contactEmail} is null and ${table.contactAddress} is null)`),
    check("bookings_property_needs_customer", sql`${table.propertyId} is null or ${table.customerId} is not null`),
    check("bookings_cancellation", sql`(${table.status} = 'cancelled') = (${table.cancellationReason} is not null)`),
  ],
).enableRLS();

export type BookingRow = typeof bookings.$inferSelect;

/** Work to be done, normally created from a confirmed Booking (at most one Job per Booking). */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The "JB-" number. */
    number: integer("number").notNull(),
    bookingId: uuid("booking_id"),
    customerId: uuid("customer_id"),
    propertyId: uuid("property_id"),
    serviceId: uuid("service_id").notNull(),
    assigneeId: uuid("assignee_id"),
    /** The equipment worked on. */
    equipmentId: uuid("equipment_id"),
    contactName: text("contact_name"),
    status: text("status").notNull(),
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    /** A short description of the work, for jobs that don't need the longer details. */
    workSummary: text("work_summary"),
    note: text("note"),
    // Work details, the stable fields the Job screens edit or show.
    technicianDiagnosis: text("technician_diagnosis"),
    workPerformed: text("work_performed"),
    /** Shown to the customer on the completion report. */
    customerSummary: text("customer_summary"),
    /** Private to the team. */
    internalNotes: text("internal_notes"),
    customerRequest: text("customer_request"),
    safetyNote: text("safety_note"),
    /** `[{ label, note?, passed }]`: the diagnostics checklist. Not a form builder: a list the technician's record carries. */
    checklist: jsonb("checklist"),
    completionNotes: text("completion_notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "jobs_booking_fk", columns: [table.organizationId, table.bookingId], foreignColumns: [bookings.organizationId, bookings.id] }),
    foreignKey({ name: "jobs_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({
      name: "jobs_property_fk",
      columns: [table.organizationId, table.customerId, table.propertyId],
      foreignColumns: [customerProperties.organizationId, customerProperties.customerId, customerProperties.id],
    }),
    foreignKey({ name: "jobs_service_fk", columns: [table.organizationId, table.serviceId], foreignColumns: [services.organizationId, services.id] }),
    foreignKey({ name: "jobs_assignee_fk", columns: [table.organizationId, table.assigneeId], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    foreignKey({ name: "jobs_equipment_fk", columns: [table.organizationId, table.equipmentId], foreignColumns: [equipment.organizationId, equipment.id] }),
    unique("jobs_org_id_unique").on(table.organizationId, table.id),
    // A review or a review request names (organization, job, customer), so it cannot pair a job with a customer it is not for.
    unique("jobs_org_id_customer_unique").on(table.organizationId, table.id, table.customerId),
    unique("jobs_org_number_unique").on(table.organizationId, table.number),
    // One Job per Booking (a Job with no Booking, such as a historical visit, has a NULL here and is not constrained).
    unique("jobs_org_booking_unique").on(table.organizationId, table.bookingId),
    index("jobs_org_status_date_idx").on(table.organizationId, table.status, table.serviceDate),
    index("jobs_org_customer_idx").on(table.organizationId, table.customerId),
    index("jobs_org_service_idx").on(table.organizationId, table.serviceId),
    index("jobs_org_assignee_idx").on(table.organizationId, table.assigneeId),
    check("jobs_number_positive", sql`${table.number} >= 1`),
    check("jobs_status", sql`${table.status} in (${list(JOB_STATUS_VALUES)})`),
    check("jobs_time_order", sql`${table.endTime} > ${table.startTime}`),
    check("jobs_party", sql`(${table.customerId} is null) = (${table.contactName} is not null)`),
    check("jobs_property_needs_customer", sql`${table.propertyId} is null or ${table.customerId} is not null`),
    check(
      "jobs_completion",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null and ${table.completionNotes} is not null)
        or (${table.status} <> 'completed' and ${table.completedAt} is null and ${table.completionNotes} is null)`,
    ),
    check("jobs_checklist_shape", sql`${table.checklist} is null or jsonb_typeof(${table.checklist}) = 'array'`),
  ],
).enableRLS();

export type JobRow = typeof jobs.$inferSelect;

/**
 * METADATA of the photos and files on a Job. File contents are never stored in PostgreSQL; `storage_key` is reserved for
 * the object store that does not exist yet, so it is always NULL today. Nothing can be added through the application until
 * it does (files chosen in the screen are held in the browser for that visit only).
 */
export const jobFiles = pgTable(
  "job_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull(),
    position: integer("position").generatedAlwaysAsIdentity(),
    /** The reference the screens use ("file-204-1"), unique within the Job. */
    ref: text("ref").notNull(),
    name: text("name").notNull(),
    sizeKb: integer("size_kb").notNull(),
    category: text("category"),
    caption: text("caption"),
    /** Business-local time the photo was taken. */
    takenAt: time("taken_at"),
    visibility: text("visibility").notNull(),
    /** A short label burned into the thumbnail ("Carrier · SN: 1618E42109"). */
    badge: text("badge"),
    storageKey: text("storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "job_files_job_fk", columns: [table.organizationId, table.jobId], foreignColumns: [jobs.organizationId, jobs.id] }).onDelete("cascade"),
    unique("job_files_job_ref_unique").on(table.jobId, table.ref),
    index("job_files_job_idx").on(table.organizationId, table.jobId),
    check("job_files_category", sql`${table.category} is null or ${table.category} in (${list(FILE_CATEGORY_VALUES)})`),
    check("job_files_visibility", sql`${table.visibility} in ('customer', 'internal')`),
    check("job_files_size", sql`${table.sizeKb} >= 0`),
  ],
).enableRLS();

export type JobFileRow = typeof jobFiles.$inferSelect;

/** Internal blocked time ("Team Safety Training"): not work for a customer. No flow creates one yet, so the app only reads them. */
export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    position: integer("position").generatedAlwaysAsIdentity(),
    /** The reference the Schedule uses ("BLK-1"). */
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("schedule_blocks_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("schedule_blocks_org_ref_unique").on(table.organizationId, table.ref),
    index("schedule_blocks_org_date_idx").on(table.organizationId, table.serviceDate, table.startTime),
    check("schedule_blocks_time_order", sql`${table.endTime} > ${table.startTime}`),
    check("schedule_blocks_title", sql`char_length(btrim(${table.title})) between 1 and 120`),
  ],
).enableRLS();

export type ScheduleBlockRow = typeof scheduleBlocks.$inferSelect;

/** The Team members a block applies to. */
export const scheduleBlockMembers = pgTable(
  "schedule_block_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    blockId: uuid("block_id").notNull(),
    memberId: uuid("member_id").notNull(),
  },
  (table) => [
    primaryKey({ name: "schedule_block_members_pk", columns: [table.blockId, table.memberId] }),
    foreignKey({ name: "schedule_block_members_block_fk", columns: [table.organizationId, table.blockId], foreignColumns: [scheduleBlocks.organizationId, scheduleBlocks.id] }).onDelete("cascade"),
    foreignKey({ name: "schedule_block_members_member_fk", columns: [table.organizationId, table.memberId], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    index("schedule_block_members_member_idx").on(table.organizationId, table.memberId),
  ],
).enableRLS();
