import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";
import { Pager, SearchBox } from "@/components/platform-admin/ListControls";
import { consoleHref, formatDay } from "@/components/platform-admin/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { platformReviews } from "@/db/platform-queries";
import { pageNumber, requirePlatformAdmin, searchTerm } from "@/server/platform-admin";

export const metadata: Metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

const RATINGS = [1, 2, 3, 4, 5] as const;

function ratingOf(value: string | string[] | undefined): number | null {
  const parsed = typeof value === "string" && /^[1-5]$/.test(value) ? Number(value) : null;
  return parsed;
}

export default async function PlatformReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin();
  const params = await searchParams;
  const query = searchTerm(params.q);
  const page = pageNumber(params.page);
  const rating = ratingOf(params.rating);
  const result = await platformReviews(admin.id, query, rating, page);

  return (
    <>
      <PageHeader title="Reviews" description="What customers wrote about businesses, across the platform. Read-only." />
      <p className="rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
        Reviews are shown to the business that earned them and to nobody else: no published Site or Marketplace listing displays a review. Suspending or hiding reviews
        arrives together with public reviews, so there is nothing to moderate on this page today, and no review is changed or removed from here.
      </p>
      <SearchBox
        path="/platform-admin/reviews"
        query={query}
        label="Search reviews by business, reviewer or text"
        extra={
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
        }
      />
      {result.rows.length === 0 ? (
        <EmptyState
          icon={Star}
          title={query || rating ? "No review matches those filters" : "No reviews yet"}
          description={query || rating ? "Clear a filter or search for different words." : "Reviews appear here once businesses receive them."}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager path="/platform-admin/reviews" query={query} page={page} total={result.total} extra={{ rating }} />
        </>
      )}
    </>
  );
}
