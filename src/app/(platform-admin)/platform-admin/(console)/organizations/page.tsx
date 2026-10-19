import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { Pager, SearchBox } from "@/components/platform-admin/ListControls";
import { consoleHref, formatInstant } from "@/components/platform-admin/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { platformOrganizations } from "@/db/platform-queries";
import { pageNumber, requirePlatformAdmin, searchTerm } from "@/server/platform-admin";

export const metadata: Metadata = { title: "Organizations" };
export const dynamic = "force-dynamic";

export default async function PlatformOrganizationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin();
  const params = await searchParams;
  const query = searchTerm(params.q);
  const page = pageNumber(params.page);
  const result = await platformOrganizations(admin.id, query, page);

  return (
    <>
      <PageHeader title="Organizations" description="Every business on the platform. Open one to see its profile, people, Services, Sites and Marketplace listing." />
      <SearchBox path="/platform-admin/organizations" query={query} label="Search organizations by business name" />
      {result.rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={query ? "No organization matches that name" : "No organizations yet"}
          description={query ? "Check the spelling or search for part of the business name." : "A business appears here as soon as someone finishes setting up their workspace."}
        />
      ) : (
        <>
          <Table aria-label="Organizations">
            <TableHead>
              <tr>
                <TableHeaderCell>Business</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell className="text-right">Members</TableHeaderCell>
                <TableHeaderCell className="text-right">Owners</TableHeaderCell>
                <TableHeaderCell className="text-right">Services</TableHeaderCell>
                <TableHeaderCell className="text-right">Sites</TableHeaderCell>
                <TableHeaderCell>Marketplace listing</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={consoleHref(`/platform-admin/organizations/${row.id}`)} className="font-semibold text-primary hover:underline">
                      {row.name}
                    </Link>
                    <p className="text-xs text-ink-muted">{row.slug}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-ink-muted">{formatInstant(row.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.memberships}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.owners}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.services}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.sites}
                    {row.publishedSites > 0 && <span className="text-xs text-ink-muted"> ({row.publishedSites} live)</span>}
                  </TableCell>
                  <TableCell>
                    {row.listingStatus === null ? (
                      <span className="text-ink-muted">No listing</span>
                    ) : row.listingModeration === "suspended" ? (
                      <StatusBadge tone="danger">Suspended by platform</StatusBadge>
                    ) : (
                      <StatusBadge tone={row.listingStatus === "published" ? "positive" : "neutral"}>{row.listingStatus === "published" ? "Published" : row.listingStatus === "hidden" ? "Hidden" : "Draft"}</StatusBadge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager path="/platform-admin/organizations" query={query} page={page} total={result.total} />
        </>
      )}
    </>
  );
}
