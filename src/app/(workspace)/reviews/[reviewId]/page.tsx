import type { Metadata } from "next";
import { ReviewDetail } from "@/components/reviews/ReviewDetail";
import { REVIEWS } from "@/data/reviews";

// The sample reviews are prerendered. Any other id is resolved against the in-memory reviews on the client.
export function generateStaticParams() {
  return REVIEWS.map((review) => ({ reviewId: review.id }));
}

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: PageProps<"/reviews/[reviewId]">) {
  const { reviewId } = await params;
  return <ReviewDetail reviewId={reviewId} />;
}
