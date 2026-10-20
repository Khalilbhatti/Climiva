/**
 * Reviews: what customers said about the business's work, what the business replied, and the requests it recorded asking for
 * more. All of it belongs to one organization.
 *
 * Nothing here talks to an outside review site: the only source is Climvia, no review is published to or read from anywhere
 * else, and a review REQUEST is only a record that one was made (nothing is emailed or texted; delivery does not exist yet).
 *
 * Every table carries its own `organization_id` and reaches its parents through composite (organization_id, id) foreign keys, so
 * an Apex review cannot name a Northstar customer or job, an Apex reply cannot belong to a Northstar review, and a request cannot
 * name another business's job, whoever writes the row. Row Level Security (0009) lets members of the ACTIVE organization read and
 * owners and admins reply and record requests; nothing is ever deleted, and the customer's words are never rewritten.
 *
 * A review's date is the business's calendar date. The system's own events (a reply posted, a request recorded) are instants,
 * shown in the organization's time zone.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { jobs } from "./operations";
import { organizations } from "./organizations";
import { teamMembers } from "./team";

export const REVIEW_SOURCE_VALUES = ["Climvia"] as const;
/** private: only the business sees it. public: it may be shown on the business's Marketplace profile and counts toward its public rating. */
export const REVIEW_VISIBILITY_VALUES = ["private", "public"] as const;
export const REVIEW_CHANNEL_VALUES = ["email", "sms"] as const;
export const REVIEW_REQUEST_STATUS_VALUES = ["recorded", "completed"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/* ───────────────────────── requests ───────────────────────── */

/**
 * A record that the business asked a customer for a review. NOTHING IS SENT: there is no email or SMS delivery yet, so a request
 * is only recorded (`status` is `recorded`; further states arrive with delivery). It may be about one of the customer's Jobs; a
 * Job has at most one active request, so a double click or a second person cannot ask twice for the same work.
 */
export const reviewRequests = pgTable(
  "review_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    jobId: uuid("job_id"),
    channel: text("channel").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    /**
     * The link the customer is given, as a SHA-256 of its secret (64 hex characters). The secret itself is never stored, logged or shown again: the
     * business is shown the link once, when it is made, and asks for a new one (which replaces this) if it is lost. A request recorded before links
     * existed has none. The link stops working at `expires_at` and once the review it asked for is `completed`.
     */
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** When the customer submitted the review this request asked for. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** The Team member who recorded it, when the person has a Team record. */
    createdBy: uuid("created_by"),
    position: integer("position").generatedAlwaysAsIdentity(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "review_requests_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({ name: "review_requests_job_fk", columns: [table.organizationId, table.jobId], foreignColumns: [jobs.organizationId, jobs.id] }),
    foreignKey({ name: "review_requests_job_customer_fk", columns: [table.organizationId, table.jobId, table.customerId], foreignColumns: [jobs.organizationId, jobs.id, jobs.customerId] }),
    foreignKey({ name: "review_requests_by_fk", columns: [table.organizationId, table.createdBy], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    unique("review_requests_org_id_unique").on(table.organizationId, table.id),
    // One active request per job (requests with no job are not constrained).
    uniqueIndex("review_requests_job_active_unique").on(table.organizationId, table.jobId).where(sql`${table.jobId} is not null and ${table.status} = 'recorded'`),
    index("review_requests_org_customer_idx").on(table.organizationId, table.customerId),
    index("review_requests_org_job_idx").on(table.organizationId, table.jobId, table.status),
    check("review_requests_channel", sql`${table.channel} in (${list(REVIEW_CHANNEL_VALUES)})`),
    check("review_requests_message", sql`char_length(btrim(${table.message})) between 1 and 500`),
    check("review_requests_status", sql`${table.status} in (${list(REVIEW_REQUEST_STATUS_VALUES)})`),
    unique("review_requests_token_hash_unique").on(table.tokenHash),
    check("review_requests_token_shape", sql`${table.tokenHash} is null or (${table.tokenHash} ~ '^[0-9a-f]{64}$' and ${table.expiresAt} is not null)`),
    // A request is completed exactly when it has a completion time.
    check("review_requests_completion", sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`),
  ],
).enableRLS();

export type ReviewRequestRow = typeof reviewRequests.$inferSelect;

/* ───────────────────────── reviews ───────────────────────── */

/**
 * A customer's review. Exactly one of `customer_id` / `contact_name` says who wrote it. It may name the Job it is about (which
 * must be that customer's own). The runtime role cannot create or change a review: customers write them (the public way to do
 * that comes with the Website), and the business only replies.
 *
 * `imported` marks a review carried in from before this system kept its own records (the sample business's history): it is
 * already inside the workspace totals the screens report. `reply_draft` is text the Reply dialog opens with for a review whose
 * approved answer was written ahead of time; it is only ever written by the seed.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The reference the screens and addresses use ("rev-sarah-mitchell"), unique within the organization. */
    slug: text("slug").notNull(),
    customerId: uuid("customer_id"),
    contactName: text("contact_name"),
    jobId: uuid("job_id"),
    source: text("source").notNull(),
    rating: smallint("rating").notNull(),
    reviewText: text("review_text").notNull(),
    /** The day the review was left: the business's calendar date. */
    submittedOn: date("submitted_on", { mode: "string" }).notNull(),
    replyDraft: text("reply_draft"),
    imported: boolean("imported").notNull().default(false),
    /**
     * Whether the review may be shown publicly (the Marketplace profile and its rating). Every review is private until it is made public, and no
     * workspace screen or Server Action does that: the runtime role cannot write this table, so only the owner connection (the seed today, the
     * customer's own consent step when review collection exists) can. The business cannot choose which reviews to show, so a rating cannot be curated.
     * `made_public_at` is set by the database when a review becomes public.
     */
    visibility: text("visibility").notNull().default("private"),
    madePublicAt: timestamp("made_public_at", { withTimezone: true }),
    /** The review request this review answers (a customer submitting through the link a business gave them), or null (a review that came another way). */
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "reviews_customer_fk", columns: [table.organizationId, table.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({ name: "reviews_job_fk", columns: [table.organizationId, table.jobId], foreignColumns: [jobs.organizationId, jobs.id] }),
    // When both are named the job is the customer's own (a NULL customer is not constrained: that review is by a name).
    foreignKey({ name: "reviews_job_customer_fk", columns: [table.organizationId, table.jobId, table.customerId], foreignColumns: [jobs.organizationId, jobs.id, jobs.customerId] }),
    foreignKey({ name: "reviews_request_fk", columns: [table.organizationId, table.requestId], foreignColumns: [reviewRequests.organizationId, reviewRequests.id] }),
    // A request is answered by at most one review.
    unique("reviews_org_request_unique").on(table.organizationId, table.requestId),
    unique("reviews_org_id_unique").on(table.organizationId, table.id),
    unique("reviews_org_slug_unique").on(table.organizationId, table.slug),
    index("reviews_org_submitted_idx").on(table.organizationId, table.submittedOn),
    index("reviews_org_rating_idx").on(table.organizationId, table.rating),
    index("reviews_org_customer_idx").on(table.organizationId, table.customerId),
    index("reviews_org_job_idx").on(table.organizationId, table.jobId),
    check("reviews_slug", sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{0,119}$'`),
    check("reviews_source", sql`${table.source} in (${list(REVIEW_SOURCE_VALUES)})`),
    check("reviews_rating", sql`${table.rating} between 1 and 5`),
    check("reviews_text", sql`char_length(btrim(${table.reviewText})) between 1 and 2000`),
    check("reviews_party", sql`(${table.customerId} is null) = (${table.contactName} is not null)`),
    check("reviews_visibility", sql`${table.visibility} in (${list(REVIEW_VISIBILITY_VALUES)})`),
    check("reviews_made_public_at", sql`(${table.visibility} = 'public') = (${table.madePublicAt} is not null)`),
    index("reviews_org_visibility_idx").on(table.organizationId, table.visibility),
  ],
).enableRLS();

export type ReviewRow = typeof reviews.$inferSelect;

/* ───────────────────────── replies ───────────────────────── */

/**
 * The business's response to a review: ONE per review (editing changes the same row), not a conversation. `author_name` is who
 * the response is signed by at the time (a rename later does not rewrite history); `replied_by` is their Team record when they
 * have one. `edited_at` is set by the database when the text changes.
 */
export const reviewReplies = pgTable(
  "review_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id").notNull(),
    body: text("body").notNull(),
    authorName: text("author_name").notNull(),
    repliedBy: uuid("replied_by"),
    repliedAt: timestamp("replied_at", { withTimezone: true }).notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** Part of the history carried in with the sample business (already inside the reported totals). */
    imported: boolean("imported").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "review_replies_review_fk", columns: [table.organizationId, table.reviewId], foreignColumns: [reviews.organizationId, reviews.id] }),
    foreignKey({ name: "review_replies_by_fk", columns: [table.organizationId, table.repliedBy], foreignColumns: [teamMembers.organizationId, teamMembers.id] }),
    unique("review_replies_org_id_unique").on(table.organizationId, table.id),
    // One response per review.
    unique("review_replies_review_unique").on(table.organizationId, table.reviewId),
    check("review_replies_body", sql`char_length(btrim(${table.body})) between 1 and 500`),
    check("review_replies_author", sql`char_length(btrim(${table.authorName})) between 1 and 120`),
  ],
).enableRLS();

export type ReviewReplyRow = typeof reviewReplies.$inferSelect;
