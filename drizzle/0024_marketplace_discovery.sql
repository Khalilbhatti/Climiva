-- Hand edit of the generated file: the foreign key bookings_marketplace_listing_fk is ON DELETE SET NULL (marketplace_listing_id) only. The column list
-- (PostgreSQL 15+) keeps the booking's own organization_id; a plain SET NULL would try to null it. drizzle-kit has no syntax for the list.
CREATE TABLE "marketplace_service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"city" text,
	"state_region" text,
	"postal_code" text,
	"label" text,
	"sort_order" integer NOT NULL,
	"city_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(regexp_replace(city, '[.'']', '', 'g'), '[-[:space:]]+', ' ', 'g')))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_service_areas_shape" CHECK (("marketplace_service_areas"."city" is not null and "marketplace_service_areas"."state_region" is not null and "marketplace_service_areas"."postal_code" is null) or ("marketplace_service_areas"."city" is null and "marketplace_service_areas"."state_region" is null and "marketplace_service_areas"."postal_code" is not null)),
	CONSTRAINT "marketplace_service_areas_city" CHECK ("marketplace_service_areas"."city" is null or ("marketplace_service_areas"."city" ~ '^[A-Za-z][A-Za-z .''-]{1,59}$' and "marketplace_service_areas"."city" = btrim("marketplace_service_areas"."city") and "marketplace_service_areas"."city" !~ '[[:space:]]{2}')),
	CONSTRAINT "marketplace_service_areas_state" CHECK ("marketplace_service_areas"."state_region" is null or "marketplace_service_areas"."state_region" ~ '^[A-Z]{2}$'),
	CONSTRAINT "marketplace_service_areas_postal" CHECK ("marketplace_service_areas"."postal_code" is null or "marketplace_service_areas"."postal_code" ~ '^[0-9]{5}$'),
	CONSTRAINT "marketplace_service_areas_label" CHECK ("marketplace_service_areas"."label" is null or ("marketplace_service_areas"."label" = btrim("marketplace_service_areas"."label") and char_length("marketplace_service_areas"."label") between 1 and 60)),
	CONSTRAINT "marketplace_service_areas_sort_order" CHECK ("marketplace_service_areas"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "marketplace_service_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "marketplace_listing_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discovery_service" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discovery_location" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "made_public_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace_service_areas" ADD CONSTRAINT "marketplace_service_areas_listing_fk" FOREIGN KEY ("organization_id","listing_id") REFERENCES "public"."marketplace_listings"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_service_areas_place_unique" ON "marketplace_service_areas" USING btree ("listing_id",coalesce("city_key", ''),coalesce("state_region", ''),coalesce("postal_code", ''));--> statement-breakpoint
CREATE INDEX "marketplace_service_areas_listing_idx" ON "marketplace_service_areas" USING btree ("listing_id","sort_order");--> statement-breakpoint
CREATE INDEX "marketplace_service_areas_city_idx" ON "marketplace_service_areas" USING btree ("state_region","city_key");--> statement-breakpoint
CREATE INDEX "marketplace_service_areas_postal_idx" ON "marketplace_service_areas" USING btree ("postal_code");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_marketplace_listing_fk" FOREIGN KEY ("organization_id","marketplace_listing_id") REFERENCES "public"."marketplace_listings"("organization_id","id") ON DELETE set null ("marketplace_listing_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_marketplace_listing_idx" ON "bookings" USING btree ("marketplace_listing_id") WHERE "bookings"."marketplace_listing_id" is not null;--> statement-breakpoint
CREATE INDEX "reviews_org_visibility_idx" ON "reviews" USING btree ("organization_id","visibility");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_marketplace_source" CHECK ("bookings"."marketplace_listing_id" is null or "bookings"."source" = 'Marketplace');--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_discovery_shape" CHECK (("bookings"."discovery_service" is null or ("bookings"."discovery_service" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("bookings"."discovery_service") <= 80)) and ("bookings"."discovery_location" is null or ("bookings"."discovery_location" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("bookings"."discovery_location") <= 80)));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_visibility" CHECK ("reviews"."visibility" in ('private', 'public'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_made_public_at" CHECK (("reviews"."visibility" = 'public') = ("reviews"."made_public_at" is not null));