"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquareText, Plus, Reply, Send, Star } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { REVIEW_BASELINE, REVIEW_SOURCES, getReviewMetrics, getReviewStatus, type Review, type ReviewSource } from "@/data/reviews";
import { formatDate } from "@/lib/format";
import { ReplyModal } from "./ReplyModal";
import { RequestReviewModal } from "./RequestReviewModal";
import { useReviews } from "./ReviewsProvider";
import { RelatedJobChip, ReviewStatusBadge, Stars, reviewerName } from "./review-ui";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan, useWorkspace } from "@/components/workspace/WorkspaceProvider";

type View = "all" | "awaiting" | "responded";
const VIEWS: View[] = ["all", "awaiting", "responded"];
const ZERO = { total: 0, average: 0, awaiting: 0, responded: 0, requests: 0 };

export function ReviewsView() {
  const dir = useDirectory();
  const { data } = useReviews();
  const canManage = useCan("reviews:manage");
  const { hasSampleData } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const view: View = VIEWS.find((id) => id === params.get("tab")) ?? "all";
  // ?state=empty previews the approved empty state without having to remove every review.
  const previewEmpty = params.get("state") === "empty";

  const [query, setQuery] = useState("");
  const [rating, setRating] = useState("all");
  const [source, setSource] = useState<"all" | ReviewSource>("all");
  const [replying, setReplying] = useState<Review | null>(null);
  const [requesting, setRequesting] = useState(false);

  const reviews = useMemo(() => (previewEmpty ? [] : data.reviews), [previewEmpty, data.reviews]);
  // The sample business reports the approved workspace totals its stored reviews are a sample of; any other business counts its own.
  const metrics = previewEmpty ? ZERO : getReviewMetrics(data, hasSampleData ? REVIEW_BASELINE : undefined);
  const empty = reviews.length === 0;

  function setView(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id === "all") next.delete("tab");
    else next.set("tab", id);
    setQuery("");
    setRating("all");
    setSource("all");
    const qs = next.toString();
    router.replace((qs ? `/reviews?${qs}` : "/reviews") as Route, { scroll: false });
  }

  const needle = query.trim().toLowerCase();
  const visible = reviews.filter(
    (review) =>
      (view === "all" || getReviewStatus(review) === view) &&
      `${reviewerName(review, dir)} ${review.text}`.toLowerCase().includes(needle) &&
      (rating === "all" || review.rating === Number(rating)) &&
      (source === "all" || review.source === source),
  );
  const filtering = needle !== "" || rating !== "all" || source !== "all";
  const tabTotal = view === "all" ? metrics.total : view === "awaiting" ? metrics.awaiting : metrics.responded;

  return (
    <>
      <PageHeader
        title="Reviews"
        description="View customer reviews and respond from one place."
        actions={
          canManage && (
            <Button size="lg" onClick={() => setRequesting(true)}>
              <Plus aria-hidden className="size-[18px]" />
              Request review
            </Button>
          )
        }
      />

      <section aria-label="Review totals" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total reviews" value={metrics.total} icon={MessageSquareText} hint="Customer reviews received" />
        <KpiCard
          label="Average rating"
          value={empty ? "—" : metrics.average.toFixed(1)}
          icon={Star}
          hint={empty ? "No reviews recorded yet" : "Across recorded reviews"}
        />
        <KpiCard label="Awaiting reply" value={metrics.awaiting} icon={Reply} hint="Reviews without a response" />
        <KpiCard label="Review requests" value={previewEmpty ? 0 : metrics.requests} icon={Send} hint="Requests sent recently" />
      </section>

      <Card padding="md" className="space-y-4">
        <Tabs
          label="Review views"
          idPrefix="reviews"
          value={view}
          onChange={setView}
          tabs={[
            { id: "all", label: "All reviews", count: metrics.total },
            { id: "awaiting", label: "Awaiting reply", count: metrics.awaiting },
            { id: "responded", label: "Responded", count: metrics.responded },
          ]}
        />

        {empty ? (
          <div role="tabpanel" id="reviews-panel-all" aria-labelledby="reviews-tab-all">
            <EmptyState
              icon={MessageSquareText}
              title="No reviews yet"
              description="Customer reviews will appear here when they are submitted."
              action={
                canManage && (
                  <Button size="lg" onClick={() => setRequesting(true)}>
                    <Send aria-hidden className="size-4" />
                    Request review
                  </Button>
                )
              }
            />
            <p className="mt-3 text-center text-xs text-ink-muted">Review requests can be sent to existing customers after completed work.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <SearchInput
                wrapperClassName="min-w-60 flex-1"
                aria-label="Search reviews"
                placeholder="Search customer or review..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="w-40">
                <Select label="Rating" hideLabel value={rating} onChange={(event) => setRating(event.target.value)}>
                  <option value="all">Rating: All</option>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option key={value} value={value}>
                      {value} {value === 1 ? "star" : "stars"}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-40">
                <Select label="Source" hideLabel value={source} onChange={(event) => setSource(event.target.value as "all" | ReviewSource)}>
                  <option value="all">Source: All</option>
                  {REVIEW_SOURCES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div role="tabpanel" id={`reviews-panel-${view}`} aria-labelledby={`reviews-tab-${view}`} className="space-y-3">
              {visible.length === 0 ? (
                <p className="rounded-card bg-surface-low px-4 py-10 text-center text-sm text-ink-muted">
                  {filtering ? "No reviews match your filters." : "No reviews to show."}
                </p>
              ) : (
                <ul className="space-y-3">
                  {visible.map((review) => {
                    const awaiting = getReviewStatus(review) === "awaiting";
                    const name = reviewerName(review, dir);
                    return (
                      <li key={review.id}>
                        <article aria-label={`Review from ${name}`} className="rounded-card border border-line bg-surface p-5 shadow-card">
                          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link href={`/reviews/${review.id}`} className="text-base font-semibold text-ink hover:text-primary hover:underline">
                                  {name}
                                </Link>
                                <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-semibold text-primary">{review.source}</span>
                                <span className="text-xs text-ink-muted">· {formatDate(review.date)}</span>
                                <ReviewStatusBadge review={review} />
                              </div>
                              <Stars rating={review.rating} />
                              <p className="text-sm text-ink">“{review.text}”</p>
                              {review.relatedJobId && <RelatedJobChip jobId={review.relatedJobId} />}
                              {!review.relatedJobId && review.customerId && (
                                <Link
                                  href={`/customers/${review.customerId}`}
                                  className="inline-flex items-center rounded-btn bg-surface-low px-2.5 py-1 text-xs font-medium text-ink-muted hover:text-primary"
                                >
                                  Customer {name}
                                </Link>
                              )}
                              {review.response && (
                                <div className="rounded-card bg-surface-low p-3 text-sm">
                                  <p className="text-xs text-ink-muted">
                                    <span className="font-semibold text-ink">{review.response.by}</span> · {formatDate(review.response.at.slice(0, 10))}
                                  </p>
                                  <p className="mt-1 text-ink">{review.response.body}</p>
                                </div>
                              )}
                            </div>
                            {awaiting ? (
                              canManage && (
                                <Button size="sm" onClick={() => setReplying(review)} aria-label={`Reply to review from ${name}`}>
                                  <Reply aria-hidden className="size-3.5" />
                                  Reply
                                </Button>
                              )
                            ) : (
                              <ButtonLink href={`/reviews/${review.id}`} variant="secondary" size="sm" aria-label={`View response to ${name}`}>
                                View response
                              </ButtonLink>
                            )}
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p aria-live="polite" className="text-xs text-ink-muted">
                Showing {visible.length} of {tabTotal} {view === "all" ? "reviews" : view === "awaiting" ? "reviews awaiting reply" : "responded reviews"}
              </p>
            </div>
          </>
        )}
      </Card>

      {replying && canManage && <ReplyModal review={replying} mode="reply" onClose={() => setReplying(null)} />}
      {requesting && canManage && <RequestReviewModal onClose={() => setRequesting(false)} />}
    </>
  );
}
