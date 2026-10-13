CREATE TABLE "site_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"verification_token" text NOT NULL,
	"verification_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_domains_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "site_domains_status" CHECK ("site_domains"."status" in ('pending_verification', 'verified', 'active', 'disabled', 'removed')),
	CONSTRAINT "site_domains_hostname_shape" CHECK ("site_domains"."hostname" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' and char_length("site_domains"."hostname") <= 231),
	CONSTRAINT "site_domains_hostname_reserved" CHECK ("site_domains"."hostname" !~ '(^|\.)climvia\.com$' and "site_domains"."hostname" !~ '(^|\.)(localhost|local|localdomain|internal|invalid)$' and "site_domains"."hostname" !~ '\.home\.arpa$'),
	CONSTRAINT "site_domains_token_format" CHECK ("site_domains"."verification_token" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "site_domains_lifecycle" CHECK (("site_domains"."status" = 'pending_verification' and "site_domains"."verified_at" is null and "site_domains"."activated_at" is null and "site_domains"."disabled_at" is null and "site_domains"."removed_at" is null)
        or ("site_domains"."status" = 'verified' and "site_domains"."verified_at" is not null and "site_domains"."activated_at" is null and "site_domains"."disabled_at" is null and "site_domains"."removed_at" is null)
        or ("site_domains"."status" = 'active' and "site_domains"."verified_at" is not null and "site_domains"."activated_at" is not null and "site_domains"."disabled_at" is null and "site_domains"."removed_at" is null)
        or ("site_domains"."status" = 'disabled' and "site_domains"."verified_at" is not null and "site_domains"."activated_at" is not null and "site_domains"."disabled_at" is not null and "site_domains"."removed_at" is null)
        or ("site_domains"."status" = 'removed' and "site_domains"."removed_at" is not null)),
	CONSTRAINT "site_domains_primary_is_active" CHECK (not "site_domains"."is_primary" or "site_domains"."status" = 'active'),
	CONSTRAINT "site_domains_revision" CHECK ("site_domains"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "site_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_primary_domain_lowercase";--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_custom_domain_shape";--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_custom_domain_status";--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_primary_is_custom";--> statement-breakpoint
DROP INDEX "sites_custom_domain_verified_unique";--> statement-breakpoint
ALTER TABLE "site_domains" ADD CONSTRAINT "site_domains_created_by_user_id_auth_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_domains" ADD CONSTRAINT "site_domains_site_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_domains_hostname_unique" ON "site_domains" USING btree ("hostname") WHERE "site_domains"."status" <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "site_domains_token_unique" ON "site_domains" USING btree ("verification_token");--> statement-breakpoint
CREATE UNIQUE INDEX "site_domains_primary_unique" ON "site_domains" USING btree ("site_id") WHERE "site_domains"."is_primary";--> statement-breakpoint
CREATE INDEX "site_domains_site_idx" ON "site_domains" USING btree ("organization_id","site_id");--> statement-breakpoint
-- A domain that was only RECORDED on a site (nothing ever verified or routed one) becomes a claim that has not been verified, with a token of
-- its own: 244 random bits from the server's strong random source (two version-4 UUIDs), written as base64url. Where several businesses had
-- recorded the same name the earliest keeps it; nobody is told about the others. The old "configured", "verified" and "main" markers were
-- never backed by anything real, so they are not carried over.
INSERT INTO "site_domains" ("organization_id", "site_id", "hostname", "status", "verification_token")
SELECT DISTINCT ON (s."custom_domain") s."organization_id", s."id", s."custom_domain", 'pending_verification',
       translate(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_')
  FROM "sites" s
 WHERE s."custom_domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
   AND char_length(s."custom_domain") <= 231
   AND s."custom_domain" !~ '(^|\.)climvia\.com$'
   AND s."custom_domain" !~ '(^|\.)(localhost|local|localdomain|internal|invalid)$'
   AND s."custom_domain" !~ '\.home\.arpa$'
 ORDER BY s."custom_domain", s."created_at", s."id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "primary_domain";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "custom_domain";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "custom_domain_status";