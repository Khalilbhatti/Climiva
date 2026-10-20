import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";
import { Pager, SearchBox } from "@/components/platform-admin/ListControls";
import { consoleHref, formatDay, formatInstant } from "@/components/platform-admin/format";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { platformReviews, type PlatformReviewRow, type ReviewVisibilityFilter } from "@/db/platform-queries";
import { setReviewModerationAction } from "@/server/actions/platform-admin";
import { pageNumber, requirePlatformAdmin, searchTerm } from "@/server/platform-admin";

export const metadata: Metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

const RATINGS = [1, 2, 3, 4, 5] as const;
const VISIBILITIES: { value: ReviewVisibilityFilter; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "hidden", label: "Hidden by the platform" },
];

const NOTICES: Record<string, { tone: "ok" | "problem"; text: string }> = {
  hidden: { tone: "ok", text: "The review is hidden from the Marketplace. The business still has it, exactly as it was, and the rating no longer counts it." },
  visible: { tone: "ok", text: "The review is shown on the Marketplace again, and the rating counts it." },
  unchanged: { tone: "ok", text: "Nothing changed: the review was already in that state." },
  "not-public": { tone: "problem", text: "Only a review the customer chose to make public can be hidden. Nothing changed." },
  missing: { tone: "problem", text: "That review no longer exists." },
  invalid: { tone: "problem", text: "That request could not be understood. Nothing changed." },
  "reason-too-long": { tone: "problem", text: "The reason is longer than 500 characters. Nothing changed." },
};

function ratingOf(value: string | string[] | undefined): number | null {
  const parsed = typeof value === "string" && /^[1-5]$/.test(value) ? Number(value) : null;
  return parsed;
}

function visibilityOf(value: string | string[] | undefined): ReviewVisibilityFilter | null {
  return typeof value === "string" && VISIBILITIES.some((option) => option.value === value) ? (value as ReviewVisibilityFilter) : null;
}

function Marketplace({ review }: { review: PlatformReviewRow }) {
  if (!review.public) return <StatusBadge tone="neutral">Private</StatusBadge>;
  if (review.moderation.state === "hidden") return <StatusBadge tone="danger">Hidden by the platform</StatusBadge>;
  return <StatusBadge tone="primary">Public</StatusBadge>;
}

function Moderation({ review, back }: { review: PlatformReviewRow; back: string }) {
  if (!review.public) return <span className="text-xs text-ink-muted">Private reviews are not on the Marketplace.</span>;
  if (review.moderation.state === "hidden") {
    return (
      <div className="w-60 space-y-2">
        <p className="text-xs text-ink-muted">
          <span className="font-semibold">Internal reason:</span> {review.moderation.reason ?? "None recorded."}
        </p>
        <p className="text-xs text-ink-muted">Hidden {formatInstant(review.moderation.decidedAt)}.</p>
        <form action={setReviewModerationAction}>
          <input type="hidden" name="reviewId" value={review.id} />
          <input type="hidden" name="state" value="visible" />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Restore
          </button>
        </form>
      </div>
    );
  }
  return (
    <details>
      <summary className={buttonClasses({ variant: "destructive", size: "sm", className: "cursor-pointer list-none" })}>Hide from Marketplace…</summary>
      <form action={setReviewModerationAction} className="mt-3 w-64 space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
        <input type="hidden" name="reviewId" value={review.id} />
        <input type="hidden" name="state" value="hidden" />
        <input type="hidden" name="back" value={back} />
        <label className="block text-xs font-semibold text-ink" htmlFor={`review-reason-${review.id}`}>
          Internal reason (optional)
        </label>
        <textarea
          id={`review-reason-${review.id}`}
          name="reason"
          maxLength={500}
          rows={3}
          className="w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-sm text-ink"
          aria-describedby={`review-reason-help-${review.id}`}
        />
        <p id={`review-reason-help-${review.id}`} className="text-mini text-ink-muted">
          Only administrators see this. The review stays with the business; it just stops appearing on the Marketplace and in its rating.
        </p>
        <button type="submit" className={buttonClasses({ variant: "destructive-solid", size: "sm" })}>
          Hide review
        </button>
      </form>
    </details>
  );
}

export default async function PlatformReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin();
  const params = await searchParams;
  const query = searchTerm(params.q);
  const page = pageNumber(params.page);
  const rating = ratingOf(params.rating);
  const visibility = visibilityOf(params.visibility);
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  const result = await platformReviews(admin.id, query, rating, visibility, page);
  const back = consoleHref("/platform-admin/reviews", { q: query, rating, visibility, page: page > 1 ? page : null });
  const filtered = Boolean(query || rating || visibility);

  return (
    <>
      <PageHeader title="Reviews" description="What customers wrote about businesses, across the platform. You can hide a public review from the Marketplace and restore it." />
      <p className="rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
        A review is shown to the business that earned it. It appears on that business&apos;s public Marketplace profile only when the customer chose to make it
        public, and never with more than the reviewer&apos;s first name and last initial. Hiding a review takes it off every public page and out of the rating; it
        never changes or deletes the review, and the business keeps it.
      </p>
      {notice && (
        <p role="status" className={`rounded-card border px-4 py-3 text-sm ${notice.tone === "ok" ? "border-positive-line bg-positive-soft text-positive" : "border-danger-line bg-danger-soft text-danger"}`}>
          {notice.text}
        </p>
      )}
      <SearchBox
        path="/platform-admin/reviews"
        query={query}
        label="Search reviews by business, reviewer or text"
        extra={
          <>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              Rating
              <select name="rating" defaultValue={rating ?? ""} className="rounded-btn border border-line bg-surface px-3 py-2 text-sm text-ink">
                <option value="">Any</option>
                {RATINGS.map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? "star" : "stars"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              Marketplace
              <select name="visibility" defaultValue={visibility ?? ""} className="rounded-btn border border-line bg-surface px-3 py-2 text-sm text-ink">
                <option value="">Any</option>
                {VISIBILITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      {result.rows.length === 0 ? (
        <EmptyState
          icon={Star}
          title={filtered ? "No review matches those filters" : "No reviews yet"}
          description={filtered ? "Clear a filter or search for different words." : "Reviews appear here once customers answer a business's review request."}
        />
      ) : (
        <>
          <Table aria-label="Reviews">
            <TableHead>
              <tr>
                <TableHeaderCell>Business</TableHeaderCell>
                <TableHeaderCell>Rating</TableHeaderCell>
                <TableHeaderCell>Review</TableHeaderCell>
                <TableHeaderCell>Reviewer</TableHeaderCell>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Reply</TableHeaderCell>
                <TableHeaderCell>Marketplace</TableHeaderCell>
                <TableHeaderCell>Moderation</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {result.rows.map((review) => (
                <TableRow key={review.id} className="align-top">
                  <TableCell>
                    <Link href={consoleHref(`/platform-admin/organizations/${review.organizationId}`)} className="font-semibold text-primary hover:underline">
                      {review.organizationName}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{review.rating} / 5</TableCell>
                  <TableCell className="max-w-md whitespace-pre-line">{review.text}</TableCell>
                  <TableCell>{review.reviewer || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-ink-muted">{formatDay(review.submittedOn)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={review.replied ? "positive" : "warning"}>{review.replied ? "Replied" : "Awaiting reply"}</StatusBadge>
                  </TableCell>
                  <TableCell>
                    <Marketplace review={review} />
                  </TableCell>
                  <TableCell>
                    <Moderation review={review} back={back} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager path="/platform-admin/reviews" query={query} page={page} total={result.total} extra={{ rating, visibility }} />
        </>
      )}
    </>
  );
}
