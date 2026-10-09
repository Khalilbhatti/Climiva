import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewsView } from "@/components/reviews/ReviewsView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  const gate = await fixtureGate("Reviews");
  if (gate) return gate;
  // The tab and the empty-state preview live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <ReviewsView />
    </Suspense>
  );
}
