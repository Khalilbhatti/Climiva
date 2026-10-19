CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'super_admin' NOT NULL,
	"granted_via" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "platform_admins_role" CHECK ("platform_admins"."role" in ('super_admin')),
	CONSTRAINT "platform_admins_granted_via" CHECK ("platform_admins"."granted_via" in ('cli')),
	CONSTRAINT "platform_admins_provenance" CHECK (char_length(btrim("platform_admins"."granted_by")) between 1 and 120),
	CONSTRAINT "platform_admins_revocation" CHECK (("platform_admins"."revoked_at" is null) = ("platform_admins"."revoked_by" is null))
);
--> statement-breakpoint
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" text,
	"actor_label" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "platform_audit_events_action" CHECK ("platform_audit_events"."action" in ('platform_admin.granted', 'platform_admin.revoked', 'marketplace_listing.suspended', 'marketplace_listing.unsuspended')),
	CONSTRAINT "platform_audit_events_actor_kind" CHECK ("platform_audit_events"."actor_kind" in ('platform_admin', 'cli')),
	CONSTRAINT "platform_audit_events_actor" CHECK (("platform_audit_events"."actor_kind" = 'platform_admin') = ("platform_audit_events"."actor_user_id" is not null)),
	CONSTRAINT "platform_audit_events_target_kind" CHECK ("platform_audit_events"."target_kind" in ('user', 'marketplace_listing')),
	CONSTRAINT "platform_audit_events_labels" CHECK (char_length(btrim("platform_audit_events"."actor_label")) between 1 and 200 and char_length("platform_audit_events"."target_id") between 1 and 128),
	CONSTRAINT "platform_audit_events_reason" CHECK ("platform_audit_events"."reason" is null or char_length("platform_audit_events"."reason") <= 500),
	CONSTRAINT "platform_audit_events_metadata" CHECK (jsonb_typeof("platform_audit_events"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "platform_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_listing_moderation" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_listing_moderation_state" CHECK ("platform_listing_moderation"."state" in ('allowed', 'suspended')),
	CONSTRAINT "platform_listing_moderation_reason" CHECK ("platform_listing_moderation"."reason" is null or char_length(btrim("platform_listing_moderation"."reason")) between 1 and 500),
	CONSTRAINT "platform_listing_moderation_reason_only_when_suspended" CHECK ("platform_listing_moderation"."state" = 'suspended' or "platform_listing_moderation"."reason" is null),
	CONSTRAINT "platform_listing_moderation_revision" CHECK ("platform_listing_moderation"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD CONSTRAINT "platform_listing_moderation_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_one_active_per_user" ON "platform_admins" USING btree ("user_id") WHERE "platform_admins"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "platform_admins_user_idx" ON "platform_admins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_audit_events_occurred_idx" ON "platform_audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "platform_audit_events_target_idx" ON "platform_audit_events" USING btree ("target_kind","target_id");