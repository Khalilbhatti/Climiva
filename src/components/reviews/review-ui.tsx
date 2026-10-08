import type { ReactNode } from "react";
import Link from "next/link";
import { Star, Wrench } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { jobHref } from "@/config/routes";
import { getCustomerById } from "@/data/customers";
import { getJobById, getServiceNameFor } from "@/data/operations";
import { REVIEW_STATUS_LABEL, describeRating, getReviewStatus, type Review } from "@/data/reviews";
import { cn } from "@/lib/cn";

/** The person who wrote the review: their Customers record where there is one, otherwise the name on the review. */
export const reviewerName = (review: Pick<Review, "customerId" | "contactName">) =>
  (review.customerId ? getCustomerById(review.customerId)?.name : undefined) ?? review.contactName ?? "Customer";

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

/** "#JB-204 · AC Repair & Diagnostics", a link to the Job record. */
export function RelatedJobChip({ jobId, children }: { jobId: string; children?: ReactNode }) {
  const job = getJobById(jobId);
  if (!job) return null;
  return (
    <Link
      href={jobHref(job.id)}
      className="inline-flex items-center gap-1.5 rounded-btn bg-surface-low px-2.5 py-1 text-xs font-medium text-ink-muted hover:text-primary"
    >
      <Wrench aria-hidden className="size-3.5" />
      {children ?? (
        <>
          Job #{job.id} · {getServiceNameFor(job)}
        </>
      )}
    </Link>
  );
}
