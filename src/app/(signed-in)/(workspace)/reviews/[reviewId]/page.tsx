import type { Metadata } from "next";
import { ReviewDetail } from "@/components/reviews/ReviewDetail";
import { requireWorkspaceContext } from "@/server/workspace";

// A review belongs to one business and is looked up in the ACTIVE business's reviews on the client; the title names none.
export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: PageProps<"/reviews/[reviewId]">) {
  await requireWorkspaceContext();
  const { reviewId } = await params;
  return <ReviewDetail reviewId={reviewId} />;
}
