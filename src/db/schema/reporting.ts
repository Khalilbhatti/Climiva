/**
 * Analytics reporting: the one table the reporting layer owns, the imported historical baseline.
 *
 * Analytics is a QUERY layer over the domain tables (bookings, jobs, quotes, invoices, payments, plans, reviews, campaigns): every
 * figure it reports is computed from rows, in the active organization, when the report is asked for. The one thing rows cannot
 * give back is history the system never kept in detail: the sample business's approved workspace totals describe a period whose
 * individual bookings, jobs and quotes were never entered one by one, and whose weekly and per-Service tables were written
 * independently of the sample records. That history lives HERE, as an explicit, separate source.
 *
 * A baseline row is an ADJUSTMENT, not a total: it is the approved figure for a metric MINUS whatever the detailed rows seeded for
 * the same period contribute to it (the seed computes it with the same reporting query the application uses). It is signed: where
 * the approved figure is smaller than the sample records it sits beside (the per-Service and weekly tables, the quoted value), the
 * adjustment is negative. A report is the detailed rows plus the adjustments that apply to the selected period, so
 *
 *   - nothing is counted twice (a seeded row is in the detailed side, the adjustment is only what reconciles it to the approved
 *     figure, and it never changes after the seed);
 *   - a new row, or a change to a seeded one, moves the report by exactly its own contribution;
 *   - an organization with no baseline rows (every new business) reports only what its rows say.
 *
 * Nothing about a baseline is written by the application: the runtime role can read the rows of its ACTIVE organization and
 * nothing else (no INSERT, UPDATE or DELETE privilege, no write policy). The seed, running as the owner, is the only author.
 *
 * `period_start`/`period_end` are the business's calendar days the adjustment describes. An adjustment with a period is reported
 * only when the selected date range covers the WHOLE period (it is never prorated or spread over days it was not recorded for);
 * one with no period describes the state "as of now" (plans, reviews and campaigns) and is always reported.
 */
import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const analyticsImportedBaselines = pgTable(
  "analytics_imported_baselines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Which metric the adjustment belongs to ("bookings.confirmed", "reviews.rating_sum", ...). Defined in lib/analytics-rules. */
    metricKey: text("metric_key").notNull(),
    /** What the metric is split by, where it is split (a Service reference, an audience, the first day of a week); otherwise null. */
    dimension: text("dimension"),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    /** A count, or a sum of whole numbers (a rating sum). Signed. Exactly one of the two values is set. */
    integerValue: integer("integer_value"),
    /** Money, in integer cents. Signed. */
    moneyCents: integer("money_cents"),
    /** Where the adjustment came from: the approved figure and the detailed rows' share it was derived from. Documentation only. */
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One adjustment per metric, split and period. NULLs count as equal, so "no dimension / no period" is also unique.
    unique("baselines_unique").on(table.organizationId, table.metricKey, table.dimension, table.periodStart, table.periodEnd).nullsNotDistinct(),
    index("baselines_org_metric_idx").on(table.organizationId, table.metricKey),
    check("baselines_metric_key", sql`${table.metricKey} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'`),
    check("baselines_dimension", sql`${table.dimension} is null or char_length(${table.dimension}) between 1 and 120`),
    check("baselines_period", sql`(${table.periodStart} is null) = (${table.periodEnd} is null) and (${table.periodStart} is null or ${table.periodEnd} >= ${table.periodStart})`),
    // Exactly one kind of value.
    check("baselines_value", sql`(${table.integerValue} is null) <> (${table.moneyCents} is null)`),
    check("baselines_metadata", sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
).enableRLS();

export type AnalyticsImportedBaselineRow = typeof analyticsImportedBaselines.$inferSelect;
