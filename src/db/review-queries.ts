/**
 * Reviews: the queries and the rows <-> screens mapping.
 *
 * Like the other query modules, every function takes an open transaction (`tx`) and the organization it works for, and names
 * that organization in every statement's WHERE clause. They are meant to be called from `withTenant(...)`, where Row Level
 * Security enforces the same boundary again. The seed calls the same functions on the owner connection.
 *
 * A review is the customer's: the application never writes one, and never changes its words, its rating or who or what it is
 * about. The business replies once (editing changes that same reply) and may record a request for a review. A request is only a
 * RECORD: nothing is emailed or texted. It carries a LINK, though: a random secret made here, shown to the business once, and stored only as its
 * SHA-256, which the customer opens to write the review (the public side is src/db/public-queries, migration 0027). The UI types predate the database and stay as they are; a review's `id` in the UI is its
 * reference ("rev-sarah-mitchell"), and the Job it names is its number ("JB-204"). The database uuids never leave the server.
 *
 * No `server-only` import on purpose: scripts and tests use these too. Nothing under src/ that is a Client Component may import
 * this file (a test enforces it).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { IssuedReviewLink, Review, ReviewLinkState, ReviewRequest, ReviewRequestChannel, ReviewsData } from "@/data/reviews";
import { instantToLocal, localToInstant, serverTimerMs } from "@/lib/business-time";
import { jobReference, numberOf } from "@/lib/operations-rules";
import { refuse } from "@/lib/refusal";
import { hashReviewToken, newReviewToken, reviewLinkExpiry, reviewLinkUrl } from "@/lib/review-link";
import { requestNumber, type NewReviewRequest } from "@/lib/review-rules";
import type { Tx } from "./index";
import { loadRefs, type IdOptions, type Refs } from "./ops-queries";
import { jobs, reviewReplies, reviewRequests, reviews, teamMembers } from "./schema";
import { stableId } from "./stable-id";

const idFor = (options: IdOptions, organizationId: string, kind: string, reference: string) =>
  options.stableIds ? { id: stableId(organizationId, kind, reference) } : {};

const orUndefined = <T,>(value: T | null | undefined): T | undefined => (value === null || value === undefined ? undefined : value);

const GONE_REVIEW = "That review no longer exists. Reload the page and try again.";
const GONE_REQUEST = "That review request no longer exists. Reload the page and try again.";

/* ───────────────────────── reading ───────────────────────── */

