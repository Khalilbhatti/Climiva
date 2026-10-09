"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ReviewRequestChannel, ReviewsData } from "@/data/reviews";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import { createReviewRequestAction, editReplyAction, postReplyAction } from "@/server/actions/reviews";

/** What every change resolves with: the reviews as stored, or why it was refused. */
type Done = Promise<ActionResult<{ reviews: ReviewsData }>>;

export type NewReviewRequest = { customerId: string; relatedJobId?: string; channel: ReviewRequestChannel; message: string };

type ReviewsContextValue = {
  /** The business's reviews (each with its one response) and the review requests it recorded, as stored. */
  data: ReviewsData;
  /** Posts the business's response to a review. A review has one; the second is refused (use editResponse). */
  postResponse: (reviewId: string, body: string) => Done;
  /** Changes the text of the review's response. */
  editResponse: (reviewId: string, body: string) => Done;
  /** Records that the business asked for a review. Nothing is sent. */
  addReviewRequest: (input: NewReviewRequest) => Done;
};

const ReviewsContext = createContext<ReviewsContextValue | null>(null);

/**
 * The business's Reviews for the whole workspace. `initial` is what the server read from PostgreSQL for this page load, for the
 * ACTIVE organization only. Every change goes to the server, which authorizes it (owner or admin), validates it, stores it in one
 * transaction and answers with the reviews as stored; only then does the working copy change, so the screen is never ahead of the
 * database. Nothing is sent to, or read from, any outside review site.
 */
export function ReviewsProvider({ initial, children }: { initial: ReviewsData; children: ReactNode }) {
  const [data, setData] = useState<ReviewsData>(initial);

  const adopt = useCallback((result: ActionResult<{ reviews: ReviewsData }>) => {
    if (result.ok) setData(result.data.reviews);
    return result;
  }, []);

  const value = useMemo<ReviewsContextValue>(
    () => ({
      data,
      postResponse: async (reviewId, body) => adopt(await send(() => postReplyAction(reviewId, body))),
      editResponse: async (reviewId, body) => adopt(await send(() => editReplyAction(reviewId, body))),
      addReviewRequest: async (input) => adopt(await send(() => createReviewRequestAction(input))),
    }),
    [data, adopt],
  );

  return <ReviewsContext value={value}>{children}</ReviewsContext>;
}

export function useReviews(): ReviewsContextValue {
  const context = useContext(ReviewsContext);
  if (!context) throw new Error("useReviews must be used inside <ReviewsProvider>.");
  return context;
}
