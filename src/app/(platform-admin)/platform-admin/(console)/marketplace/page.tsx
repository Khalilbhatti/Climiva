import type { Metadata } from "next";
import Link from "next/link";
import { Store } from "lucide-react";
import { Pager, SearchBox } from "@/components/platform-admin/ListControls";
import { consoleHref, formatInstant } from "@/components/platform-admin/format";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { platformListings, type PlatformListingRow } from "@/db/platform-queries";
import { setListingModerationAction } from "@/server/actions/platform-admin";
import { pageNumber, requirePlatformAdmin, searchTerm } from "@/server/platform-admin";

export const metadata: Metadata = { title: "Marketplace Listings" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: "ok" | "problem"; text: string }> = {
  suspended: { tone: "ok", text: "The listing is suspended. It is no longer public, and the business's own settings are untouched." },
  allowed: { tone: "ok", text: "The listing is allowed again. It is public only while the business has it published." },
  unchanged: { tone: "ok", text: "Nothing changed: the listing was already in that state." },
  missing: { tone: "problem", text: "That listing no longer exists." },
  invalid: { tone: "problem", text: "That request could not be understood. Nothing changed." },
  "reason-too-long": { tone: "problem", text: "The reason is longer than 500 characters. Nothing changed." },
};

const BUSINESS_STATUS: Record<string, string> = { published: "Published", hidden: "Hidden", draft: "Draft" };

function Moderation({ row, back }: { row: PlatformListingRow; back: string }) {
  if (row.moderation.state === "suspended") {
    return (
      <div className="space-y-2">
        {row.moderation.reason ? (
          <p className="text-xs text-ink-muted">
            <span className="font-semibold">Internal reason:</span> {row.moderation.reason}
          </p>
        ) : (
          <p className="text-xs text-ink-muted">No reason recorded.</p>
        )}
        <form action={setListingModerationAction}>
          <input type="hidden" name="listingId" value={row.id} />
          <input type="hidden" name="state" value="allowed" />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Allow again
          </button>
        </form>
      </div>
    );
  }
  return (
    <details className="group">
      <summary className={buttonClasses({ variant: "destructive", size: "sm", className: "cursor-pointer list-none" })}>Suspend…</summary>
      <form action={setListingModerationAction} className="mt-3 w-64 space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
        <input type="hidden" name="listingId" value={row.id} />
        <input type="hidden" name="state" value="suspended" />
        <input type="hidden" name="back" value={back} />
        <label className="block text-xs font-semibold text-ink" htmlFor={`reason-${row.id}`}>
          Internal reason (optional)
        </label>
        <textarea
          id={`reason-${row.id}`}
          name="reason"
          maxLength={500}
          rows={3}
          className="w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-sm text-ink"
          aria-describedby={`reason-help-${row.id}`}
        />
        <p id={`reason-help-${row.id}`} className="text-mini text-ink-muted">
          Only administrators see this. It is never shown to the business or the public.
        </p>
        <button type="submit" className={buttonClasses({ variant: "destructive-solid", size: "sm" })}>
          Suspend listing
        </button>
      </form>
    </details>
  );
}

export default async function PlatformMarketplacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin();
  const params = await searchParams;
  const query = searchTerm(params.q);
  const page = pageNumber(params.page);
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  const result = await platformListings(admin.id, query, page);
  const back = consoleHref("/platform-admin/marketplace", { q: query, page: page > 1 ? page : null });

  return (
    <>
      <PageHeader
        title="Marketplace listings"
        description="A listing is public only when its business has published it and the platform has not suspended it. Suspending keeps everything the business wrote."
      />
      {notice && (
        <p role="status" className={`rounded-card border px-4 py-3 text-sm ${notice.tone === "ok" ? "border-positive-line bg-positive-soft text-positive" : "border-danger-line bg-danger-soft text-danger"}`}>
          {notice.text}
        </p>
      )}
      <SearchBox path="/platform-admin/marketplace" query={query} label="Search listings by business name or listing address" />
      {result.rows.length === 0 ? (
        <EmptyState
          icon={Store}
          title={query ? "No listing matches that search" : "No Marketplace listings yet"}
          description={query ? "Search by part of the business name or the listing address." : "A listing appears here once a business sets one up."}
        />
      ) : (
        <>
          <Table aria-label="Marketplace listings">
            <TableHead>
              <tr>
                <TableHeaderCell>Business</TableHeaderCell>
                <TableHeaderCell>Business chose</TableHeaderCell>
                <TableHeaderCell>Platform decision</TableHeaderCell>
                <TableHeaderCell>Public now</TableHeaderCell>
                <TableHeaderCell className="text-right">Services</TableHeaderCell>
                <TableHeaderCell>Site</TableHeaderCell>
                <TableHeaderCell>Moderation</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell>
                    <Link href={consoleHref(`/platform-admin/organizations/${row.organizationId}`)} className="font-semibold text-primary hover:underline">
                      {row.organizationName}
                    </Link>
                    <p className="text-xs text-ink-muted">/listings/{row.publicSlug}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.status === "published" ? "positive" : "neutral"}>{BUSINESS_STATUS[row.status] ?? row.status}</StatusBadge>
                    {row.publishedAt && <p className="mt-1 text-xs text-ink-muted">{formatInstant(row.publishedAt)}</p>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.moderation.state === "suspended" ? "danger" : "positive"}>{row.moderation.state === "suspended" ? "Suspended" : "Allowed"}</StatusBadge>
                    {row.moderation.state === "suspended" && row.moderation.decidedAt && <p className="mt-1 text-xs text-ink-muted">{formatInstant(row.moderation.decidedAt)}</p>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.publiclyAvailable ? "positive" : "neutral"}>{row.publiclyAvailable ? "Available" : "Not available"}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.selectedServices}</TableCell>
                  <TableCell>
                    {row.site ? (
                      <>
                        <span className="text-sm">{row.site.platformSlug}</span>
                        <p className="text-xs text-ink-muted">{row.site.published ? "Published" : "Private"}</p>
                      </>
                    ) : (
                      <span className="text-ink-muted">No site</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Moderation row={row} back={back} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager path="/platform-admin/marketplace" query={query} page={page} total={result.total} />
        </>
      )}
    </>
  );
}
