"use server";

import { PROTOTYPE_NOW } from "@/lib/prototype-clock";
import type { IssuedReviewLink, ReviewsData } from "@/data/reviews";
import { loadRefs } from "@/db/ops-queries";
import { createRequestTx, editReplyTx, loadReviews, postReplyTx, reissueLinkTx, type ReviewContext } from "@/db/review-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_REVIEWS, failure, ok, type ActionResult } from "@/lib/action-result";
import { stampInstant } from "@/lib/business-time";
import { Refusal, refuse } from "@/lib/refusal";
import { parseReplyBody, parseReviewRequest, reviewSlug } from "@/lib/review-rules";
import type { Parsed } from "@/lib/validation";
import { authorize } from "../authorize";
import { constraintOf, isIntegrityViolation, uniqueViolationOf } from "../db-errors";

/**
 * Review writes: the business's one reply to a review (and editing it), and recording a request for a review. Each action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "reviews:manage" capability (owner or admin),
 *   3. only then reads its arguments, and parses and validates them again (the screen's checks are a convenience, these are the
 *      enforcement),
 *   4. opens a tenant transaction, so Row Level Security checks the same rules a second time, and resolves every reference it
 *      names (the review, the customer, the job) INSIDE the verified organization,
 *   5. writes, reads the business's reviews back and answers with them, so the screen shows exactly what is stored.
 * No argument names an organization. The customer's words are never changed: a reply is the business's own, one per review. A
 * review request RECORDS that one was made and makes a link for the business to give the customer; nothing is emailed or texted. The link's secret is in
 * the answer of the one call that made it (it is never stored, only its hash), and in no later answer.
 */

type Answer = { reviews: ReviewsData; link?: IssuedReviewLink };

function valid<T>(parsed: Parsed<T>): T {
  return parsed.ok ? parsed.value : refuse(parsed.error, parsed.fields);
}

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  if (constraint === "review_replies_review_unique") return failure("That review already has a response. Reload the page to see it.");
  if (constraint === "review_requests_job_active_unique") return failure("A review request for that job is already recorded.");
  if (constraint === "review_requests_job_completed") return failure("Only completed jobs are available for review requests.");
  if (uniqueViolationOf(error)) return failure("Someone else just changed this, so your change was not saved. Reload the page to see the latest, then try again.");
  if (isIntegrityViolation(error)) return failure("This change can't be saved as entered, and nothing was changed. Reload the page, check what you entered and try again.");
  console.error("[reviews] could not save:", error instanceof Error ? error.message : error);
  return failure("We couldn't save this review change. Nothing was changed. Try again.");
}

/** Authorize, open the tenant transaction, run the change, and answer with the reviews as stored (and the link the change made, if any). */
async function mutate(change: (ctx: ReviewContext) => Promise<IssuedReviewLink | void>): Promise<ActionResult<Answer>> {
  const auth = await authorize("reviews:manage", NOT_ALLOWED_REVIEWS);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, organization, snapshot } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const refs = await loadRefs(tx, organizationId);
      const link = await change({
        tx,
        organizationId,
        refs,
        stamp: stampInstant(snapshot.hasSampleData, organization.timezone, PROTOTYPE_NOW),
        actorUserId: userId,
        authorName: snapshot.settings.profile.name,
        timeZone: organization.timezone,
      });
      return ok({ reviews: await loadReviews(tx, organizationId, organization.timezone, refs), ...(link ? { link } : {}) });
    });
  } catch (error) {
    return translate(error);
  }
}

/* ───────────────────────── replies ───────────────────────── */

/** Post the business's response to a review. A review has one: a second post is refused (edit it instead). */
export async function postReplyAction(reviewReference: unknown, body: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    const slug = reviewSlug(reviewReference) ?? refuse("That review no longer exists. Reload the page and try again.");
    await postReplyTx(ctx, slug, valid(parseReplyBody(body)));
  });
}

/** Change the text of the review's response. */
export async function editReplyAction(reviewReference: unknown, body: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    const slug = reviewSlug(reviewReference) ?? refuse("That review no longer exists. Reload the page and try again.");
    await editReplyTx(ctx, slug, valid(parseReplyBody(body)));
  });
}

/* ───────────────────────── requests ───────────────────────── */

/** Record a request for a review and answer with its link, shown once. Nothing is sent. */
export async function createReviewRequestAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => createRequestTx(ctx, valid(parseReviewRequest(input))));
}

/** Make a new link for a request whose link was lost or ran out, and answer with it, shown once. The old link stops working. */
export async function reissueReviewLinkAction(requestReference: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => reissueLinkTx(ctx, requestReference));
}