/** Every review (with its one reply) and every recorded request of one business, as the screens use them. */
export async function loadReviews(tx: Tx, organizationId: string, timeZone: string, refs?: Refs): Promise<ReviewsData> {
  const resolved = refs ?? (await loadRefs(tx, organizationId));
  const reviewRows = await tx.select().from(reviews).where(eq(reviews.organizationId, organizationId)).orderBy(asc(reviews.submittedOn), asc(reviews.slug));
  const replyRows = await tx.select().from(reviewReplies).where(eq(reviewReplies.organizationId, organizationId));
  // The link's secret is never read: only whether a link exists, when it stops and whether the customer used it.
  const requestRows = await tx
    .select({
      customerId: reviewRequests.customerId,
      jobId: reviewRequests.jobId,
      channel: reviewRequests.channel,
      message: reviewRequests.message,
      requestedAt: reviewRequests.requestedAt,
      status: reviewRequests.status,
      hasLink: sql<boolean>`${reviewRequests.tokenHash} is not null`,
      expiresAt: reviewRequests.expiresAt,
    })
    .from(reviewRequests)
    .where(eq(reviewRequests.organizationId, organizationId))
    .orderBy(asc(reviewRequests.position));
  // The reviews the platform has hidden from the Marketplace (ids only; the reason stays with the platform).
  const hiddenRows = await tx.execute<{ id: string }>(sql`select app_hidden_review_ids() as id`);
  const hidden = new Set(hiddenRows.rows.map((row) => row.id));
  const now = serverTimerMs();
  const linkOf = (row: (typeof requestRows)[number]): { state: ReviewLinkState; expires?: string } => {
    if (row.status === "completed") return { state: "used" };
    if (!row.hasLink || !row.expiresAt) return { state: "none" };
    return { state: row.expiresAt.getTime() > now ? "active" : "expired", expires: instantToLocal(row.expiresAt, timeZone) };
  };
  const jobRows = await tx.select({ id: jobs.id, number: jobs.number }).from(jobs).where(eq(jobs.organizationId, organizationId));
  const jobNumberById = new Map(jobRows.map((row) => [row.id, row.number]));
  const replyByReview = new Map(replyRows.map((row) => [row.reviewId, row]));

  return {
    // Newest first, like the list the screens show.
    reviews: [...reviewRows].reverse().map((row): Review => {
      const reply = replyByReview.get(row.id);
      return {
        id: row.slug,
        source: row.source as Review["source"],
        customerId: row.customerId ? resolved.slugs.customers.get(row.customerId) : undefined,
        contactName: orUndefined(row.contactName),
        relatedJobId: row.jobId && jobNumberById.has(row.jobId) ? jobReference(jobNumberById.get(row.jobId)!) : undefined,
        rating: row.rating as Review["rating"],
        text: row.reviewText,
        date: row.submittedOn,
        response: reply
          ? { body: reply.body, by: reply.authorName, at: instantToLocal(reply.repliedAt, timeZone), edited: reply.editedAt ? true : undefined, imported: reply.imported ? true : undefined }
          : undefined,
        replyDraft: orUndefined(row.replyDraft),
        imported: row.imported ? true : undefined,
        public: row.visibility === "public" ? true : undefined,
        platformHidden: row.visibility === "public" && hidden.has(row.id) ? true : undefined,
      };
    }),
    requests: requestRows.map(
      (row, index): ReviewRequest => ({
        id: `req-${index + 1}`,
        customerId: resolved.slugs.customers.get(row.customerId) ?? "",
        relatedJobId: row.jobId && jobNumberById.has(row.jobId) ? jobReference(jobNumberById.get(row.jobId)!) : undefined,
        channel: row.channel as ReviewRequestChannel,
        message: row.message,
        at: instantToLocal(row.requestedAt, timeZone),
        link: linkOf(row),
      }),
    ),
  };
}

/* ───────────────────────── replying ───────────────────────── */

export type ReviewContext = {
  tx: Tx;
  organizationId: string;
  refs: Refs;
  /** The instant a system event happening now is stamped with. */
  stamp: Date;
  /** The signed-in person: their Team record (if they have one) is who replied or asked. */
  actorUserId: string;
  /** What a reply is signed with: the signed-in person's profile name. */
  authorName: string;
  /** The business's time zone, for the local time a new review link stops working (UTC when absent). */
  timeZone?: string;
};

