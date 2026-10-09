/**
 * Sites: the websites an organization publishes. ONE organization has MANY sites.
 *
 * This phase only fixes the ownership relationship so a page editor can be added later without changing it:
 *
 *     Organization -> many Sites -> (later) Pages -> Sections
 *
 * There is no `organization.website` field anywhere. A site's `selected_template_id` will point at a template preset
 * when templates exist; it is a plain nullable text now. `primary_domain` is unique across all sites once set (a domain
 * can belong to only one site), stored lower-case.
 *
 * Deletion: an organization with sites cannot be deleted (RESTRICT). A site will hold pages people wrote, so it must be
 * removed deliberately, never as a side effect.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const SITE_STATUSES = ["draft", "published", "archived"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Unique within the organization. */
    slug: text("slug").notNull(),
    status: text("status").notNull().default("draft"),
    selectedTemplateId: text("selected_template_id"),
    primaryDomain: text("primary_domain"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sites_org_slug_unique").on(table.organizationId, table.slug),
    uniqueIndex("sites_primary_domain_unique").on(table.primaryDomain).where(sql`${table.primaryDomain} is not null`),
    check("sites_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 63`),
    check("sites_name_length", sql`char_length(btrim(${table.name})) between 1 and 80`),
    check("sites_status", sql`${table.status} in ('draft', 'published', 'archived')`),
    check("sites_primary_domain_lowercase", sql`${table.primaryDomain} is null or ${table.primaryDomain} = lower(${table.primaryDomain})`),
  ],
).enableRLS();

export type SiteRow = typeof sites.$inferSelect;
