CREATE TABLE "platform_review_moderation" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_review_moderation_state" CHECK ("platform_review_moderation"."state" in ('visible', 'hidden')),
	CONSTRAINT "platform_review_moderation_reason" CHECK ("platform_review_moderation"."reason" is null or char_length(btrim("platform_review_moderation"."reason")) between 1 and 500),
	CONSTRAINT "platform_review_moderation_reason_only_when_hidden" CHECK ("platform_review_moderation"."state" = 'hidden' or "platform_review_moderation"."reason" is null),
	CONSTRAINT "platform_review_moderation_revision" CHECK ("platform_review_moderation"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "platform_review_moderation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_requests" DROP CONSTRAINT "review_requests_status";--> statement-breakpoint
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_action";--> statement-breakpoint
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_actor_kind";--> statement-breakpoint
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_actor";--> statement-breakpoint
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_target_kind";--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD COLUMN "tenant_message" text;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD COLUMN "review_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD COLUMN "review_requested_by" text;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD COLUMN "review_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD COLUMN "review_outcome" text;--> statement-breakpoint
ALTER TABLE "platform_review_moderation" ADD CONSTRAINT "platform_review_moderation_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_request_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."review_requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_token_hash_unique" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_org_request_unique" UNIQUE("organization_id","request_id");--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_token_shape" CHECK ("review_requests"."token_hash" is null or ("review_requests"."token_hash" ~ '^[0-9a-f]{64}$' and "review_requests"."expires_at" is not null));--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_completion" CHECK (("review_requests"."status" = 'completed') = ("review_requests"."completed_at" is not null));--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_status" CHECK ("review_requests"."status" in ('recorded', 'completed'));--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_action" CHECK ("platform_audit_events"."action" in ('platform_admin.granted', 'platform_admin.revoked', 'marketplace_listing.suspended', 'marketplace_listing.unsuspended', 'marketplace_listing.message_updated', 'marketplace_listing.review_requested', 'marketplace_listing.review_resolved', 'review.hidden', 'review.restored'));--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_kind" CHECK ("platform_audit_events"."actor_kind" in ('platform_admin', 'organization_member', 'cli'));--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor" CHECK (("platform_audit_events"."actor_kind" in ('platform_admin', 'organization_member')) = ("platform_audit_events"."actor_user_id" is not null));--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_target_kind" CHECK ("platform_audit_events"."target_kind" in ('user', 'marketplace_listing', 'review'));--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD CONSTRAINT "platform_listing_moderation_tenant_message" CHECK ("platform_listing_moderation"."tenant_message" is null or ("platform_listing_moderation"."state" = 'suspended' and char_length(btrim("platform_listing_moderation"."tenant_message")) between 1 and 500));--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD CONSTRAINT "platform_listing_moderation_review_state" CHECK ("platform_listing_moderation"."review_state" in ('none', 'requested', 'resolved'));--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD CONSTRAINT "platform_listing_moderation_review_note" CHECK ("platform_listing_moderation"."review_note" is null or char_length(btrim("platform_listing_moderation"."review_note")) between 1 and 500);--> statement-breakpoint
ALTER TABLE "platform_listing_moderation" ADD CONSTRAINT "platform_listing_moderation_review_shape" CHECK (("platform_listing_moderation"."review_state" = 'none' and "platform_listing_moderation"."review_requested_at" is null and "platform_listing_moderation"."review_requested_by" is null and "platform_listing_moderation"."review_note" is null and "platform_listing_moderation"."review_resolved_at" is null and "platform_listing_moderation"."review_outcome" is null)
        or ("platform_listing_moderation"."review_state" = 'requested' and "platform_listing_moderation"."review_requested_at" is not null and "platform_listing_moderation"."review_requested_by" is not null and "platform_listing_moderation"."review_resolved_at" is null and "platform_listing_moderation"."review_outcome" is null and "platform_listing_moderation"."state" = 'suspended')
        or ("platform_listing_moderation"."review_state" = 'resolved' and "platform_listing_moderation"."review_requested_at" is not null and "platform_listing_moderation"."review_requested_by" is not null and "platform_listing_moderation"."review_resolved_at" is not null and "platform_listing_moderation"."review_outcome" in ('kept', 'lifted')));