/** The Team member (if any) that the signed-in person is. */
async function actorMember(ctx: Pick<ReviewContext, "tx" | "organizationId" | "actorUserId">): Promise<string | null> {
  const rows = await ctx.tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, ctx.organizationId), eq(teamMembers.userId, ctx.actorUserId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function lockReview(ctx: ReviewContext, slug: string) {
  // The review row has no UPDATE privilege, so the reply (or its absence) is what serializes two people replying at once: the
  // unique key on the reply is the backstop, and the first one to commit wins.
  const [review] = await ctx.tx.select().from(reviews).where(and(eq(reviews.organizationId, ctx.organizationId), eq(reviews.slug, slug))).limit(1);
  return review;
}

/** Post the business's one response to a review. A review that already has one is refused (use the edit). */
export async function postReplyTx(ctx: ReviewContext, slug: string, body: string): Promise<void> {
  const review = await lockReview(ctx, slug);
  if (!review) return refuse(GONE_REVIEW);
  const existing = await ctx.tx.select({ id: reviewReplies.id }).from(reviewReplies).where(and(eq(reviewReplies.organizationId, ctx.organizationId), eq(reviewReplies.reviewId, review.id))).limit(1);
  if (existing.length > 0) refuse("That review already has a response. Edit it instead.");
  await ctx.tx.insert(reviewReplies).values({
    organizationId: ctx.organizationId,
    reviewId: review.id,
    body,
    authorName: ctx.authorName,
    repliedBy: await actorMember(ctx),
    repliedAt: ctx.stamp,
  });
}

/** Change the text of the review's existing response. Who replied and when stay as they were; the database marks it edited. */
export async function editReplyTx(ctx: ReviewContext, slug: string, body: string): Promise<void> {
  const review = await lockReview(ctx, slug);
  if (!review) return refuse(GONE_REVIEW);
  const changed = await ctx.tx
    .update(reviewReplies)
    .set({ body })
    .where(and(eq(reviewReplies.organizationId, ctx.organizationId), eq(reviewReplies.reviewId, review.id)))
    .returning({ id: reviewReplies.id });
  if (changed.length === 0) refuse("That review has no response to edit yet.");
}

/* ───────────────────────── requesting ───────────────────────── */

/** A link the customer can use, as the business is shown it (once). */
function issued(token: string, expires: Date, timeZone: string): IssuedReviewLink {
  return { url: reviewLinkUrl(token), expires: instantToLocal(expires, timeZone) };
}

/**
 * Record a request for a review and make its link. The customer is this business's own; a job it names is the customer's own COMPLETED job, with no
 * active request already (a double click or a second person cannot ask twice for the same work). Nothing is sent: the link is returned for the business
 * to give the customer, and only its hash is stored.
 */
export async function createRequestTx(ctx: ReviewContext, input: NewReviewRequest): Promise<IssuedReviewLink> {
  const { tx, organizationId, refs } = ctx;
  const customerId = refs.idBySlug.customers.get(input.customerSlug);
  if (!customerId) return refuse("That customer is not in your customers any more. Choose another or reload the page.");

  let jobId: string | null = null;
  if (input.jobNumber !== undefined) {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, organizationId), eq(jobs.number, input.jobNumber))).limit(1);
    if (!job) return refuse("That job no longer exists. Reload the page and try again.");
    if (job.customerId !== customerId) refuse("That job belongs to another customer.");
    if (job.status !== "completed") refuse("Only completed jobs are available for review requests.");
    const active = await tx.select({ id: reviewRequests.id }).from(reviewRequests).where(and(eq(reviewRequests.organizationId, organizationId), eq(reviewRequests.jobId, job.id), eq(reviewRequests.status, "recorded"))).limit(1);
    if (active.length > 0) refuse("A review request for that job is already recorded.");
    jobId = job.id;
  }

  const token = newReviewToken();
  const expires = reviewLinkExpiry();
  await tx.insert(reviewRequests).values({
    organizationId,
    customerId,
    jobId,
    channel: input.channel,
    message: input.message,
    status: "recorded",
    requestedAt: ctx.stamp,
    tokenHash: hashReviewToken(token),
    expiresAt: expires,
    createdBy: await actorMember(ctx),
  });
  return issued(token, expires, ctx.timeZone ?? "UTC");
}

/**
 * Replace the link of one request with a new one (the old secret stops working at once), for a link that was lost or ran out. The request is named by its
 * place in the business's list ("req-3"), resolved inside the verified organization; a request the customer already answered has nothing left to ask for.
 */
export async function reissueLinkTx(ctx: ReviewContext, reference: unknown): Promise<IssuedReviewLink> {
  const number = requestNumber(reference);
  if (number === undefined) return refuse(GONE_REQUEST);
  const rows = await ctx.tx
    .select({ id: reviewRequests.id })
    .from(reviewRequests)
    .where(eq(reviewRequests.organizationId, ctx.organizationId))
    .orderBy(asc(reviewRequests.position))
    .limit(1)
    .offset(number - 1);
  const target = rows[0];
  if (!target) return refuse(GONE_REQUEST);

  const token = newReviewToken();
  const expires = reviewLinkExpiry();
  const result = (await ctx.tx.execute<{ data: { found?: boolean; changed?: boolean; reason?: string } }>(
    sql`select app_reissue_review_link(${target.id}::uuid, ${hashReviewToken(token)}, ${expires.toISOString()}::timestamptz) as data`,
  )).rows[0]?.data;
  if (!result?.found) return refuse(GONE_REQUEST);
  if (!result.changed) return refuse("The customer has already answered this request, so it has no link to give.");
  return issued(token, expires, ctx.timeZone ?? "UTC");
}

