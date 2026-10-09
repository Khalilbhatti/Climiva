"use server";

import { PROTOTYPE_NOW } from "@/data/fixtures";
import type { ReviewsData } from "@/data/reviews";
import { loadRefs } from "@/db/ops-queries";
import { createRequestTx, editReplyTx, loadReviews, postReplyTx, type ReviewContext } from "@/db/review-queries";
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
 * review request only RECORDS that one was made; nothing is emailed or texted.
 */

type Answer = { reviews: ReviewsData };

function valid<T>(parsed: Parsed<T>): T {
  return parsed.ok ? parsed.value : refuse(parsed.error, parsed.fields);
}

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  if (constraint === "review_replies_review_unique") return failure("That review already has a response. Reload the page to see it.");
  if (constraint === "review_requests_job_active_unique") return failure("A review request for that job is already recorded.");
  if (constraint === "review_requests_job_completed") return failure("Only completed jobs are available for review requests.");
  if (uniqueViolationOf(error)) return failure("Someone changed this at the same moment. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("The change breaks a rule, so it was not saved. Reload the page and try again.");
  console.error("[reviews] could not save:", error instanceof Error ? error.message : error);
  return failure("The change could not be saved. Try again.");
}

/** Authorize, open the tenant transaction, run the change, and answer with the reviews as stored. */
async function mutate(change: (ctx: ReviewContext) => Promise<void>): Promise<ActionResult<Answer>> {
  const auth = await authorize("reviews:manage", NOT_ALLOWED_REVIEWS);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, organization, snapshot } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const refs = await loadRefs(tx, organizationId);
      await change({
        tx,
        organizationId,
        refs,
        stamp: stampInstant(snapshot.hasSampleData, organization.timezone, PROTOTYPE_NOW),
        actorUserId: userId,
        authorName: snapshot.settings.profile.name,
      });
      return ok({ reviews: await loadReviews(tx, organizationId, organization.timezone, refs) });
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

/** Record a request for a review. Nothing is sent. */
export async function createReviewRequestAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    await createRequestTx(ctx, valid(parseReviewRequest(input)));
  });
}
