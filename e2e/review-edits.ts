/**
 * Test-only data builders for the specs that check what the review SELECTORS answer for a given set of reviews.
 *
 * They do not model the application: a reply or a request is stored by the server, in PostgreSQL, and is tested there
 * (reviews-database.spec.ts, maintenance-reviews-flows.spec.ts). These only put a reply (or a request) into a plain ReviewsData value
 * so a pure spec can ask the selectors what the totals would be. None of them mutates its input.
 */
import type { ReviewRequest, ReviewsData } from "../src/data/reviews";

const NOW = "2024-10-25T10:45";

const mapReview = (data: ReviewsData, id: string, change: (review: ReviewsData["reviews"][number]) => ReviewsData["reviews"][number]): ReviewsData => ({
  ...data,
  reviews: data.reviews.map((review) => (review.id === id ? change(review) : review)),
});

/** The data with a reply posted by `by` on a review that has none (a review that has one is left alone). */
export const withReply = (data: ReviewsData, reviewId: string, body: string, by = "Alex Morgan", at = NOW): ReviewsData =>
  mapReview(data, reviewId, (review) => (review.response || !body.trim() ? review : { ...review, response: { body: body.trim(), by, at } }));

/** The data with the review's existing reply re-worded; who replied and when stay as they were. */
export const withEditedReply = (data: ReviewsData, reviewId: string, body: string): ReviewsData =>
  mapReview(data, reviewId, (review) => (review.response && body.trim() ? { ...review, response: { ...review.response, body: body.trim(), edited: true } } : review));

/** The data with one more recorded request. */
export function withRequest(data: ReviewsData, input: Omit<ReviewRequest, "id" | "at">, at = NOW): { data: ReviewsData; id: string } {
  const id = `req-${data.requests.length + 1}`;
  return { data: { ...data, requests: [...data.requests, { ...input, id, message: input.message.trim(), at }] }, id };
}
