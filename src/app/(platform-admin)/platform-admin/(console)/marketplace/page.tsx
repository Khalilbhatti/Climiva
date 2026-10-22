import type { Metadata } from "next";
import Link from "next/link";
import { Store } from "lucide-react";
import { Pager, SearchBox } from "@/components/platform-admin/ListControls";
import { consoleHref, formatInstant, plural } from "@/components/platform-admin/format";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { platformListings, platformOverview, type PlatformListingRow } from "@/db/platform-queries";
import { keepListingSuspendedAction, setListingModerationAction, updateListingMessageAction } from "@/server/actions/platform-admin";
import { pageNumber, requirePlatformAdmin, searchTerm } from "@/server/platform-admin";

export const metadata: Metadata = { title: "Marketplace Listings" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: "ok" | "problem"; text: string }> = {
  suspended: { tone: "ok", text: "The listing is suspended. It is no longer public, and the business's own settings are untouched." },
  allowed: { tone: "ok", text: "The listing is allowed again. It is public only while the business has it published." },
  "message-updated": { tone: "ok", text: "The message to the business was updated. The internal reason was not changed." },
  kept: { tone: "ok", text: "The suspension stays. The business can see your answer in its Marketplace screen." },
  unchanged: { tone: "ok", text: "Nothing changed: the listing was already in that state." },
  missing: { tone: "problem", text: "That listing no longer exists." },
  invalid: { tone: "problem", text: "That request could not be understood. Nothing changed." },
  "reason-too-long": { tone: "problem", text: "The reason is longer than 500 characters. Nothing changed." },
  "message-too-long": { tone: "problem", text: "The message is longer than 500 characters. Nothing changed." },
};

const BUSINESS_STATUS: Record<string, string> = { published: "Published", hidden: "Hidden", draft: "Draft" };

const TEXTAREA = "w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-sm text-ink";
/** The table is wider than a laptop screen, and the actions are the point of the page: from the xl width the Moderation column stays in view while the rest scrolls. */
const STICKY_ACTIONS = "xl:sticky xl:right-0 xl:z-10 xl:border-l xl:border-line xl:shadow-[-10px_0_10px_-10px_rgb(0_0_0/0.15)]";

function Hidden({ row, back, state }: { row: PlatformListingRow; back: string; state?: string }) {
  return (
    <>
      <input type="hidden" name="listingId" value={row.id} />
      {state && <input type="hidden" name="state" value={state} />}
      <input type="hidden" name="back" value={back} />
    </>
  );
}

function MessageField({ row, kind, defaultValue }: { row: PlatformListingRow; kind: string; defaultValue?: string | null }) {
  const id = `message-${kind}-${row.id}`;
  return (
    <>
      <label className="block text-xs font-semibold text-ink" htmlFor={id}>
        Message to the business (optional)
      </label>
      <textarea id={id} name="tenantMessage" maxLength={500} rows={3} defaultValue={defaultValue ?? ""} className={TEXTAREA} aria-describedby={`${id}-help`} />
      <p id={`${id}-help`} className="text-mini text-ink-muted">
        The business reads this in its Marketplace screen. Say what was seen and what to change. Do not paste the internal reason.
      </p>
    </>
  );
}

function ReviewRequest({ row, back }: { row: PlatformListingRow; back: string }) {
  const review = row.moderation.review;
  if (review.state === "none") return null;
  if (review.state === "resolved") {
    return (
      <p className="text-xs text-ink-muted">
        <span className="font-semibold">Review request:</span> {review.outcome === "lifted" ? "answered by allowing the listing again" : "answered, the suspension stays"} ({formatInstant(review.resolvedAt)}).
      </p>
    );
  }
  return (
    <div role="group" aria-label={`Review request from ${row.organizationName}`} className="space-y-2 rounded-btn border border-warning-line bg-warning-soft p-2.5">
      <p className="text-xs font-semibold text-warning">The business asked for a second look</p>
      <p className="text-xs text-ink-muted">Asked {formatInstant(review.requestedAt)}.</p>
      {review.note ? (
        <p className="whitespace-pre-line text-xs text-ink">
          <span className="font-semibold">Their note:</span> {review.note}
        </p>
      ) : (
        <p className="text-xs text-ink-muted">They did not add a note.</p>
      )}
      <details>
        <summary className={buttonClasses({ variant: "secondary", size: "sm", className: "cursor-pointer list-none" })}>Keep suspended…</summary>
        <form action={keepListingSuspendedAction} className="mt-2 space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
          <Hidden row={row} back={back} />
          <MessageField row={row} kind="keep" defaultValue={row.moderation.tenantMessage} />
          <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Keep suspended
          </button>
        </form>
      </details>
      <form action={setListingModerationAction}>
        <Hidden row={row} back={back} state="allowed" />
        <button type="submit" className={buttonClasses({ variant: "primary", size: "sm" })}>
          Allow again
        </button>
      </form>
    </div>
  );
}

