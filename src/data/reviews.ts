/**
 * Reviews: what customers said, and what the business replied.
 *
 * A review points at a Customer (or carries a name snapshot for someone without a Customers record) and, where it
 * names one, at a Job by id. Whether it is awaiting a reply is derived from whether it has a response. There is one
 * response per review: replying creates it, editing changes the same record.
 *
 * The workspace totals (12 reviews, 4.7 average, 3 awaiting a reply, 5 review requests) are approved product
 * aggregates, held in REVIEW_BASELINE. The reviews below are a representative sample, not twelve invented records.
 * The only review source is Climvia. Nothing is published to, or read from, any outside review site, and there is
 * no verification, scoring, incentive or gating.
 *
 * Sources: design-reference/stitch/ reviews_main_list, review_detail_*, reply_to_review, request_review,
 * reviews_empty_state. Conflicts are listed in docs/stitch-screen-map.md §11.
 *
 * Fixtures are read-only. Demo changes (replying, requesting) live in components/reviews/ReviewsProvider.
 */
import { currentUser } from "./fixtures";

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

export const SARAH_REPLY =
  "Thank you, Sarah. We appreciate your feedback and are glad the repair process was clear and completed as scheduled.";

export const DEFAULT_REQUEST_MESSAGE =
  "Thanks for choosing Apex Climate Heating & Air. We’d appreciate your feedback about your recent service.";

export const RESPONSE_MAX = 500;
export const REQUEST_MESSAGE_MAX = 500;

export const REVIEWS: readonly Review[] = [
  {
    id: "rev-sarah-mitchell",
    source: "Climvia",
    customerId: "sarah-mitchell",
    relatedJobId: "JB-204",
    rating: 5,
    text: "The technician explained the repair clearly and completed the work as scheduled.",
    date: "2024-10-25",
    replyDraft: SARAH_REPLY,
  },
  {
    id: "rev-david-chen",
    source: "Climvia",
    customerId: "david-chen",
    rating: 4,
    text: "Scheduling was easy and the service visit went smoothly.",
    date: "2024-10-24",
    response: { body: "Thanks David, appreciate the feedback!", by: currentUser.name, at: "2024-10-24T16:20" },
  },
  {
    id: "rev-elena-rodriguez",
    source: "Climvia",
    customerId: "elena-rodriguez",
    rating: 5,
    text: "Helpful communication and a straightforward maintenance visit.",
    date: "2024-10-23",
  },
  {
    id: "rev-marcus-sterling",
    source: "Climvia",
    contactName: "Marcus Sterling",
    rating: 5,
    text: "Prompt arrival and thorough inspection of our heat pump before winter.",
    date: "2024-10-19",
    response: {
      body: "Thank you, Marcus. We’re glad the inspection was thorough.",
      by: currentUser.name,
      at: "2024-10-20T09:30",
    },
  },
];

export const REVIEW_BASELINE = { total: 12, average: 4.7, awaiting: 3, requests: 5 } as const;

const CANONICAL_AWAITING = new Set(REVIEWS.filter((review) => !review.response).map((review) => review.id));

export const REVIEWS_DATA: ReviewsData = { reviews: REVIEWS, requests: [] };

/* ───────────────────────── selectors ───────────────────────── */

export const getReviewById = (id: string, data: ReviewsData = REVIEWS_DATA) => data.reviews.find((review) => review.id === id);
export const getReviewStatus = (review: Pick<Review, "response">): ReviewStatus => (review.response ? "responded" : "awaiting");

export type ReviewMetrics = { total: number; average: number; awaiting: number; responded: number; requests: number };

/**
 * The totals on the Reviews screens: the approved figures, moved by what happened in the session. Replying to a review
 * that was awaiting moves one from Awaiting reply to Responded; a review request adds to the request count. Nobody
 * writes new reviews in the demo, so the total and the average do not change.
 */
export function getReviewMetrics(data: ReviewsData): ReviewMetrics {
  const replied = data.reviews.filter((review) => CANONICAL_AWAITING.has(review.id) && review.response).length;
  const awaiting = REVIEW_BASELINE.awaiting - replied;
  return {
    total: REVIEW_BASELINE.total,
    average: REVIEW_BASELINE.average,
    awaiting,
    responded: REVIEW_BASELINE.total - awaiting,
    requests: REVIEW_BASELINE.requests + data.requests.length,
  };
}

/** "5 out of 5 stars", for people who do not see the stars. */
export const describeRating = (rating: number) => `${rating} out of 5 stars`;