/* ───────────────────────── seed and tests ───────────────────────── */

/** A review as the seed writes it: the screen's review, plus the number of the job it names (already on the review as "JB-204"). */
export type SeedReviews = ReviewsData;

/**
 * Write a whole set of reviews, replies and requests for one business (the sample business, the second seed business, a test
 * copy). A reply carried in with the history is marked `imported`. Instants are read from the local wall-clock strings in the
 * business's time zone. Runs on the owner connection after the operations are written (a review names a job).
 */
export async function insertReviews(tx: Tx, organizationId: string, timeZone: string, data: SeedReviews, refs: Refs, options: IdOptions = {}): Promise<void> {
  const jobRows = await tx.select({ id: jobs.id, number: jobs.number }).from(jobs).where(eq(jobs.organizationId, organizationId));
  const jobIdByNumber = new Map(jobRows.map((row) => [row.number, row.id]));
  const jobId = (reference: string | undefined) => {
    if (reference === undefined) return null;
    const number = numberOf("JB", reference);
    const id = number === undefined ? undefined : jobIdByNumber.get(number);
    if (!id) throw new Error(`Unknown job "${reference}".`);
    return id;
  };
  const customerId = (slug: string | undefined) => {
    if (slug === undefined) return null;
    const id = refs.idBySlug.customers.get(slug);
    if (!id) throw new Error(`Unknown customer "${slug}".`);
    return id;
  };

  for (const review of data.reviews) {
    const [row] = await tx
      .insert(reviews)
      .values({
        organizationId,
        ...idFor(options, organizationId, "review", review.id),
        slug: review.id,
        customerId: customerId(review.customerId),
        contactName: review.contactName ?? null,
        jobId: jobId(review.relatedJobId),
        source: review.source,
        rating: review.rating,
        reviewText: review.text,
        submittedOn: review.date,
        replyDraft: review.replyDraft ?? null,
        imported: review.imported ?? false,
        visibility: review.public ? "public" : "private",
      })
      .returning({ id: reviews.id });
    if (review.response) {
      await tx.insert(reviewReplies).values({
        organizationId,
        ...idFor(options, organizationId, "review-reply", review.id),
        reviewId: row.id,
        body: review.response.body,
        authorName: review.response.by,
        repliedAt: localToInstant(review.response.at, timeZone),
        editedAt: review.response.edited ? localToInstant(review.response.at, timeZone) : null,
        imported: review.response.imported ?? false,
      });
    }
  }

  for (const [index, request] of data.requests.entries()) {
    await tx.insert(reviewRequests).values({
      organizationId,
      ...idFor(options, organizationId, "review-request", `${request.id || `req-${index + 1}`}`),
      customerId: customerId(request.customerId)!,
      jobId: jobId(request.relatedJobId),
      channel: request.channel,
      message: request.message,
      status: "recorded",
      requestedAt: localToInstant(request.at, timeZone),
    });
  }
}

/**
 * Remove every review, reply and request of one organization (tests reset a worker's copy of the sample business with this). In the order the rows depend on
 * one another: a reply needs its review, and a review that answers a request needs that request, so the requests go last.
 */
export async function clearReviews(tx: Tx, organizationId: string): Promise<void> {
  await tx.delete(reviewReplies).where(eq(reviewReplies.organizationId, organizationId));
  await tx.delete(reviews).where(eq(reviews.organizationId, organizationId));
  await tx.delete(reviewRequests).where(eq(reviewRequests.organizationId, organizationId));
}
