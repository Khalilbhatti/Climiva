/**
 * Organizations: one row per business workspace.
 *
 * Nothing here knows which business it is. Apex Climate is just a row the development seed inserts; a production
 * signup creates an unrelated row the same way. Everything a business owns (hours, sites, and later customers, jobs,
 * invoices …) carries `organization_id` and is reached through a verified membership, never through the user alone.
 *
 * `fixture_set` is the transitional switch for modules that have not moved to PostgreSQL yet: only an organization
 * flagged with the sample dataset sees that sample content (see docs/saas-architecture.md, "Transitional fixtures").
 * It is not authorization and it is removed once those modules have real tables.
 *
 * A business's logo and brand accent are not columns here: they are its Branding (`organization_branding`, src/db/schema/assets), and the logo is
 * an Asset, so there is no URL on this row to go stale or to point at someone else's file.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** URL-safe and unique across all organizations; generated from the name and made unique on collision. */
    slug: text("slug").notNull().unique(),
    phone: text("phone"),
    email: text("email"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    stateRegion: text("state_region"),
    postalCode: text("postal_code"),
    country: text("country"),
    /** An IANA zone name. Required: there is no sensible default for someone else's business. */
    timezone: text("timezone").notNull(),
    currency: text("currency").notNull().default("USD"),
    dateFormat: text("date_format").notNull().default("mdy-short"),
    timeFormat: text("time_format").notNull().default("12h"),
    fixtureSet: text("fixture_set"),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("organizations_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 63`),
    check("organizations_name_length", sql`char_length(btrim(${table.name})) between 1 and 80`),
    check("organizations_timezone_present", sql`char_length(btrim(${table.timezone})) > 0`),
    check("organizations_currency_code", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("organizations_date_format", sql`${table.dateFormat} in ('mdy-short', 'mdy-numeric', 'dmy-numeric', 'ymd-iso')`),
    check("organizations_time_format", sql`${table.timeFormat} in ('12h', '24h')`),
  ],
).enableRLS();

export type OrganizationRow = typeof organizations.$inferSelect;
