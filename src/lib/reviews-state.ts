/**
 * Pure state transitions for the Reviews demo. A reply creates the review's one response; editing changes that same
 * response. A review request is recorded and nothing is sent. No function here mutates its input.
 */
import { currentUser, PROTOTYPE_NOW } from "@/data/fixtures";
import type { ReviewRequestChannel, ReviewsData } from "@/data/reviews";

const mapReview = (data: ReviewsData, id: string, change: (review: ReviewsData["reviews"][number]) => ReviewsData["reviews"][number]): ReviewsData => ({
  ...data,
  reviews: data.reviews.map((review) => (review.id === id ? change(review) : review)),
});

/**
 * Posts the business response, signed by `by` (the signed-in user's saved profile name; the baseline user by default).
 * A review that already has one is left alone (use editResponse).
 */
export function postResponse(data: ReviewsData, reviewId: string, body: string, by: string = currentUser.name): ReviewsData {
  return mapReview(data, reviewId, (review) =>
    review.response || !body.trim() ? review : { ...review, response: { body: body.trim(), by, at: PROTOTYPE_NOW } },
  );
}

/** Changes the text of the review's existing response; who replied and when stay as they were. */
export function editResponse(data: ReviewsData, reviewId: string, body: string): ReviewsData {
  return mapReview(data, reviewId, (review) =>
    review.response && body.trim() ? { ...review, response: { ...review.response, body: body.trim(), edited: true } } : review,
  );
}

export type NewReviewRequest = { customerId: string; relatedJobId?: string; channel: ReviewRequestChannel; message: string };

export function addReviewRequest(data: ReviewsData, input: NewReviewRequest): { data: ReviewsData; id: string } {
  const id = `req-${data.requests.length + 1}`;
  return {
    data: { ...data, requests: [...data.requests, { ...input, id, message: input.message.trim(), at: PROTOTYPE_NOW }] },
    id,
  };
}
