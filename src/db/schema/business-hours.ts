/**
 * An organization's weekly opening hours: one row per day.
 *
 * `day_of_week` follows the application's convention, 0 = Sunday … 6 = Saturday. A closed day has `is_open = false`
 * and no times. Times are wall-clock times in the organization's own time zone and are never converted.
 *
 * Deleting an organization removes its hours (they are configuration, with no value apart from it).
 */
import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, time, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const organizationBusinessHours = pgTable(
  "organization_business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    isOpen: boolean("is_open").notNull().default(false),
    opensAt: time("opens_at"),
    closesAt: time("closes_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("organization_business_hours_org_day_unique").on(table.organizationId, table.dayOfWeek),
    check("organization_business_hours_day", sql`${table.dayOfWeek} between 0 and 6`),
    check(
      "organization_business_hours_times",
      sql`(${table.isOpen} and ${table.opensAt} is not null and ${table.closesAt} is not null and ${table.closesAt} > ${table.opensAt}) or (not ${table.isOpen} and ${table.opensAt} is null and ${table.closesAt} is null)`,
    ),
  ],
).enableRLS();

export type BusinessHoursRow = typeof organizationBusinessHours.$inferSelect;
