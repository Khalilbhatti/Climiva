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
 * aggregates: its stored reviews are a representative sample (marked `imported`), not twelve invented records, and the totals are
 * the stored reviews plus an imported adjustment (analytics_imported_baselines) that holds the review count, the sum of the
 * ratings, the awaiting count and the request count the stored records do not carry. The average is always sum / count, never a
 * stored average. Any other business's totals are counted from its own reviews alone. The only review source is Climvia. Nothing is published
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
  /** Carried in with the sample business's history (informational: its totals are reconciled by an imported adjustment). */
  imported?: boolean;
  /**
   * The customer made it public: it may be shown on the business's Marketplace profile and counts toward its public rating. Written by the seed (and,
   * later, by the customer's own consent step); no workspace screen sets it, and the business cannot choose which reviews are shown.
   */
  public?: boolean;
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

/**
 * What the imported reporting history adds to the totals a business's reviews give, signed: the number of reviews, the SUM of their
 * ratings (so the average stays exact when a review is added), those awaiting a reply, and the review requests. Read from
 * analytics_imported_baselines for the active business only; none for any other business.
 */
export type ReviewAdjustment = { readonly count: number; readonly ratingSum: number; readonly awaiting: number; readonly requests: number };

export const NO_REVIEW_ADJUSTMENT: ReviewAdjustment = { count: 0, ratingSum: 0, awaiting: 0, requests: 0 };

/* ───────────────────────── selectors ───────────────────────── */

export const getReviewById = (id: string, data: ReviewsData) => data.reviews.find((review) => review.id === id);
export const getReviewStatus = (review: Pick<Review, "response">): ReviewStatus => (review.response ? "responded" : "awaiting");

export type ReviewMetrics = { total: number; average: number; awaiting: number; responded: number; requests: number };

/** What the stored reviews and requests themselves contribute to the totals. */
export function getReviewContribution(data: ReviewsData): ReviewAdjustment {
  return {
    count: data.reviews.length,
    ratingSum: data.reviews.reduce((points, review) => points + review.rating, 0),
    awaiting: data.reviews.filter((review) => !review.response).length,
    requests: data.requests.length,
  };
}

/**
 * The totals on the Reviews screens: every stored review and request plus the imported `adjustment` (none for a business without
 * reporting history). Replying to a review moves one from Awaiting reply to Responded; a recorded request adds to the request
 * count; and the average is (sum of all ratings) / (number of all reviews), rounded to one decimal, so a review added to a
 * business moves it exactly as much as its rating weighs, and another business's reviews never enter into it.
 */
export function getReviewMetrics(data: ReviewsData, adjustment: ReviewAdjustment = NO_REVIEW_ADJUSTMENT): ReviewMetrics {
  const own = getReviewContribution(data);
  const total = adjustment.count + own.count;
  const points = adjustment.ratingSum + own.ratingSum;
  const awaiting = adjustment.awaiting + own.awaiting;
  return {
    total,
    average: total === 0 ? 0 : Math.round((points / total) * 10) / 10,
    awaiting,
    responded: total - awaiting,
    requests: adjustment.requests + own.requests,
  };
}

/** "5 out of 5 stars", for people who do not see the stars. */
export const describeRating = (rating: number) => `${rating} out of 5 stars`;
