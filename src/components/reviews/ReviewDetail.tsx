"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, MessageSquare, Pencil, Reply } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionCard } from "@/components/ui/SectionCard";
import { customerHref, jobHref } from "@/config/routes";
import { getCustomerById } from "@/data/customers";
import { getJobById, getServiceNameFor } from "@/data/operations";
import { getReviewById, getReviewStatus } from "@/data/reviews";
import { formatTime } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { ReplyModal } from "./ReplyModal";
import { useReviews } from "./ReviewsProvider";
import { ReviewStatusBadge, Stars, reviewerName } from "./review-ui";

export function ReviewDetail({ reviewId }: { reviewId: string }) {
  const { data } = useReviews();
  const review = getReviewById(reviewId, data);
  const [dialog, setDialog] = useState<"reply" | "edit" | null>(null);
  const [posted, setPosted] = useState(false);

  if (!review) {
    return (
      <EmptyState
        as="h1"
        icon={MessageSquare}
        title="Review not found"
        description="That review isn’t in your list. It may have been removed, or the link may be incorrect."
        action={<ButtonLink href="/reviews">Back to Reviews</ButtonLink>}
      />
    );
  }

  const name = reviewerName(review);
  const status = getReviewStatus(review);
  const customer = review.customerId ? getCustomerById(review.customerId) : undefined;
  const job = review.relatedJobId ? getJobById(review.relatedJobId) : undefined;
  const response = review.response;

  return (
    <>
      <BackLink href="/reviews">Back to Reviews</BackLink>

      {posted && (
        <p role="status" className="flex items-start gap-2 rounded-card border border-positive-line bg-positive-soft p-4 text-sm text-positive">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">Response posted.</span> Your response has been added to the review.
          </span>
        </p>
      )}

      <header className={cardClasses("lg", "flex flex-col justify-between gap-4 lg:flex-row lg:items-start")}>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{name}</h1>
            <ReviewStatusBadge review={review} />
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <Stars rating={review.rating} />
            <span className="font-semibold text-ink">{review.rating.toFixed(1)}</span>
            <span>· Received {formatDate(review.date)}</span>
            <span>· Source: {review.source}</span>
          </p>
        </div>
        {status === "awaiting" ? (
          <Button onClick={() => setDialog("reply")}>
            <Reply aria-hidden className="size-4" />
            Reply to review
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setDialog("edit")}>
            <Pencil aria-hidden className="size-4" />
            Edit response
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <SectionCard title="Customer review">
            <blockquote className="text-base text-ink">“{review.text}”</blockquote>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <span className="font-medium text-ink">{name}</span>
              <Stars rating={review.rating} />
              <span>{describeStars(review.rating)}</span>
            </p>
          </SectionCard>

          <SectionCard title="Business response" description={response ? "Visible with this review." : undefined}>
            {response ? (
              <div className="space-y-2">
                <p className="text-sm text-ink">{response.body}</p>
                <p className="text-xs text-ink-muted">
                  Responded by {response.by} · {whenText(response.at)}
                  {response.edited ? " · Edited" : ""}
                </p>
              </div>
            ) : (
              <div className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">
                <p className="font-medium text-ink">No response posted yet</p>
                <p className="mt-0.5">{name}’s review is awaiting a business response.</p>
                <Button size="sm" className="mt-3" onClick={() => setDialog("reply")}>
                  Write a response
                </Button>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="lg:col-span-4">
          <SectionCard title="Related records">
            <ul className="space-y-4 text-sm">
              {customer && (
                <li>
                  <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Customer</p>
                  <Link href={customerHref(customer.id)} className="mt-1 flex items-center justify-between gap-2 rounded-btn bg-surface-low p-3 font-medium text-ink hover:text-primary">
                    {customer.name}
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      View customer
                      <ArrowRight aria-hidden className="size-3.5" />
                    </span>
                  </Link>
                </li>
              )}
              {job && (
                <li>
                  <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Job #{job.id}</p>
                  <Link href={jobHref(job.id)} className="mt-1 flex items-center justify-between gap-2 rounded-btn bg-surface-low p-3 font-medium text-ink hover:text-primary">
                    #{job.id} · {getServiceNameFor(job)}
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      View job
                      <ArrowRight aria-hidden className="size-3.5" />
                    </span>
                  </Link>
                </li>
              )}
              {!customer && !job && <li className="text-ink-muted">{name} has no Customers record or job linked to this review.</li>}
            </ul>
          </SectionCard>
        </div>
      </div>

      {dialog && (
        <ReplyModal
          review={review}
          mode={dialog}
          onClose={() => setDialog(null)}
          onDone={() => setPosted(dialog === "reply")}
        />
      )}
    </>
  );
}

/** "2024-10-25T10:45" → "Oct 25, 2024 at 10:45 AM" (business-local, no timezone conversion). */
const whenText = (at: string) => {
  const [date, time] = at.split("T");
  return `${formatDate(date)} at ${formatTime(time)}`;
};

const describeStars = (rating: number) => `${rating} out of 5 stars`;
