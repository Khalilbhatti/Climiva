/**
 * Reviews: what customers said, and what the business replied.
 *
 * A review points at a Customer (or carries a name snapshot for someone without a Customers record) and, where it names one, at
 * a Job by id. Whether it is awaiting a reply is derived from whether it has a response. There is one response per review:
 * replying creates it, editing changes the same record. The records live in PostgreSQL, per organization, and reach the browser
 * for the ACTIVE organization only (src/db/review-queries, components/reviews/ReviewsProvider); the canonical Apex Climate
 * reviews are seed data (scripts/db/seed-data/reviews.ts) and ship to no browser.
 *
 * The sample business's workspace totals (12 reviews, 4.7 average, 3 awaiting a reply, 5 review requests) are approved product
 * aggregates, held in REVIEW_BASELINE: its stored reviews are a representative sample (marked `imported`), not twelve invented
 * records. Any other business's totals are counted from its own reviews. The only review source is Climvia. Nothing is published
 * to, or read from, any outside review site, and there is no verification, scoring, incentive or gating. A review request is a
 * record that one was made: nothing is sent.
 *
 * Sources: design-reference/stitch/ reviews_main_list, review_detail_*, reply_to_review, request_review, reviews_empty_state.
 * Conflicts are listed in docs/stitch-screen-map.md §11.
 */

export type ReviewSource = "Climvia";
export const REVIEW_SOURCES: readonly ReviewSource[] = ["Climvia"];

export type ReviewStatus = "awaiting" | "responded";
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = { awaiting: "Awaiting reply", responded: "Responded" };

export type ReviewResponse = {
  body: string;
  /** Who replied. */
  by: string;
  /** Business-local wall-clock time, "2024-10-25T10:45". */
  at: string;
  edited?: boolean;
  /** Carried in with the sample business's history (already inside its reported totals). */
  imported?: boolean;
};

export type Review = {
  /** URL slug: /reviews/[reviewId] */
  id: string;
  source: ReviewSource;
  /** Exactly one of customerId / contactName. */
  customerId?: string;
  contactName?: string;
  relatedJobId?: string;
  /** 1 to 5 */
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  /** "2024-10-25" */
  date: string;
  response?: ReviewResponse;
  /** Text the Reply dialog opens with, for a review whose approved reply is already written. */
  replyDraft?: string;
  /** Carried in with the sample business's history (already inside its reported totals). */
  imported?: boolean;
};

export type ReviewRequestChannel = "email" | "sms";

/** A review request is a record that one was made. Nothing is sent. */
export type ReviewRequest = {
  id: string;
  customerId: string;
  relatedJobId?: string;
  channel: ReviewRequestChannel;
  message: string;
  /** "2024-10-25T10:45" */
  at: string;
};

export type ReviewsData = { reviews: readonly Review[]; requests: readonly ReviewRequest[] };

/** The message a request opens with: the business's own name, never another's. */
export const defaultRequestMessage = (businessName: string) => `Thanks for choosing ${businessName}. We’d appreciate your feedback about your recent service.`;

export const RESPONSE_MAX = 500;
export const REQUEST_MESSAGE_MAX = 500;

/** The sample business's approved workspace totals. Its stored reviews are a representative sample of them. */
export const REVIEW_BASELINE = { total: 12, average: 4.7, awaiting: 3, requests: 5 } as const;

export type ReviewBaseline = { readonly total: number; readonly average: number; readonly awaiting: number; readonly requests: number };

/* ───────────────────────── selectors ───────────────────────── */

export const getReviewById = (id: string, data: ReviewsData) => data.reviews.find((review) => review.id === id);
export const getReviewStatus = (review: Pick<Review, "response">): ReviewStatus => (review.response ? "responded" : "awaiting");

export type ReviewMetrics = { total: number; average: number; awaiting: number; responded: number; requests: number };

/**
 * The totals on the Reviews screens. For the sample business: the approved figures, moved by what happened since. Replying to a
 * review that was awaiting moves one from Awaiting reply to Responded; a recorded request adds to the request count. Nobody
 * writes new reviews through the product, so the total and the average do not change. For any other business (no `baseline`)
 * they are counted from its own reviews.
 */
export function getReviewMetrics(data: ReviewsData, baseline?: ReviewBaseline): ReviewMetrics {
  if (!baseline) {
    const total = data.reviews.length;
    const awaiting = data.reviews.filter((review) => !review.response).length;
    const sum = data.reviews.reduce((points, review) => points + review.rating, 0);
    return { total, average: total === 0 ? 0 : Math.round((sum / total) * 10) / 10, awaiting, responded: total - awaiting, requests: data.requests.length };
  }
  // A carried-in review whose reply was posted since: it was awaiting in the approved figures.
  const replied = data.reviews.filter((review) => review.imported && review.response && !review.response.imported).length;
  const awaiting = baseline.awaiting - replied;
  return {
    total: baseline.total,
    average: baseline.average,
    awaiting,
    responded: baseline.total - awaiting,
    requests: baseline.requests + data.requests.length,
  };
}

/** "5 out of 5 stars", for people who do not see the stars. */
export const describeRating = (rating: number) => `${rating} out of 5 stars`;
