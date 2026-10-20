import type { ReactNode } from "react";
import Link from "next/link";
import { Star, Wrench } from "lucide-react";
import { useOperations } from "@/components/operations/OperationsProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { jobHref } from "@/config/routes";
import { getCustomerById } from "@/data/customers";
import type { Directory } from "@/data/directory";
import { getJobById, getServiceNameFor } from "@/data/operations";
import { REVIEW_STATUS_LABEL, describeRating, getReviewStatus, type Review } from "@/data/reviews";
import { cn } from "@/lib/cn";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

/** The person who wrote the review: their Customers record where there is one, otherwise the name on the review. */
export const reviewerName = (review: Pick<Review, "customerId" | "contactName">, dir: Pick<Directory, "customers">) =>
  (review.customerId ? getCustomerById(review.customerId, dir)?.name : undefined) ?? review.contactName ?? "Customer";

/** Stars with a text equivalent: the rating is never stars alone. */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span role="img" aria-label={describeRating(rating)} className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star key={value} aria-hidden className={cn("size-4", value <= rating ? "fill-warning text-warning" : "text-line-strong")} />
      ))}
    </span>
  );
}

export function ReviewStatusBadge({ review }: { review: Pick<Review, "response"> }) {
  const status = getReviewStatus(review);
  return <StatusBadge tone={status === "awaiting" ? "warning" : "positive"}>{REVIEW_STATUS_LABEL[status]}</StatusBadge>;
}

/**
 * Whether a review is on the business's public Marketplace profile. The customer decides (a review is private unless they chose to make it public) and
 * the business cannot change it; the platform may hide a public review, and then it says so (not why).
 */
export function ReviewVisibilityBadge({ review }: { review: Pick<Review, "public" | "platformHidden"> }) {
  if (!review.public) return <StatusBadge tone="neutral">Private</StatusBadge>;
  if (review.platformHidden) return <StatusBadge tone="danger">Hidden from Marketplace by Climvia</StatusBadge>;
  return <StatusBadge tone="primary">Public on Marketplace</StatusBadge>;
}

/** "#JB-204 · AC Repair & Diagnostics", a link to the Job record. */
export function RelatedJobChip({ jobId, children }: { jobId: string; children?: ReactNode }) {
  const dir = useDirectory();
  const { data } = useOperations();
  const job = getJobById(jobId, data);
  if (!job) return null;
  return (
    <Link
      href={jobHref(job.id)}
      className="inline-flex items-center gap-1.5 rounded-btn bg-surface-low px-2.5 py-1 text-xs font-medium text-ink-muted hover:text-primary"
    >
      <Wrench aria-hidden className="size-3.5" />
      {children ?? (
        <>
          Job #{job.id} · {getServiceNameFor(job, dir)}
        </>
      )}
    </Link>
  );
}
