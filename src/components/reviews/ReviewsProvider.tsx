"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { IssuedReviewLink, ReviewRequestChannel, ReviewsData } from "@/data/reviews";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import { createReviewRequestAction, editReplyAction, postReplyAction, reissueReviewLinkAction } from "@/server/actions/reviews";

/** What every change resolves with: the reviews as stored (and, for a new request or a new link, the link, shown once), or why it was refused. */
type Done = Promise<ActionResult<{ reviews: ReviewsData; link?: IssuedReviewLink }>>;

export type NewReviewRequest = { customerId: string; relatedJobId?: string; channel: ReviewRequestChannel; message: string };

type ReviewsContextValue = {
  /** The business's reviews (each with its one response) and the review requests it recorded, as stored. */
  data: ReviewsData;
  /** Posts the business's response to a review. A review has one; the second is refused (use editResponse). */
  postResponse: (reviewId: string, body: string) => Done;
  /** Changes the text of the review's response. */
  editResponse: (reviewId: string, body: string) => Done;
  /** Records that the business asked for a review and makes its link. Nothing is sent: the business gives the customer the link. */
  addReviewRequest: (input: NewReviewRequest) => Done;
  /** Makes a new link for a request whose link was lost or ran out. The old link stops working. */
  reissueLink: (requestId: string) => Done;
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

  const adopt = useCallback((result: ActionResult<{ reviews: ReviewsData; link?: IssuedReviewLink }>) => {
    if (result.ok) setData(result.data.reviews);
    return result;
  }, []);

  const value = useMemo<ReviewsContextValue>(
    () => ({
      data,
      postResponse: async (reviewId, body) => adopt(await send(() => postReplyAction(reviewId, body))),
      editResponse: async (reviewId, body) => adopt(await send(() => editReplyAction(reviewId, body))),
      addReviewRequest: async (input) => adopt(await send(() => createReviewRequestAction(input))),
      reissueLink: async (requestId) => adopt(await send(() => reissueReviewLinkAction(requestId))),
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
