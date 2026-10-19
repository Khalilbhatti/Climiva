import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Globe, ListChecks, Store, Users, Wrench } from "lucide-react";
import { consoleHref, formatInstant, plural } from "@/components/platform-admin/format";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { platformOrganization } from "@/db/platform-queries";
import { isUuid } from "@/db/tenant";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const metadata: Metadata = { title: "Organization" };
export const dynamic = "force-dynamic";

const dash = (value: string | null) => value || "—";

export default async function PlatformOrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const admin = await requirePlatformAdmin();
  const { organizationId } = await params;
  if (!isUuid(organizationId)) notFound();
  const detail = await platformOrganization(admin.id, organizationId);
  if (!detail) notFound();
  const { profile, memberships, services, sites, listing, counts } = detail;
  const address = [profile.addressLine1, profile.addressLine2, [profile.city, profile.stateRegion, profile.postalCode].filter(Boolean).join(", "), profile.country].filter(Boolean).join(" · ");

  return (
    <>
      <Link href="/platform-admin/organizations" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" />
        Organizations
      </Link>
      <PageHeader title={profile.name} description={`Created ${formatInstant(profile.createdAt)}. Read-only: nothing on this page changes the business.`} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Business profile" icon={Building2}>
          <KeyValueList
            items={[
              { label: "Address in Climvia", value: profile.slug },
              { label: "Phone", value: dash(profile.phone) },
              { label: "Email", value: dash(profile.email) },
              { label: "Location", value: address || "—" },
              { label: "Time zone", value: profile.timezone },
              { label: "Currency", value: profile.currency },
              { label: "Set-up finished", value: formatInstant(profile.onboardingCompletedAt) },
            ]}
          />
        </SectionCard>

        <SectionCard title="Activity" description="Records the business holds, as counts only." icon={ListChecks}>
          <KeyValueList
            layout="tiles"
            items={[
              { label: "Customers", value: counts.customers },
              { label: "Bookings", value: counts.bookings },
              { label: "Jobs", value: counts.jobs },
              { label: "Quotes", value: counts.quotes },
              { label: "Invoices", value: counts.invoices },
              { label: "Payments", value: counts.payments },
              { label: "Reviews", value: counts.reviews },
              { label: "Custom domains", value: counts.domains },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard title="People" description={`${plural(memberships.length, "membership")} in this business's workspace.`} icon={Users}>
        {memberships.length === 0 ? (
          <p className="text-sm text-ink-muted">Nobody belongs to this workspace.</p>
        ) : (
          <Table aria-label="Memberships">
            <TableHead>
              <tr>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Since</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {memberships.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="text-ink-muted">{member.email}</TableCell>
                  <TableCell className="capitalize">{member.role}</TableCell>
                  <TableCell>
                    <StatusBadge tone={member.status === "active" ? "positive" : "warning"}>{member.status === "active" ? "Active" : "Invited"}</StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-ink-muted">{formatInstant(member.since)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Services" description={plural(services.length, "Service")} icon={Wrench}>
          {services.length === 0 ? (
            <p className="text-sm text-ink-muted">No Services yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {services.map((service) => (
                <li key={service.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-medium text-ink">{service.name}</span>
                  <StatusBadge tone={service.isActive ? "positive" : "neutral"}>{service.isActive ? "Active" : "Inactive"}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Sites" description={plural(sites.length, "site")} icon={Globe}>
          {sites.length === 0 ? (
            <p className="text-sm text-ink-muted">No Sites yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {sites.map((site) => (
                <li key={site.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium text-ink">{site.name}</span>
                    <span className="block text-xs text-ink-muted">
                      {site.platformSlug}
                      {site.isPrimary ? " · primary" : ""}
                    </span>
                  </span>
                  <StatusBadge tone={site.published ? "positive" : "neutral"}>{site.published ? "Published" : site.status === "archived" ? "Archived" : "Private"}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Marketplace listing" icon={Store}>
        {listing === null ? (
          <p className="text-sm text-ink-muted">This business has no Marketplace listing.</p>
        ) : (
          <div className="space-y-3">
            <KeyValueList
              items={[
                { label: "Listing address", value: listing.publicSlug },
                { label: "Chosen by the business", value: listing.status === "published" ? "Published" : listing.status === "hidden" ? "Hidden" : "Draft" },
                { label: "Platform decision", value: listing.moderation.state === "suspended" ? "Suspended" : "Allowed" },
                { label: "Selected Services", value: listing.selectedServices },
              ]}
            />
            <Link href={consoleHref("/platform-admin/marketplace", { q: listing.publicSlug })} className="text-sm font-semibold text-primary hover:underline">
              Review this listing in Marketplace Listings
            </Link>
          </div>
        )}
      </SectionCard>
    </>
  );
}
