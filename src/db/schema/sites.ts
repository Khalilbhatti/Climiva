/**
 * Sites and their content: the websites an organization publishes.
 *
 *     Organization  ->  many Sites  ->  many Site Versions  ->  many Pages  ->  many Sections
 *
 * Templates are reusable, application-owned definitions (`site_templates`, not tenant data). A Site's content lives in VERSIONS:
 *
 *   - a Site has at most ONE Draft version, the mutable one the editor changes;
 *   - publishing copies the Draft (its theme, settings, pages and sections) into a NEW, immutable Published version, and then points
 *     `sites.published_version_id` at it. Editing the Draft afterwards never touches a Published version;
 *   - Published versions are kept (the history a rollback would use), numbered 1, 2, 3 ... per site.
 *
 * Every table carries `organization_id` itself and reaches its parent through a composite foreign key that includes it, so a Page cannot
 * belong to another business's Site or Version and a Section cannot sit on another business's Page. No table cascades from a Site: a
 * Site holds pages people wrote, so it is removed deliberately, never as a side effect.
 *
 * There is no `organization.website` field anywhere, and no rule that an organization has one Site. Each organization has ONE PRIMARY site
 * (`is_primary`, at most one per organization): the one the Website module edits until a Sites screen exists.
 *
 * A Site's public identity is `platform_slug`: globally unique, lower-case, the same in `/sites/<platform_slug>` and in
 * `<platform_slug>.climvia.com`. Public pages resolve Site -> owning organization on the server; no organization id ever comes from a
 * browser. Custom domains are not columns of a Site: they are claims in `site_domains` (below), several per Site, each with its own
 * state, and they never replace the platform address.
 */
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import { authUser } from "./auth";
import { organizations } from "./organizations";

