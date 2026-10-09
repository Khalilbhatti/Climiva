CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"phone" text,
	"email" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state_region" text,
	"postal_code" text,
	"country" text,
	"timezone" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"date_format" text DEFAULT 'mdy-short' NOT NULL,
	"time_format" text DEFAULT '12h' NOT NULL,
	"logo_url" text,
	"brand_accent" text,
	"fixture_set" text,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_slug_format" CHECK ("organizations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("organizations"."slug") <= 63),
	CONSTRAINT "organizations_name_length" CHECK (char_length(btrim("organizations"."name")) between 1 and 80),
	CONSTRAINT "organizations_timezone_present" CHECK (char_length(btrim("organizations"."timezone")) > 0),
	CONSTRAINT "organizations_currency_code" CHECK ("organizations"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "organizations_date_format" CHECK ("organizations"."date_format" in ('mdy-short', 'mdy-numeric', 'dmy-numeric', 'ymd-iso')),
	CONSTRAINT "organizations_time_format" CHECK ("organizations"."time_format" in ('12h', '24h')),
	CONSTRAINT "organizations_brand_accent" CHECK ("organizations"."brand_accent" is null or "organizations"."brand_accent" ~ '^#[0-9A-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"job_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_org_user_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "organization_memberships_role" CHECK ("organization_memberships"."role" in ('owner', 'admin', 'member')),
	CONSTRAINT "organization_memberships_status" CHECK ("organization_memberships"."status" in ('active', 'invited')),
	CONSTRAINT "organization_memberships_job_title" CHECK ("organization_memberships"."job_title" is null or char_length(btrim("organization_memberships"."job_title")) between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_full_name_length" CHECK (char_length(btrim("profiles"."full_name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"is_open" boolean DEFAULT false NOT NULL,
	"opens_at" time,
	"closes_at" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_business_hours_org_day_unique" UNIQUE("organization_id","day_of_week"),
	CONSTRAINT "organization_business_hours_day" CHECK ("organization_business_hours"."day_of_week" between 0 and 6),
	CONSTRAINT "organization_business_hours_times" CHECK (("organization_business_hours"."is_open" and "organization_business_hours"."opens_at" is not null and "organization_business_hours"."closes_at" is not null and "organization_business_hours"."closes_at" > "organization_business_hours"."opens_at") or (not "organization_business_hours"."is_open" and "organization_business_hours"."opens_at" is null and "organization_business_hours"."closes_at" is null))
);
--> statement-breakpoint
ALTER TABLE "organization_business_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"selected_template_id" text,
	"primary_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "sites_slug_format" CHECK ("sites"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("sites"."slug") <= 63),
	CONSTRAINT "sites_name_length" CHECK (char_length(btrim("sites"."name")) between 1 and 80),
	CONSTRAINT "sites_status" CHECK ("sites"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "sites_primary_domain_lowercase" CHECK ("sites"."primary_domain" is null or "sites"."primary_domain" = lower("sites"."primary_domain"))
);
--> statement-breakpoint
ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_business_hours" ADD CONSTRAINT "organization_business_hours_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_primary_domain_unique" ON "sites" USING btree ("primary_domain") WHERE "sites"."primary_domain" is not null;