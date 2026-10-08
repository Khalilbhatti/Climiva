import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewsView } from "@/components/reviews/ReviewsView";

export const metadata: Metadata = { title: "Reviews" };

export default function ReviewsPage() {
  // The tab and the empty-state preview live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <ReviewsView />
    </Suspense>
  );
}
