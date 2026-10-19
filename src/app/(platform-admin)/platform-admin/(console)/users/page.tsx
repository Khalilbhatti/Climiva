import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { Pager, SearchBox } from "@/components/platform-admin/ListControls";
import { consoleHref, formatInstant } from "@/components/platform-admin/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { platformUsers } from "@/db/platform-queries";
import { pageNumber, requirePlatformAdmin, searchTerm } from "@/server/platform-admin";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin();
  const params = await searchParams;
  const query = searchTerm(params.q);
  const page = pageNumber(params.page);
  const result = await platformUsers(admin.id, query, page);

  return (
    <>
      <PageHeader title="Users" description="Accounts that can sign in, with the businesses they belong to. Passwords, sessions and recovery details are never shown here." />
      <SearchBox path="/platform-admin/users" query={query} label="Search users by name or email" />
      {result.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query ? "No user matches that search" : "No users yet"}
          description={query ? "Search by part of a name or an email address." : "Accounts appear here as soon as someone signs up."}
        />
      ) : (
        <>
          <Table aria-label="Users">
            <TableHead>
              <tr>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell>Businesses and roles</TableHeaderCell>
                <TableHeaderCell>Platform</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {result.rows.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-ink-muted">
                    {user.email}
                    {!user.emailVerified && <span className="block text-xs">Not verified</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-ink-muted">{formatInstant(user.createdAt)}</TableCell>
                  <TableCell>
                    {user.memberships.length === 0 ? (
                      <span className="text-ink-muted">No business</span>
                    ) : (
                      <ul className="space-y-1">
                        {user.memberships.map((membership) => (
                          <li key={membership.organizationId} className="text-sm">
                            <Link href={consoleHref(`/platform-admin/organizations/${membership.organizationId}`)} className="font-medium text-primary hover:underline">
                              {membership.organizationName}
                            </Link>
                            <span className="text-ink-muted">
                              {" "}
                              · {membership.role}
                              {membership.status === "invited" ? " (invited)" : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell>{user.isPlatformAdmin ? <StatusBadge tone="primary">Super administrator</StatusBadge> : <span className="text-ink-muted">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager path="/platform-admin/users" query={query} page={page} total={result.total} />
        </>
      )}
    </>
  );
}
