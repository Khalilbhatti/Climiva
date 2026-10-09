import type { Metadata } from "next";
import { ReviewDetail } from "@/components/reviews/ReviewDetail";
import { fixtureGate } from "@/server/fixture-gate";

// The sample reviews are prerendered. Any other id is resolved against the in-memory reviews on the client.
export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: PageProps<"/reviews/[reviewId]">) {
  const gate = await fixtureGate("Reviews");
  if (gate) return gate;
  const { reviewId } = await params;
  return <ReviewDetail reviewId={reviewId} />;
}