export const SITE_STATUSES = ["draft", "published", "archived"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];
export const VERSION_STATUSES = ["draft", "published"] as const;
export const PAGE_TYPE_VALUES = ["home", "services", "content", "contact", "booking"] as const;
export const DOMAIN_STATUS_VALUES = ["pending_verification", "verified", "active", "disabled", "removed"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/** Names a public address may never take: they belong to the platform itself. */
export const RESERVED_PLATFORM_SLUGS = ["www", "app", "api", "admin", "auth", "login", "signup", "mail", "email", "static", "assets", "cdn", "status", "help", "support", "billing", "docs", "blog", "climvia", "sites", "listings"] as const;

/**
 * Reusable site definitions. Owned by the application, written by migrations, readable by the runtime role (active ones only),
 * never changed by a tenant. `definition` is validated structured JSON (lib/site-template): it selects registered section types and
 * variants and gives them text; it holds no component, markup, style or script.
 */
export const siteTemplates = pgTable(
  "site_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    /** The version of the definition's JSON shape (lib/site-template TEMPLATE_SCHEMA). */
    schemaVersion: integer("schema_version").notNull(),
    definition: jsonb("definition").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("site_templates_key_format", sql`${table.key} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.key}) <= 60`),
    check("site_templates_name_length", sql`char_length(btrim(${table.name})) between 1 and 80`),
    check("site_templates_schema_version", sql`${table.schemaVersion} >= 1`),
    check("site_templates_definition_shape", sql`jsonb_typeof(${table.definition}) = 'object' and coalesce((${table.definition} ->> 'schema')::int = ${table.schemaVersion}, false)`),
  ],
).enableRLS();

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
    /** The public identity, unique across ALL sites: `/sites/<platform_slug>` and `<platform_slug>.climvia.com`. */
    platformSlug: text("platform_slug").notNull(),
    /** The organization's primary site: the one the Website module edits. At most one per organization. */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** draft = private (nothing published); published = visitors see `published_version_id`; archived = retired. */
    status: text("status").notNull().default("draft"),
    selectedTemplateId: uuid("selected_template_id").references(() => siteTemplates.id, { onDelete: "restrict" }),
    /** The Published version visitors see. Set only by Publish; null while the site is private. */
    publishedVersionId: uuid("published_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The return type is stated because `sites` and `siteVersions` point at each other (a site's published version, a version's site).
  (table): PgTableExtraConfigValue[] => [
    unique("sites_org_slug_unique").on(table.organizationId, table.slug),
    unique("sites_org_id_unique").on(table.organizationId, table.id),
    unique("sites_platform_slug_unique").on(table.platformSlug),
    uniqueIndex("sites_primary_unique").on(table.organizationId).where(sql`${table.isPrimary}`),
    // The published version is a version OF THIS SITE of this organization (a composite key, so another site's cannot be named).
    foreignKey({
      name: "sites_published_version_fk",
      columns: [table.organizationId, table.id, table.publishedVersionId],
      foreignColumns: [siteVersions.organizationId, siteVersions.siteId, siteVersions.id],
    }),
    check("sites_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 63`),
    check(
      "sites_platform_slug_format",
      sql`${table.platformSlug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.platformSlug}) <= 63 and ${table.platformSlug} not in (${list(RESERVED_PLATFORM_SLUGS)})`,
    ),
    check("sites_name_length", sql`char_length(btrim(${table.name})) between 1 and 80`),
    check("sites_status", sql`${table.status} in ('draft', 'published', 'archived')`),
    // A site is published exactly when it points at a published version.
    check("sites_published_pointer", sql`(${table.status} = 'published') = (${table.publishedVersionId} is not null)`),
  ],
).enableRLS();

export type SiteRow = typeof sites.$inferSelect;

/**
 * A custom domain a Site's business has CLAIMED, and how far the claim has got. Ownership is proved by a TXT record carrying
 * `verification_token` (lib/domain-rules); the claim is then ACTIVATED, which tells this application to serve the Site for requests whose
 * Host is the name. The platform address (`sites.platform_slug`) is separate and never stored here.
 *
 * `hostname` is the normalized ASCII name (lib/hostname) and the ONLY form that is stored, compared or looked up. A name belongs to at most
 * one claim that has not been removed, across every business (a partial unique index), so case, a trailing dot or a Unicode spelling can
 * not make a second claim. A removed claim is history: the name is free again, and the next claim of it gets a new token of its own.
 *
 * The token is private to the people who manage the website: it is read only for them, and is in no public projection and no generic Site
 * object. A claim reaches its Site through a composite (organization_id, site_id) foreign key, so it cannot belong to another business's
 * Site; the transition guard and the lifecycle CHECK (migration 0020) make skipping a state impossible, and no row is ever deleted.
 */
export const siteDomains = pgTable(
  "site_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    siteId: uuid("site_id").notNull(),
    hostname: text("hostname").notNull(),
    status: text("status").notNull().default("pending_verification"),
    /** 32 random bytes as base64url. Never derived from anything, never reused (a unique index), immutable. */
    verificationToken: text("verification_token").notNull(),
    verificationCreatedAt: timestamp("verification_created_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** The Site's main custom domain: at most one per Site, and only an active one. The platform address is main while none is. */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Counts every change to the claim (maintained inside the database). A screen that is behind sends the one it saw and is refused. */
    revision: integer("revision").notNull().default(1),
    createdByUserId: text("created_by_user_id").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({ name: "site_domains_site_fk", columns: [table.organizationId, table.siteId], foreignColumns: [sites.organizationId, sites.id] }).onDelete("restrict"),
    unique("site_domains_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("site_domains_hostname_unique").on(table.hostname).where(sql`${table.status} <> 'removed'`),
    uniqueIndex("site_domains_token_unique").on(table.verificationToken),
    uniqueIndex("site_domains_primary_unique").on(table.siteId).where(sql`${table.isPrimary}`),
    index("site_domains_site_idx").on(table.organizationId, table.siteId),
    check("site_domains_status", sql`${table.status} in (${list(DOMAIN_STATUS_VALUES)})`),
    // Only the normalized ASCII form can be stored: labels of letters, digits and hyphens, a top-level label that starts with a letter (so no IP
    // address), at most 231 characters (so `_climvia-verification.<name>` fits in a DNS name). The platform's own names and development names can not be claimed.
    check(
      "site_domains_hostname_shape",
      sql`${table.hostname} ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' and char_length(${table.hostname}) <= 231`,
    ),
    check(
      "site_domains_hostname_reserved",
      sql`${table.hostname} !~ '(^|\\.)climvia\\.com$' and ${table.hostname} !~ '(^|\\.)(localhost|local|localdomain|internal|invalid)$' and ${table.hostname} !~ '\\.home\\.arpa$'`,
    ),
    check("site_domains_token_format", sql`${table.verificationToken} ~ '^[A-Za-z0-9_-]{43}$'`),
    check(
      "site_domains_lifecycle",
      sql`(${table.status} = 'pending_verification' and ${table.verifiedAt} is null and ${table.activatedAt} is null and ${table.disabledAt} is null and ${table.removedAt} is null)
        or (${table.status} = 'verified' and ${table.verifiedAt} is not null and ${table.activatedAt} is null and ${table.disabledAt} is null and ${table.removedAt} is null)
        or (${table.status} = 'active' and ${table.verifiedAt} is not null and ${table.activatedAt} is not null and ${table.disabledAt} is null and ${table.removedAt} is null)
        or (${table.status} = 'disabled' and ${table.verifiedAt} is not null and ${table.activatedAt} is not null and ${table.disabledAt} is not null and ${table.removedAt} is null)
        or (${table.status} = 'removed' and ${table.removedAt} is not null)`,
    ),
    // Only an active domain can be the Site's main one; disabling or removing a domain therefore ends its being main.
    check("site_domains_primary_is_active", sql`not ${table.isPrimary} or ${table.status} = 'active'`),
    check("site_domains_revision", sql`${table.revision} >= 1`),
  ],
).enableRLS();

export type SiteDomainRow = typeof siteDomains.$inferSelect;

/**
 * One state of a Site's content. A Draft (`status = 'draft'`, no number) is the mutable one; a Published version
 * (`status = 'published'`, numbered, stamped with who and when) is an immutable snapshot. The theme and the site-wide settings (which
 * Services are shown and in what order) belong to the version, so a published version keeps the look and the list it was published with.
 */
export const siteVersions = pgTable(
  "site_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    siteId: uuid("site_id").notNull(),
    /** Null for the Draft; 1, 2, 3 ... for Published versions, in publishing order, unique per site. */
    versionNumber: integer("version_number"),
    status: text("status").notNull(),
    /** The template this content started from (informational; the content is a copy). */
    templateId: uuid("template_id").references(() => siteTemplates.id, { onDelete: "restrict" }),
    theme: jsonb("theme").notNull(),
    /** { serviceDisplay: { order: [service slugs], hidden: [service slugs] } }: references by slug, resolved against the business's own Services. */
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByUserId: text("published_by_user_id").references(() => authUser.id, { onDelete: "set null" }),
    /**
     * Counts every change to a Draft: its theme, settings, pages and sections (maintained inside the database, migration 0015, so no write path can
     * forget it). The Website Builder sends the revision it opened with when it saves or publishes, and a request made against an older
     * one is refused: a tab that is behind can never overwrite what another tab saved. A Published version never changes, so neither does it.
     */
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({ name: "site_versions_site_fk", columns: [table.organizationId, table.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    unique("site_versions_org_id_unique").on(table.organizationId, table.id),
    unique("site_versions_org_site_id_unique").on(table.organizationId, table.siteId, table.id),
    unique("site_versions_site_number_unique").on(table.siteId, table.versionNumber),
    // At most one Draft per site.
    uniqueIndex("site_versions_one_draft").on(table.siteId).where(sql`${table.status} = 'draft'`),
    index("site_versions_site_idx").on(table.organizationId, table.siteId),
    check("site_versions_status", sql`${table.status} in ('draft', 'published')`),
    check("site_versions_number_shape", sql`(${table.status} = 'draft') = (${table.versionNumber} is null) and (${table.versionNumber} is null or ${table.versionNumber} >= 1)`),
    check("site_versions_published_shape", sql`(${table.status} = 'published') = (${table.publishedAt} is not null)`),
    check("site_versions_theme_shape", sql`jsonb_typeof(${table.theme}) = 'object' and coalesce((${table.theme} ->> 'schema')::int = 1, false)`),
    check("site_versions_revision", sql`${table.revision} >= 1`),
    check("site_versions_settings_shape", sql`jsonb_typeof(${table.settings}) = 'object' and octet_length(${table.settings}::text) <= 20000`),
  ],
).enableRLS();

export type SiteVersionRow = typeof siteVersions.$inferSelect;

export const sitePages = pgTable(
  "site_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    siteId: uuid("site_id").notNull(),
    siteVersionId: uuid("site_version_id").notNull(),
    /** The page's stable internal key ("home", "services", "about" ...): its identity across versions. The title and address may change. */
    pageKey: text("page_key").notNull(),
    title: text("title").notNull(),
    /** The page's address segment: empty for the home page (the site's root), otherwise lower-case words. */
    slug: text("slug").notNull(),
    pageType: text("page_type").notNull(),
    sortOrder: integer("sort_order").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "site_pages_version_fk",
      columns: [table.organizationId, table.siteId, table.siteVersionId],
      foreignColumns: [siteVersions.organizationId, siteVersions.siteId, siteVersions.id],
    }),
    unique("site_pages_version_key_unique").on(table.siteVersionId, table.pageKey),
    unique("site_pages_version_slug_unique").on(table.siteVersionId, table.slug),
    unique("site_pages_org_version_id_unique").on(table.organizationId, table.siteId, table.siteVersionId, table.id),
    index("site_pages_version_idx").on(table.siteVersionId, table.sortOrder),
    check("site_pages_key_format", sql`${table.pageKey} ~ '^[a-z][a-z0-9_-]{0,39}$'`),
    check("site_pages_title_length", sql`char_length(btrim(${table.title})) between 1 and 80`),
    check("site_pages_slug_format", sql`${table.slug} = '' or (${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 80)`),
    check("site_pages_type", sql`${table.pageType} in (${list(PAGE_TYPE_VALUES)})`),
    // Only the home page is the site's root.
    check("site_pages_home_root", sql`(${table.pageType} = 'home') = (${table.slug} = '')`),
    check("site_pages_sort_order", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export type SitePageRow = typeof sitePages.$inferSelect;

export const siteSections = pgTable(
  "site_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    siteId: uuid("site_id").notNull(),
    siteVersionId: uuid("site_version_id").notNull(),
    pageId: uuid("page_id").notNull(),
    /** Stable within its page ("hero", "bookingCta"). */
    sectionKey: text("section_key").notNull(),
    /** What the section is called in the editor's list. */
    label: text("label").notNull(),
    /** A registered section type (lib/site-sections). Validated in the application before it is stored: the registry grows with the code. */
    type: text("type").notNull(),
    variant: text("variant").notNull(),
    /** Flat plain-text properties, validated against the type's fields. No markup, styles or script (lib/site-sections validateProps). */
    props: jsonb("props").notNull().default(sql`'{}'::jsonb`),
    sortOrder: integer("sort_order").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "site_sections_page_fk",
      columns: [table.organizationId, table.siteId, table.siteVersionId, table.pageId],
      foreignColumns: [sitePages.organizationId, sitePages.siteId, sitePages.siteVersionId, sitePages.id],
    }),
    unique("site_sections_page_key_unique").on(table.pageId, table.sectionKey),
    index("site_sections_page_idx").on(table.pageId, table.sortOrder),
    index("site_sections_version_idx").on(table.siteVersionId),
    check("site_sections_key_format", sql`${table.sectionKey} ~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$'`),
    check("site_sections_label_length", sql`char_length(btrim(${table.label})) between 1 and 60`),
    check("site_sections_type_format", sql`${table.type} ~ '^[a-z][a-z_]{0,39}$' and ${table.variant} ~ '^[a-z][a-z0-9_-]{0,39}$'`),
    check("site_sections_props_shape", sql`jsonb_typeof(${table.props}) = 'object' and octet_length(${table.props}::text) <= 20000`),
    check("site_sections_sort_order", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export type SiteSectionRow = typeof siteSections.$inferSelect;
