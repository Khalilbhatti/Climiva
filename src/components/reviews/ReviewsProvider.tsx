"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/components/settings/SettingsProvider";
import { REVIEWS_DATA, type ReviewsData } from "@/data/reviews";
import * as state from "@/lib/reviews-state";

type ReviewsContextValue = {
  /** The working reviews: the baseline sample plus any replies and requests made in this session. */
  data: ReviewsData;
  postResponse: (reviewId: string, body: string) => void;
  editResponse: (reviewId: string, body: string) => void;
  addReviewRequest: (input: state.NewReviewRequest) => void;
};

const ReviewsContext = createContext<ReviewsContextValue | null>(null);

/** In memory only; a reload restores the baseline. Nothing is sent to, or read from, any outside review site. */
export function ReviewsProvider({ initial = REVIEWS_DATA, children }: { initial?: ReviewsData; children: ReactNode }) {
  const [data, setData] = useState<ReviewsData>(initial);
  const author = useSettings().settings.profile.name;
  const latest = useRef(data);

  const commit = useCallback((next: ReviewsData) => {
    latest.current = next;
    setData(next);
  }, []);

  const value = useMemo<ReviewsContextValue>(
    () => ({
      data,
      postResponse: (reviewId, body) => commit(state.postResponse(latest.current, reviewId, body, author)),
      editResponse: (reviewId, body) => commit(state.editResponse(latest.current, reviewId, body)),
      addReviewRequest: (input) => commit(state.addReviewRequest(latest.current, input).data),
    }),
    [data, author, commit],
  );

  return <ReviewsContext value={value}>{children}</ReviewsContext>;
}

export function useReviews(): ReviewsContextValue {
  const context = useContext(ReviewsContext);
  if (!context) throw new Error("useReviews must be used inside <ReviewsProvider>.");
  return context;
}
