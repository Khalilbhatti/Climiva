/**
 * The platform's own administration: who may operate Climvia itself, what they decided about a listing, and the record of it.
 *
 * NOTHING HERE BELONGS TO A BUSINESS. These tables have no `organization_id` and no tenant policy, and they are not reached through an
 * organization membership: a person is a business's owner, admin or member through `organization_memberships`, and a platform administrator
 * through `platform_admins`, and the two never imply each other (an owner of every business on the platform has no platform authority).
 *
 * The runtime role (`climvia_app`) has NO privilege on any of them. Row Level Security is enabled with no policy (so even a mistaken GRANT
 * reads nothing), and the application reaches them only through the narrow SECURITY DEFINER functions of migration 0023, every one of which
 * first asks `app_is_platform_admin()` about the CURRENT verified user and refuses otherwise. A platform administrator is granted and revoked
 * only with the command-line tool (scripts/platform-admin), which connects as the owner: there is no browser or API path that writes
 * `platform_admins`.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUser } from "./auth";
import { marketplaceListings } from "./marketplace";
import { reviews } from "./reviews";

export const PLATFORM_ROLES = ["super_admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const MODERATION_STATES = ["allowed", "suspended"] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

export const REVIEW_MODERATION_STATES = ["visible", "hidden"] as const;
export type ReviewModerationState = (typeof REVIEW_MODERATION_STATES)[number];

/** Where a business's request to have a suspension looked at stands: not asked, asked, or answered. */
export const SUSPENSION_REVIEW_STATES = ["none", "requested", "resolved"] as const;
export type SuspensionReviewState = (typeof SUSPENSION_REVIEW_STATES)[number];
/** How a review request was answered: the suspension stays, or is lifted. */
export const SUSPENSION_REVIEW_OUTCOMES = ["kept", "lifted"] as const;

export const PLATFORM_AUDIT_ACTIONS = [
  "platform_admin.granted",
  "platform_admin.revoked",
  "marketplace_listing.suspended",
  "marketplace_listing.unsuspended",
  "marketplace_listing.message_updated",
  "marketplace_listing.review_requested",
  "marketplace_listing.review_resolved",
  "review.hidden",
  "review.restored",
] as const;
export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * One row per assignment of platform authority. Revoking keeps the row (`revoked_at`) so the history stays; a person is a platform
 * administrator exactly while a row of theirs has no `revoked_at`, and at most one such row exists per person.
 */
export const platformAdmins = pgTable(
  "platform_admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Deleting the account ends the authority with it. The audit trail, which has no foreign key, keeps what happened. */
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("super_admin"),
    /** How the authority was given: only the command-line tool does. */
    grantedVia: text("granted_via").notNull(),
    /** Who ran it, as the tool saw it (`cli:<operating-system user>`): provenance, not authentication. */
    grantedBy: text("granted_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
  },
  (table) => [
    uniqueIndex("platform_admins_one_active_per_user").on(table.userId).where(sql`${table.revokedAt} is null`),
    index("platform_admins_user_idx").on(table.userId),
    check("platform_admins_role", sql`${table.role} in (${list(PLATFORM_ROLES)})`),
    check("platform_admins_granted_via", sql`${table.grantedVia} in ('cli')`),
    check("platform_admins_provenance", sql`char_length(btrim(${table.grantedBy})) between 1 and 120`),
    check("platform_admins_revocation", sql`(${table.revokedAt} is null) = (${table.revokedBy} is null)`),
  ],
).enableRLS();

export type PlatformAdminRow = typeof platformAdmins.$inferSelect;

/**
 * The platform's decision about a Marketplace listing, kept apart from the business's own `status`. A listing is publicly discoverable only
 * when the business has published it AND no row here says `suspended`. A listing with no row here is allowed. Suspending changes nothing the
 * business wrote: its description, its selected Services and its own publication choice are untouched, and unsuspending puts it back exactly
 * as it was. The reason is internal: no public function returns it and no tenant can read it.
 */
