import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewsView } from "@/components/reviews/ReviewsView";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  await requireWorkspaceContext();
  // The tab and the empty-state preview live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <ReviewsView />
    </Suspense>
  );
}
