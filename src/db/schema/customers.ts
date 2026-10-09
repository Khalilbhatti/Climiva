/**
 * Customers, their properties and the equipment installed at them.
 *
 * Tenant safety, in two layers:
 *  - every table carries `organization_id` directly (never inferred through a parent), and Row Level Security keys on it;
 *  - every child reaches its parent through a COMPOSITE foreign key (organization_id, parent_id), so a property can only
 *    ever belong to a customer of the SAME organization: PostgreSQL refuses anything else, whoever asks and whatever
 *    the application code does.
 *
 * `slug` is each record's public reference: it appears in URLs ("/customers/sarah-mitchell") and is what the operations
 * sample data (bookings, jobs …) points at while those modules are not yet on the database. It is unique within an
 * organization only. The uuid `id` is internal and is never accepted from, or shown to, a browser.
 *
 * Deliberately absent, because the approved product has none: any kind of customer scoring, revenue-derived figures and
 * live device data. Equipment is a record of what is installed, not a monitoring system.
 *
 * `maintenance_plan`, `last_service` and `upcoming` are display summaries the Customers list shows. They are JSONB for
 * now (`{ name, status, pricePerYear?, visitsPerYear? }`, `{ date, serviceId?, summary?, jobId? }` and
 * `{ at, summary }`, where `serviceId` is a Service's slug and `jobId` a Job's reference such as "JB-204") and are replaced by
 * queries over jobs, bookings and plans when those modules move to the database.
 */
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const CONTACT_CHANNELS = ["SMS", "Phone", "Email"] as const;

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Creation order: lists keep the order records were added in (rows made in one transaction share a timestamp). */
    position: integer("position").generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("residential"),
    phone: text("phone"),
    email: text("email"),
    preferredContact: text("preferred_contact").notNull().default("SMS"),
    language: text("language"),
    preferences: text("preferences").array().notNull().default(sql`'{}'::text[]`),
    maintenancePlan: jsonb("maintenance_plan"),
    lastService: jsonb("last_service"),
    upcoming: jsonb("upcoming"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The target of every child's composite foreign key.
    unique("customers_org_id_unique").on(table.organizationId, table.id),
    unique("customers_org_slug_unique").on(table.organizationId, table.slug),
    index("customers_org_name_idx").on(table.organizationId, sql`lower(${table.name})`),
    check("customers_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 80`),
    check("customers_name_length", sql`char_length(btrim(${table.name})) between 1 and 80`),
    check("customers_type", sql`${table.type} in ('residential')`),
    check("customers_preferred_contact", sql`${table.preferredContact} in ('SMS', 'Phone', 'Email')`),
    check("customers_json_shapes", sql`(${table.maintenancePlan} is null or jsonb_typeof(${table.maintenancePlan}) = 'object') and (${table.lastService} is null or jsonb_typeof(${table.lastService}) = 'object') and (${table.upcoming} is null or jsonb_typeof(${table.upcoming}) = 'object')`),
  ],
).enableRLS();

export type CustomerRow = typeof customers.$inferSelect;

/** Internal notes about a customer: who wrote them and when they were last updated. */
export const customerNotes = pgTable(
  "customer_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    position: integer("position").generatedAlwaysAsIdentity(),
    body: text("body").notNull(),
    /** "YYYY-MM-DD", business-local. */
    updatedOn: text("updated_on").notNull(),
    recordedBy: text("recorded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "customer_notes_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }).onDelete("cascade"),
    index("customer_notes_customer_idx").on(table.organizationId, table.customerId),
    check("customer_notes_body_length", sql`char_length(btrim(${table.body})) between 1 and 4000`),
    check("customer_notes_updated_on", sql`${table.updatedOn} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  ],
).enableRLS();

export type CustomerNoteRow = typeof customerNotes.$inferSelect;

export const customerProperties = pgTable(
  "customer_properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    position: integer("position").generatedAlwaysAsIdentity(),
    slug: text("slug").notNull(),
    /** "Home", "Condo", "Bungalow" … */
    label: text("label").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    stateRegion: text("state_region").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull().default("US"),
    /** Neighborhood, shown in parentheses after the postal code. */
    area: text("area"),
    accessInstructions: text("access_instructions"),
    mechanicalAccess: text("mechanical_access"),
    /** The customer's first property: the one shown in lists and headers. At most one per customer. */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "customer_properties_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }).onDelete("cascade"),
    unique("customer_properties_org_id_unique").on(table.organizationId, table.id),
    unique("customer_properties_org_slug_unique").on(table.organizationId, table.slug),
    uniqueIndex("customer_properties_one_primary").on(table.organizationId, table.customerId).where(sql`${table.isPrimary}`),
    index("customer_properties_customer_idx").on(table.organizationId, table.customerId),
    check("customer_properties_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 80`),
    check("customer_properties_label_length", sql`char_length(btrim(${table.label})) between 1 and 40`),
    check("customer_properties_address_present", sql`char_length(btrim(${table.addressLine1})) > 0 and char_length(btrim(${table.city})) > 0 and char_length(btrim(${table.stateRegion})) > 0 and char_length(btrim(${table.postalCode})) > 0`),
  ],
).enableRLS();

export type CustomerPropertyRow = typeof customerProperties.$inferSelect;

/**
 * A registered piece of equipment at a property. `last_serviced` is a display summary
 * (`{ date, jobId?, serviceId?, note? }`, with `serviceId` a Service's slug) until jobs are on the database.
 */
export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull(),
    position: integer("position").generatedAlwaysAsIdentity(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** e.g. "Heat pump (split system)" */
    kind: text("kind").notNull(),
    /** e.g. "3.0 ton" */
    capacity: text("capacity"),
    manufacturer: text("manufacturer").notNull(),
    model: text("model").notNull(),
    modelCode: text("model_code").notNull(),
    serialNumber: text("serial_number").notNull(),
    /** Where the equipment physically is. */
    location: text("location").notNull(),
    /** "YYYY-MM" */
    inServiceSince: text("in_service_since").notNull(),
    refrigerant: text("refrigerant"),
    filter: text("filter"),
    status: text("status").notNull().default("active"),
    lastServiced: jsonb("last_serviced"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "equipment_property_fk", columns: [table.organizationId, table.propertyId], foreignColumns: [customerProperties.organizationId, customerProperties.id] }).onDelete("cascade"),
    unique("equipment_org_slug_unique").on(table.organizationId, table.slug),
    index("equipment_property_idx").on(table.organizationId, table.propertyId),
    check("equipment_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 80`),
    check("equipment_name_length", sql`char_length(btrim(${table.name})) between 1 and 120`),
    check("equipment_in_service_since", sql`${table.inServiceSince} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check("equipment_status", sql`${table.status} in ('active')`),
    check("equipment_last_serviced_shape", sql`${table.lastServiced} is null or jsonb_typeof(${table.lastServiced}) = 'object'`),
  ],
).enableRLS();

export type EquipmentRow = typeof equipment.$inferSelect;