export const platformListingModeration = pgTable(
  "platform_listing_moderation",
  {
    listingId: uuid("listing_id")
      .primaryKey()
      .references(() => marketplaceListings.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    reason: text("reason"),
    /** The platform administrator who made the latest decision (no foreign key: the decision outlives the account). */
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    /** Counts decisions on this listing, so two administrators acting at once can be told apart in the trail. */
    revision: integer("revision").notNull().default(1),
    /**
     * What the platform says to the BUSINESS about the suspension, in words meant to be read by it (what was seen, what to change). It is a different
     * field from `reason`, which stays internal: nothing is copied from one to the other, and only this one is ever sent to the business's pages.
     */
    tenantMessage: text("tenant_message"),
    /** When the current suspension began. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    /** The business's request to have the suspension looked at: none, requested, resolved. */
    reviewState: text("review_state").notNull().default("none"),
    reviewRequestedAt: timestamp("review_requested_at", { withTimezone: true }),
    /** The business member who asked (a user id; no foreign key, like `decided_by`). */
    reviewRequestedBy: text("review_requested_by"),
    /** What the business wrote when it asked. Read by the platform only. */
    reviewNote: text("review_note"),
    reviewResolvedAt: timestamp("review_resolved_at", { withTimezone: true }),
    reviewOutcome: text("review_outcome"),
  },
  (table) => [
    check("platform_listing_moderation_state", sql`${table.state} in (${list(MODERATION_STATES)})`),
    check("platform_listing_moderation_tenant_message", sql`${table.tenantMessage} is null or (${table.state} = 'suspended' and char_length(btrim(${table.tenantMessage})) between 1 and 500)`),
    check("platform_listing_moderation_review_state", sql`${table.reviewState} in (${list(SUSPENSION_REVIEW_STATES)})`),
    check("platform_listing_moderation_review_note", sql`${table.reviewNote} is null or char_length(btrim(${table.reviewNote})) between 1 and 500`),
    check(
      "platform_listing_moderation_review_shape",
      sql`(${table.reviewState} = 'none' and ${table.reviewRequestedAt} is null and ${table.reviewRequestedBy} is null and ${table.reviewNote} is null and ${table.reviewResolvedAt} is null and ${table.reviewOutcome} is null)
        or (${table.reviewState} = 'requested' and ${table.reviewRequestedAt} is not null and ${table.reviewRequestedBy} is not null and ${table.reviewResolvedAt} is null and ${table.reviewOutcome} is null and ${table.state} = 'suspended')
        or (${table.reviewState} = 'resolved' and ${table.reviewRequestedAt} is not null and ${table.reviewRequestedBy} is not null and ${table.reviewResolvedAt} is not null and ${table.reviewOutcome} in (${list(SUSPENSION_REVIEW_OUTCOMES)}))`,
    ),
    check("platform_listing_moderation_reason", sql`${table.reason} is null or char_length(btrim(${table.reason})) between 1 and 500`),
    // Only a suspension carries a reason.
    check("platform_listing_moderation_reason_only_when_suspended", sql`${table.state} = 'suspended' or ${table.reason} is null`),
    check("platform_listing_moderation_revision", sql`${table.revision} >= 1`),
  ],
).enableRLS();

export type PlatformListingModerationRow = typeof platformListingModeration.$inferSelect;

/**
 * The platform's decision about one PUBLIC review: it may be hidden from every public Marketplace surface (the profile, the rating and the count) and
 * restored. A review with no row here is visible. Hiding changes nothing the business owns: the review, its words, its reply and its place in the
 * business's own Reviews are exactly as they were, and restoring puts it back. The reason is internal. There is no deletion: moderation is a decision
 * that can be reversed, and `app_review_is_public` (migration 0027) is the one place that reads it.
 */
export const platformReviewModeration = pgTable(
  "platform_review_moderation",
  {
    reviewId: uuid("review_id")
      .primaryKey()
      .references(() => reviews.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    reason: text("reason"),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    check("platform_review_moderation_state", sql`${table.state} in (${list(REVIEW_MODERATION_STATES)})`),
    check("platform_review_moderation_reason", sql`${table.reason} is null or char_length(btrim(${table.reason})) between 1 and 500`),
    check("platform_review_moderation_reason_only_when_hidden", sql`${table.state} = 'hidden' or ${table.reason} is null`),
    check("platform_review_moderation_revision", sql`${table.revision} >= 1`),
  ],
).enableRLS();

export type PlatformReviewModerationRow = typeof platformReviewModeration.$inferSelect;

/**
 * The record of dangerous platform actions. Append-only: a guard in migration 0023 refuses every UPDATE, DELETE and TRUNCATE, for every role. It holds who did
 * what to what, when, and the reason they gave; never a secret, a token or a password. It has no foreign keys on purpose, so it survives the
 * deletion of the account or the listing it describes.
 */
export const platformAuditEvents = pgTable(
  "platform_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    action: text("action").notNull(),
    /** `platform_admin` (acted through the console), `organization_member` (a business's owner or admin asked the platform for something) or `cli` (the command-line tool). */
    actorKind: text("actor_kind").notNull(),
    actorUserId: text("actor_user_id"),
    /** The actor as they were named then: an email address for an administrator, `cli:<operating-system user>` for the tool. */
    actorLabel: text("actor_label").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    index("platform_audit_events_occurred_idx").on(table.occurredAt),
    index("platform_audit_events_target_idx").on(table.targetKind, table.targetId),
    check("platform_audit_events_action", sql`${table.action} in (${list(PLATFORM_AUDIT_ACTIONS)})`),
    check("platform_audit_events_actor_kind", sql`${table.actorKind} in ('platform_admin', 'organization_member', 'cli')`),
    check("platform_audit_events_actor", sql`(${table.actorKind} in ('platform_admin', 'organization_member')) = (${table.actorUserId} is not null)`),
    check("platform_audit_events_target_kind", sql`${table.targetKind} in ('user', 'marketplace_listing', 'review')`),
    check("platform_audit_events_labels", sql`char_length(btrim(${table.actorLabel})) between 1 and 200 and char_length(${table.targetId}) between 1 and 128`),
    check("platform_audit_events_reason", sql`${table.reason} is null or char_length(${table.reason}) <= 500`),
    check("platform_audit_events_metadata", sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
).enableRLS();

export type PlatformAuditEventRow = typeof platformAuditEvents.$inferSelect;