function Moderation({ row, back }: { row: PlatformListingRow; back: string }) {
  if (row.moderation.state === "suspended") {
    const pending = row.moderation.review.state === "requested";
    return (
      <div className="w-72 space-y-2">
        <p className="text-xs text-ink-muted">
          <span className="font-semibold">Internal reason:</span> {row.moderation.reason ?? "None recorded."}
        </p>
        <p className="whitespace-pre-line text-xs text-ink-muted">
          <span className="font-semibold">Message to the business:</span> {row.moderation.tenantMessage ?? "None."}
        </p>
        <ReviewRequest row={row} back={back} />
        <details>
          <summary className={buttonClasses({ variant: "secondary", size: "sm", className: "cursor-pointer list-none" })}>Edit message…</summary>
          <form action={updateListingMessageAction} className="mt-2 space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
            <Hidden row={row} back={back} />
            <MessageField row={row} kind="edit" defaultValue={row.moderation.tenantMessage} />
            <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Save message
            </button>
          </form>
        </details>
        {!pending && (
          <form action={setListingModerationAction}>
            <Hidden row={row} back={back} state="allowed" />
            <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Allow again
            </button>
          </form>
        )}
      </div>
    );
  }
  return (
    <details className="group">
      <summary className={buttonClasses({ variant: "destructive", size: "sm", className: "cursor-pointer list-none" })}>Suspend…</summary>
      <form action={setListingModerationAction} className="mt-3 w-72 space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
        <Hidden row={row} back={back} state="suspended" />
        <label className="block text-xs font-semibold text-ink" htmlFor={`reason-${row.id}`}>
          Internal reason (optional)
        </label>
        <textarea id={`reason-${row.id}`} name="reason" maxLength={500} rows={3} className={TEXTAREA} aria-describedby={`reason-help-${row.id}`} />
        <p id={`reason-help-${row.id}`} className="text-mini text-ink-muted">
          Only administrators see this. It is never shown to the business or the public.
        </p>
        <MessageField row={row} kind="suspend" />
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
  const [result, totals] = await Promise.all([platformListings(admin.id, query, page), platformOverview(admin.id)]);
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
      {totals.pendingListingReviews > 0 && (
        <p className="rounded-card border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning">
          {plural(totals.pendingListingReviews, "business", "businesses")} asked for a suspension to be looked at again. Those listings are first in the list.
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
                <TableHeaderCell>Services shown</TableHeaderCell>
                <TableHeaderCell>Service areas</TableHeaderCell>
                <TableHeaderCell>Site</TableHeaderCell>
                <TableHeaderCell className={`${STICKY_ACTIONS} xl:bg-surface-low`}>Moderation</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell>
                    <Link href={consoleHref(`/platform-admin/organizations/${row.organizationId}`)} className="font-semibold text-primary hover:underline">
                      {row.organizationName}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {row.publiclyAvailable ? (
                        <Link href={`/listings/${row.publicSlug}`} className="text-primary hover:underline">
                          /listings/{row.publicSlug}
                        </Link>
                      ) : (
                        <>/listings/{row.publicSlug}</>
                      )}
                    </p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.status === "published" ? "positive" : "neutral"}>{BUSINESS_STATUS[row.status] ?? row.status}</StatusBadge>
                    {row.publishedAt && <p className="mt-1 text-xs text-ink-muted">{formatInstant(row.publishedAt)}</p>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.moderation.state === "suspended" ? "danger" : "positive"}>{row.moderation.state === "suspended" ? "Suspended" : "Allowed"}</StatusBadge>
                    {row.moderation.state === "suspended" && (row.moderation.suspendedAt ?? row.moderation.decidedAt) && (
                      <p className="mt-1 text-xs text-ink-muted">{formatInstant(row.moderation.suspendedAt ?? row.moderation.decidedAt)}</p>
                    )}
                    {row.moderation.state === "suspended" && row.moderation.review.state === "requested" && (
                      <p className="mt-2">
                        <StatusBadge tone="warning">Review requested</StatusBadge>
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.publiclyAvailable ? "positive" : "neutral"}>{row.publiclyAvailable ? "Available" : "Not available"}</StatusBadge>
                    <p className="mt-1 text-xs text-ink-muted">{row.discoverable ? "Listed in the Marketplace" : "Not in the Marketplace"}</p>
                  </TableCell>
                  <TableCell className="max-w-56 text-xs text-ink">
                    {row.serviceNames.length === 0 ? <span className="text-ink-muted">None selected</span> : row.serviceNames.join(", ")}
                  </TableCell>
                  <TableCell className="max-w-56 text-xs text-ink">
                    {row.serviceAreas.length === 0 ? <span className="text-ink-muted">None listed</span> : row.serviceAreas.join(", ")}
                  </TableCell>
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
                  <TableCell className={`${STICKY_ACTIONS} xl:bg-surface`}>
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
