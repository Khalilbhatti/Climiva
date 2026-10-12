CREATE TABLE "site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"site_version_id" uuid NOT NULL,
	"page_key" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"page_type" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_pages_version_key_unique" UNIQUE("site_version_id","page_key"),
	CONSTRAINT "site_pages_version_slug_unique" UNIQUE("site_version_id","slug"),
	CONSTRAINT "site_pages_org_version_id_unique" UNIQUE("organization_id","site_id","site_version_id","id"),
	CONSTRAINT "site_pages_key_format" CHECK ("site_pages"."page_key" ~ '^[a-z][a-z0-9_-]{0,39}$'),
	CONSTRAINT "site_pages_title_length" CHECK (char_length(btrim("site_pages"."title")) between 1 and 80),
	CONSTRAINT "site_pages_slug_format" CHECK ("site_pages"."slug" = '' or ("site_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("site_pages"."slug") <= 80)),
	CONSTRAINT "site_pages_type" CHECK ("site_pages"."page_type" in ('home', 'services', 'content', 'contact', 'booking')),
	CONSTRAINT "site_pages_home_root" CHECK (("site_pages"."page_type" = 'home') = ("site_pages"."slug" = '')),
	CONSTRAINT "site_pages_sort_order" CHECK ("site_pages"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "site_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"site_version_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"variant" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_sections_page_key_unique" UNIQUE("page_id","section_key"),
	CONSTRAINT "site_sections_key_format" CHECK ("site_sections"."section_key" ~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$'),
	CONSTRAINT "site_sections_label_length" CHECK (char_length(btrim("site_sections"."label")) between 1 and 60),
	CONSTRAINT "site_sections_type_format" CHECK ("site_sections"."type" ~ '^[a-z][a-z_]{0,39}$' and "site_sections"."variant" ~ '^[a-z][a-z0-9_-]{0,39}$'),
	CONSTRAINT "site_sections_props_shape" CHECK (jsonb_typeof("site_sections"."props") = 'object' and octet_length("site_sections"."props"::text) <= 20000),
	CONSTRAINT "site_sections_sort_order" CHECK ("site_sections"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "site_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"schema_version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_templates_key_unique" UNIQUE("key"),
	CONSTRAINT "site_templates_key_format" CHECK ("site_templates"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("site_templates"."key") <= 60),
	CONSTRAINT "site_templates_name_length" CHECK (char_length(btrim("site_templates"."name")) between 1 and 80),
	CONSTRAINT "site_templates_schema_version" CHECK ("site_templates"."schema_version" >= 1),
	CONSTRAINT "site_templates_definition_shape" CHECK (jsonb_typeof("site_templates"."definition") = 'object' and coalesce(("site_templates"."definition" ->> 'schema')::int = "site_templates"."schema_version", false))
);
--> statement-breakpoint
ALTER TABLE "site_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"version_number" integer,
	"status" text NOT NULL,
	"template_id" uuid,
	"theme" jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_versions_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "site_versions_org_site_id_unique" UNIQUE("organization_id","site_id","id"),
	CONSTRAINT "site_versions_site_number_unique" UNIQUE("site_id","version_number"),
	CONSTRAINT "site_versions_status" CHECK ("site_versions"."status" in ('draft', 'published')),
	CONSTRAINT "site_versions_number_shape" CHECK (("site_versions"."status" = 'draft') = ("site_versions"."version_number" is null) and ("site_versions"."version_number" is null or "site_versions"."version_number" >= 1)),
	CONSTRAINT "site_versions_published_shape" CHECK (("site_versions"."status" = 'published') = ("site_versions"."published_at" is not null)),
	CONSTRAINT "site_versions_theme_shape" CHECK (jsonb_typeof("site_versions"."theme") = 'object' and coalesce(("site_versions"."theme" ->> 'schema')::int = 1, false)),
	CONSTRAINT "site_versions_settings_shape" CHECK (jsonb_typeof("site_versions"."settings") = 'object' and octet_length("site_versions"."settings"::text) <= 20000)
);
--> statement-breakpoint
ALTER TABLE "site_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketplace_listing_services" (
	"organization_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_listing_services_pk" PRIMARY KEY("listing_id","service_id"),
	CONSTRAINT "marketplace_listing_services_sort_order" CHECK ("marketplace_listing_services"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "marketplace_listing_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"public_slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text NOT NULL,
	"cover" text,
	"show_phone" boolean DEFAULT true NOT NULL,
	"show_email" boolean DEFAULT true NOT NULL,
	"show_address" boolean DEFAULT true NOT NULL,
	"show_hours" boolean DEFAULT true NOT NULL,
	"show_website" boolean DEFAULT true NOT NULL,
	"action_book" boolean DEFAULT true NOT NULL,
	"action_website" boolean DEFAULT true NOT NULL,
	"action_contact" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_listings_org_unique" UNIQUE("organization_id"),
	CONSTRAINT "marketplace_listings_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "marketplace_listings_public_slug_unique" UNIQUE("public_slug"),
	CONSTRAINT "marketplace_listings_public_slug_format" CHECK ("marketplace_listings"."public_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("marketplace_listings"."public_slug") <= 63 and "marketplace_listings"."public_slug" not in ('www', 'app', 'api', 'admin', 'auth', 'login', 'signup', 'mail', 'email', 'static', 'assets', 'cdn', 'status', 'help', 'support', 'billing', 'docs', 'blog', 'climvia', 'sites', 'listings')),
	CONSTRAINT "marketplace_listings_status" CHECK ("marketplace_listings"."status" in ('draft', 'published', 'hidden')),
	CONSTRAINT "marketplace_listings_description" CHECK (char_length(btrim("marketplace_listings"."description")) between 1 and 300),
	CONSTRAINT "marketplace_listings_cover" CHECK ("marketplace_listings"."cover" is null or "marketplace_listings"."cover" in ('teal-horizon', 'warm-linen', 'cool-slate')),
	CONSTRAINT "marketplace_listings_published_at" CHECK (("marketplace_listings"."status" = 'draft') = ("marketplace_listings"."published_at" is null))
);
--> statement-breakpoint
ALTER TABLE "marketplace_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "sites_primary_domain_unique";--> statement-breakpoint
-- The old column was a plain text placeholder that nothing ever wrote; it becomes a real reference to site_templates.
ALTER TABLE "sites" ALTER COLUMN "selected_template_id" SET DATA TYPE uuid USING NULL::uuid;--> statement-breakpoint
-- A site's public identity is new: existing sites (a database made before this phase) get one from their organization's address plus a short
-- piece of their own id, so it is unique and valid; the constraints below are added once every row has it.
ALTER TABLE "sites" ADD COLUMN "platform_slug" text;--> statement-breakpoint
UPDATE "sites" AS s
   SET "platform_slug" = regexp_replace(left(o."slug" || CASE WHEN s."slug" = 'main' THEN '' ELSE '-' || s."slug" END, 54), '-+$', '') || '-' || left(replace(s."id"::text, '-', ''), 8)
  FROM "organizations" AS o
 WHERE o."id" = s."organization_id";--> statement-breakpoint
ALTER TABLE "sites" ALTER COLUMN "platform_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Each existing organization's oldest site (the one called "main" when they were made together) is its primary one.
UPDATE "sites" AS s
   SET "is_primary" = true
 WHERE s."id" = (SELECT x."id" FROM "sites" AS x WHERE x."organization_id" = s."organization_id" ORDER BY x."created_at", (x."slug" <> 'main'), x."id" LIMIT 1);--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "published_version_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "custom_domain_status" text;--> statement-breakpoint
-- The keys the new foreign keys below point at must exist before them.
ALTER TABLE "sites" ADD CONSTRAINT "sites_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_platform_slug_unique" UNIQUE("platform_slug");--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "submission_key" text;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_version_fk" FOREIGN KEY ("organization_id","site_id","site_version_id") REFERENCES "public"."site_versions"("organization_id","site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_sections" ADD CONSTRAINT "site_sections_page_fk" FOREIGN KEY ("organization_id","site_id","site_version_id","page_id") REFERENCES "public"."site_pages"("organization_id","site_id","site_version_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_template_id_site_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."site_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_published_by_user_id_auth_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_site_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listing_services" ADD CONSTRAINT "marketplace_listing_services_listing_fk" FOREIGN KEY ("organization_id","listing_id") REFERENCES "public"."marketplace_listings"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listing_services" ADD CONSTRAINT "marketplace_listing_services_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_pages_version_idx" ON "site_pages" USING btree ("site_version_id","sort_order");--> statement-breakpoint
CREATE INDEX "site_sections_page_idx" ON "site_sections" USING btree ("page_id","sort_order");--> statement-breakpoint
CREATE INDEX "site_sections_version_idx" ON "site_sections" USING btree ("site_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_versions_one_draft" ON "site_versions" USING btree ("site_id") WHERE "site_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "site_versions_site_idx" ON "site_versions" USING btree ("organization_id","site_id");--> statement-breakpoint
CREATE INDEX "marketplace_listing_services_listing_idx" ON "marketplace_listing_services" USING btree ("listing_id","sort_order");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_selected_template_id_site_templates_id_fk" FOREIGN KEY ("selected_template_id") REFERENCES "public"."site_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_published_version_fk" FOREIGN KEY ("organization_id","id","published_version_id") REFERENCES "public"."site_versions"("organization_id","site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_primary_unique" ON "sites" USING btree ("organization_id") WHERE "sites"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "sites_custom_domain_verified_unique" ON "sites" USING btree ("custom_domain") WHERE "sites"."custom_domain_status" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_org_submission_key_unique" ON "bookings" USING btree ("organization_id","submission_key") WHERE "bookings"."submission_key" is not null;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_platform_slug_format" CHECK ("sites"."platform_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("sites"."platform_slug") <= 63 and "sites"."platform_slug" not in ('www', 'app', 'api', 'admin', 'auth', 'login', 'signup', 'mail', 'email', 'static', 'assets', 'cdn', 'status', 'help', 'support', 'billing', 'docs', 'blog', 'climvia', 'sites', 'listings'));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_published_pointer" CHECK (("sites"."status" = 'published') = ("sites"."published_version_id" is not null));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_custom_domain_shape" CHECK ("sites"."custom_domain" is null or ("sites"."custom_domain" = lower("sites"."custom_domain") and char_length("sites"."custom_domain") between 4 and 253));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_custom_domain_status" CHECK (("sites"."custom_domain" is null) = ("sites"."custom_domain_status" is null) and ("sites"."custom_domain_status" is null or "sites"."custom_domain_status" in ('configured', 'pending_verification', 'verified')));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_primary_is_custom" CHECK ("sites"."primary_domain" is null or coalesce("sites"."primary_domain" = "sites"."custom_domain", false));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_submission_key" CHECK ("bookings"."submission_key" is null or char_length("bookings"."submission_key") between 8 and 64);