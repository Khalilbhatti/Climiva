"use server";

import { headers } from "next/headers";
import { submitReview } from "@/db/public-queries";
import { failure, ok, type ActionResult } from "@/lib/action-result";
import { REVIEW_TOKEN_PATTERN } from "@/lib/review-link";
import { parseReviewSubmission } from "@/lib/review-rules";
import { isRecord } from "@/lib/validation";
import { clientAddress, withinLimit } from "../rate-limit";
import { getRequestSite } from "../request-host";

/**
 * A review written by a customer through the link a business gave them. There is no session and no workspace here, by design:
 *
 *   1. the request holds the link's secret and what the customer typed; it never names an organization, a customer or a Job. The database finds the
 *      request by the secret's hash and takes all three from it, so a forged form can only ever write the one review that link asked for,
 *   2. it is refused on a customer's own domain (the review page belongs to the platform; a customer's name serves that customer's site only),
 *   3. the visitor's address, and the link, are rate limited,
 *   4. the rating, the words and the consent are read here as the server must: public display happens only for an explicit "yes",
 *   5. the database function locks the request, checks it is open (not used, not expired) and writes the review and closes the request in one
 *      transaction, so two submissions of one link cannot both succeed.
 * The answer says only what happened to the link. The secret is never logged and never part of an error.
 */

export type ReviewOutcome = "submitted" | "completed" | "expired" | "invalid";
type Answer = { outcome: ReviewOutcome; public: boolean };

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT_PER_ADDRESS = 20;
const LIMIT_PER_LINK = 8;

const REVIEW_UNAVAILABLE = "This review page isn't available here.";
const REVIEW_BUSY = "Too many attempts. Wait a few minutes, then try again.";

export async function submitReviewAction(input: unknown): Promise<ActionResult<Answer>> {
  if (!isRecord(input)) return failure("Your review was not understood.");
  const token = typeof input.token === "string" ? input.token : "";
  // Anything that cannot be a link is not looked up.
  if (!REVIEW_TOKEN_PATTERN.test(token)) return ok({ outcome: "invalid", public: false });

  const parsed = parseReviewSubmission({ rating: input.rating, text: input.text, showPublicly: input.showPublicly });
  if (!parsed.ok) return failure(parsed.error, parsed.fields);

  const origin = await getRequestSite();
  if (origin.kind !== "platform") return failure(REVIEW_UNAVAILABLE);

  const address = clientAddress((await headers()).get("x-forwarded-for"));
  if (!withinLimit(`review:${address}`, LIMIT_PER_ADDRESS, WINDOW_MS) || !withinLimit(`review-link:${token.slice(0, 12)}`, LIMIT_PER_LINK, WINDOW_MS)) return failure(REVIEW_BUSY);

  try {
    const result = await submitReview(token, parsed.value.rating, parsed.value.text, parsed.value.showPublicly);
    return ok({ outcome: result.result, public: result.result === "submitted" ? result.public : false });
  } catch (error) {
    // A database error is never shown to a visitor, and the secret is not part of what is logged.
    console.error("[review] could not save:", error instanceof Error ? error.message : error);
    return failure("We couldn't send your review. Please try again.");
  }
}
