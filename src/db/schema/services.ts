/**
 * Services: the catalog a business offers.
 *
 * One row per Service, owned by exactly one organization. The five Service detail areas (Overview, Pricing, Booking
 * settings, Customer intake, Availability & visibility) are modelled explicitly where they are stable and as small JSONB
 * documents where they are configuration:
 *
 *   Overview          name, category, audience[], description, internal_description, duration_minutes
 *   Pricing           pricing_model, price_amount, price_label
 *   Booking settings  booking_method
 *   Availability      is_active, visibility, display_order
 *   Customer intake   intake  (JSONB array of questions, see below), checklist (technician checklist, text[])
 *
 * `intake` contract: an array of
 *   { id: string, prompt: string, type: "single-select" | "photo-upload", required: boolean,
 *     options?: string[], helper?: string }
 * with `options` only for "single-select". It is not a form builder: the approved product has two question types.
 *
 * `slug` is the public reference ("/services/ac-repair-diagnostics"), unique within the organization; the operations
 * sample data points at it. The uuid `id` is internal.
 *
 * Note: a Maintenance Plan's coverage labels ("Cooling maintenance") are plan internals and are never Services.
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const SERVICE_CATEGORY_VALUES = ["Cooling", "Heating", "Heat pumps", "Maintenance", "Emergency"] as const;

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    audience: text("audience").array().notNull().default(sql`'{residential}'::text[]`),
    /** Customer-facing: shown on the website, in the booking flow and in confirmations. */
    description: text("description").notNull(),
    /** Private to the team. */
    internalDescription: text("internal_description"),
    durationMinutes: integer("duration_minutes").notNull(),
    pricingModel: text("pricing_model").notNull(),
    /** US dollars. Null for a free assessment. */
    priceAmount: numeric("price_amount", { precision: 10, scale: 2 }),
    /** "diagnostic fee" | "call fee": only for the diagnostic-fee model. */
    priceLabel: text("price_label"),
    bookingMethod: text("booking_method").notNull(),
    visibility: text("visibility").notNull().default("public-booking"),
    isActive: boolean("is_active").notNull().default(true),
    /** Position in the public service list and booking picker (1 = first). */
    displayOrder: integer("display_order").notNull(),
    intake: jsonb("intake").notNull().default(sql`'[]'::jsonb`),
    checklist: text("checklist").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("services_org_id_unique").on(table.organizationId, table.id),
    unique("services_org_slug_unique").on(table.organizationId, table.slug),
    // Two Services of one business cannot share a name (the form says "A service with this name already exists").
    uniqueIndex("services_org_name_unique").on(table.organizationId, sql`lower(${table.name})`),
    index("services_org_order_idx").on(table.organizationId, table.displayOrder),
    index("services_org_active_idx").on(table.organizationId, table.isActive),
    check("services_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 80`),
    check("services_name_length", sql`char_length(btrim(${table.name})) between 1 and 60`),
    check("services_category", sql`${table.category} in ('Cooling', 'Heating', 'Heat pumps', 'Maintenance', 'Emergency')`),
    check("services_audience", sql`cardinality(${table.audience}) >= 1 and ${table.audience} <@ array['residential', 'commercial']::text[]`),
    check("services_duration", sql`${table.durationMinutes} between 15 and 1440`),
    check("services_pricing_model", sql`${table.pricingModel} in ('diagnostic-fee', 'fixed-price', 'free-assessment')`),
    check(
      "services_pricing_shape",
      // A CHECK passes when it evaluates to NULL, so every comparison on a nullable column is coalesced to a plain true/false.
      sql`(${table.pricingModel} = 'free-assessment' and ${table.priceAmount} is null and ${table.priceLabel} is null)
        or (${table.pricingModel} = 'fixed-price' and coalesce(${table.priceAmount} > 0, false) and ${table.priceLabel} is null)
        or (${table.pricingModel} = 'diagnostic-fee' and coalesce(${table.priceAmount} > 0, false) and coalesce(char_length(btrim(${table.priceLabel})) > 0, false))`,
    ),
    check("services_booking_method", sql`${table.bookingMethod} in ('instant', 'request-appointment', 'request-quote')`),
    check("services_visibility", sql`${table.visibility} in ('public-booking', 'public-only', 'internal')`),
    check("services_intake_shape", sql`jsonb_typeof(${table.intake}) = 'array'`),
  ],
).enableRLS();

export type ServiceRow = typeof services.$inferSelect;
