CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"storage_driver" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "assets_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "assets_purpose" CHECK ("assets"."purpose" in ('logo')),
	CONSTRAINT "assets_status" CHECK ("assets"."status" in ('pending', 'ready', 'failed', 'deleted')),
	CONSTRAINT "assets_storage_driver" CHECK ("assets"."storage_driver" in ('local', 's3')),
	CONSTRAINT "assets_media_type" CHECK ("assets"."media_type" in ('image/webp', 'image/png', 'image/jpeg')),
	CONSTRAINT "assets_byte_size" CHECK ("assets"."byte_size" between 1 and 10485760),
	CONSTRAINT "assets_dimensions" CHECK (("assets"."width" is null or "assets"."width" > 0) and ("assets"."height" is null or "assets"."height" > 0)),
	CONSTRAINT "assets_checksum" CHECK ("assets"."checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assets_original_filename" CHECK ("assets"."original_filename" is null or char_length("assets"."original_filename") between 1 and 255),
	CONSTRAINT "assets_storage_key_own" CHECK ("assets"."storage_key" = 'organizations/' || "assets"."organization_id"::text || '/assets/' || "assets"."id"::text || '/normalized'),
	CONSTRAINT "assets_lifecycle" CHECK (("assets"."status" = 'pending' and "assets"."ready_at" is null and "assets"."deleted_at" is null)
        or ("assets"."status" = 'failed' and "assets"."ready_at" is null and "assets"."deleted_at" is null)
        or ("assets"."status" = 'ready' and "assets"."ready_at" is not null and "assets"."deleted_at" is null)
        or ("assets"."status" = 'deleted' and "assets"."deleted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_branding" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"logo_asset_id" uuid,
	"accent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_branding_accent" CHECK ("organization_branding"."accent" is null or "organization_branding"."accent" ~ '^#[0-9A-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "organization_branding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_brand_accent";--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_user_id_auth_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_logo_fk" FOREIGN KEY ("organization_id","logo_asset_id") REFERENCES "public"."assets"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_org_purpose_status_idx" ON "assets" USING btree ("organization_id","purpose","status");--> statement-breakpoint
-- A business's accent and logo are its Branding now (organization_branding, with the logo an Asset), not two columns on the organization.
-- Nothing wrote either column before, so on a database the application created this moves nothing; an accent that was stored by hand is kept.
INSERT INTO "organization_branding" ("organization_id", "accent") SELECT "id", "brand_accent" FROM "organizations" WHERE "brand_accent" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "logo_url";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "brand_accent";