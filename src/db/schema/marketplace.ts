/**
 * Marketplace: how a business appears in the Climvia directory.
 *
 * A listing owns only listing-specific configuration: its description, a cover treatment, what contact details are visible, which
 * customer actions are offered, which of the business's public Services it shows and in what order, and whether it is published or
 * hidden. It owns NO copy of the business's name, phone, email, address or hours (they stay on the organization) and none of a Service's
 * name, price or duration (a selected Service is a reference to the business's own row).
 *
 * A business has at most one listing (`organization_id` is unique). The absence of a listing IS the "not set up" state: nothing is
 * created until the business sets one up, and a new business has none. `public_slug` is the listing's public identity, globally unique:
 * `/listings/<public_slug>` resolves it to the owning business on the server, never from a browser-supplied organization.
 *
 * Every table carries `organization_id` itself and reaches its parents through composite (organization_id, id) foreign keys, so a
 * listing cannot select another business's Service and a selection cannot belong to another business's listing.
 */
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { services } from "./services";
import { RESERVED_PLATFORM_SLUGS } from "./sites";

export const LISTING_STATUS_VALUES = ["draft", "published", "hidden"] as const;
export const LISTING_COVER_VALUES = ["teal-horizon", "warm-linen", "cool-slate"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    /** The listing's public identity, unique across all listings: `/listings/<public_slug>`. */
    publicSlug: text("public_slug").notNull(),
    /** draft = saved, never published; published = visible in the directory; hidden = taken down, configuration kept. */
    status: text("status").notNull().default("draft"),
    description: text("description").notNull(),
    /** One of the CSS cover treatments, or null for none. There is no image upload. */
    cover: text("cover"),
    showPhone: boolean("show_phone").notNull().default(true),
    showEmail: boolean("show_email").notNull().default(true),
    showAddress: boolean("show_address").notNull().default(true),
    showHours: boolean("show_hours").notNull().default(true),
    showWebsite: boolean("show_website").notNull().default(true),
    actionBook: boolean("action_book").notNull().default(true),
    actionWebsite: boolean("action_website").notNull().default(true),
    actionContact: boolean("action_contact").notNull().default(true),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("marketplace_listings_org_unique").on(table.organizationId),
    unique("marketplace_listings_org_id_unique").on(table.organizationId, table.id),
    unique("marketplace_listings_public_slug_unique").on(table.publicSlug),
    check(
      "marketplace_listings_public_slug_format",
      sql`${table.publicSlug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.publicSlug}) <= 63 and ${table.publicSlug} not in (${list(RESERVED_PLATFORM_SLUGS)})`,
    ),
    check("marketplace_listings_status", sql`${table.status} in (${list(LISTING_STATUS_VALUES)})`),
    check("marketplace_listings_description", sql`char_length(btrim(${table.description})) between 1 and 300`),
    check("marketplace_listings_cover", sql`${table.cover} is null or ${table.cover} in (${list(LISTING_COVER_VALUES)})`),
    // A listing that has never been published has no publication time; one that has been (published or hidden) does.
    check("marketplace_listings_published_at", sql`(${table.status} = 'draft') = (${table.publishedAt} is null)`),
  ],
).enableRLS();

export type MarketplaceListingRow = typeof marketplaceListings.$inferSelect;

/** The Services a listing shows, in order. A row exists exactly for a SELECTED Service. */
export const marketplaceListingServices = pgTable(
  "marketplace_listing_services",
  {
    organizationId: uuid("organization_id").notNull(),
    listingId: uuid("listing_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "marketplace_listing_services_pk", columns: [table.listingId, table.serviceId] }),
    foreignKey({ name: "marketplace_listing_services_listing_fk", columns: [table.organizationId, table.listingId], foreignColumns: [marketplaceListings.organizationId, marketplaceListings.id] }).onDelete("cascade"),
    foreignKey({ name: "marketplace_listing_services_service_fk", columns: [table.organizationId, table.serviceId], foreignColumns: [services.organizationId, services.id] }),
    index("marketplace_listing_services_listing_idx").on(table.listingId, table.sortOrder),
    check("marketplace_listing_services_sort_order", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export type MarketplaceListingServiceRow = typeof marketplaceListingServices.$inferSelect;
