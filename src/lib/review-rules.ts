/**
 * What a browser may ask of Reviews, as the server reads it: a reply to a review and a request for a review. Pure functions: no
 * database, no framework. The server actions call these before they write, and the database holds the same rules again (checks,
 * guards and grants in the maintenance and reviews migrations), so a forged request cannot do what a screen would never offer.
 *
 * A reply is the business's one response to a review; the customer's words are never touched. A request is a RECORD that the
 * business asked for a review: nothing is sent.
 */
import type { Job, OperationsData } from "@/data/operations";
import { REQUEST_MESSAGE_MAX, RESPONSE_MAX, REVIEW_TEXT_MAX, type ReviewRequest, type ReviewRequestChannel } from "@/data/reviews";
import { numberOf, slugOf } from "./operations-rules";
import { isRecord, text, type Parsed } from "./validation";

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

/** "rev-sarah-mitchell": a review is named by its reference; anything else names nothing. */
export const reviewSlug = (value: unknown): string | undefined => slugOf(value);

/** The text of a reply: not empty, within the limit, trimmed. */
export function parseReplyBody(value: unknown): Parsed<string> {
  const body = typeof value === "string" ? value.trim() : undefined;
  if (body === undefined) return fail("The response was not understood.");
  if (body === "") return fail("Write a response before posting.", { body: "Write a response before posting." });
  if (body.length > RESPONSE_MAX) return fail(`Keep the response to ${RESPONSE_MAX} characters or fewer.`, { body: `Keep the response to ${RESPONSE_MAX} characters or fewer.` });
  return { ok: true, value: body };
}

/** "req-3": a review request is named by its place in the business's list; anything else names nothing. */
export function requestNumber(value: unknown): number | undefined {
  const match = typeof value === "string" ? /^req-([1-9]\d{0,5})$/.exec(value) : null;
  return match ? Number(match[1]) : undefined;
}

export type NewReviewRequest = { customerSlug: string; jobNumber?: number; channel: ReviewRequestChannel; message: string };

export function parseReviewRequest(input: unknown): Parsed<NewReviewRequest> {
  if (!isRecord(input)) return fail("The request details were not understood.");
  const customerSlug = slugOf(input.customerId);
  if (!customerSlug) return fail("Select the customer to ask.");
  const channel = input.channel === "email" || input.channel === "sms" ? input.channel : undefined;
  if (!channel) return fail("Choose how to reach the customer.");

  let jobNumber: number | undefined;
  if (input.relatedJobId !== undefined && input.relatedJobId !== "") {
    jobNumber = numberOf("JB", input.relatedJobId);
    if (jobNumber === undefined) return fail("The request details were not understood.");
  }

  const message = text(input.message, REQUEST_MESSAGE_MAX * 4)?.trim();
  if (message === undefined) return fail("The request details were not understood.");
  if (message === "") return fail("Write the message the customer will receive.", { message: "Write the message the customer will receive." });
  if (message.length > REQUEST_MESSAGE_MAX) return fail(`Keep the message to ${REQUEST_MESSAGE_MAX} characters or fewer.`, { message: `Keep the message to ${REQUEST_MESSAGE_MAX} characters or fewer.` });

  return { ok: true, value: { customerSlug, jobNumber, channel, message } };
}

export type ReviewSubmission = { rating: 1 | 2 | 3 | 4 | 5; text: string; /** The customer said yes to showing it publicly. Anything but an explicit yes is no. */ showPublicly: boolean };

/**
 * What the customer's review form sends, read as the server must: a whole-number rating from 1 to 5, words of 1 to 2000 characters, and a consent that is
 * true ONLY for the value "yes" (a missing, empty or any other value is no, so a forged or half-sent form can never make a review public).
 */
export function parseReviewSubmission(input: { rating: unknown; text: unknown; showPublicly: unknown }): Parsed<ReviewSubmission> {
  const rating = typeof input.rating === "string" && /^[1-5]$/.test(input.rating) ? (Number(input.rating) as ReviewSubmission["rating"]) : undefined;
  if (rating === undefined) return fail("Choose a rating from 1 to 5 stars.", { rating: "Choose a rating from 1 to 5 stars." });
  const text = typeof input.text === "string" ? input.text.trim() : undefined;
  if (text === undefined) return fail("Your review was not understood.");
  if (text === "") return fail("Write a few words about your experience.", { text: "Write a few words about your experience." });
  if (text.length > REVIEW_TEXT_MAX) return fail(`Keep your review to ${REVIEW_TEXT_MAX} characters or fewer.`, { text: `Keep your review to ${REVIEW_TEXT_MAX} characters or fewer.` });
  return { ok: true, value: { rating, text, showPublicly: input.showPublicly === "yes" } };
}

/**
 * The jobs a review can be requested for: the customer's own COMPLETED jobs that no active request already asks about, newest
 * first. A job of another customer, or of another business, is never in the list (the operations are the active business's).
 */
export function eligibleReviewJobs(customerId: string, ops: Pick<OperationsData, "jobs">, requests: readonly Pick<ReviewRequest, "relatedJobId">[]): Job[] {
  const requested = new Set(requests.flatMap((request) => (request.relatedJobId ? [request.relatedJobId] : [])));
  return ops.jobs
    .filter((job) => job.customerId === customerId && job.status === "completed" && !requested.has(job.id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
