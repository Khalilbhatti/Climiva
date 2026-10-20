import type { Metadata } from "next";
import { Building2, CalendarCheck, CircleCheck, Globe, Inbox, Megaphone, Star, Store, UserCheck, Users, Ban } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { platformOverview } from "@/db/platform-queries";
import { requirePlatformAdmin } from "@/server/platform-admin";
import { plural } from "@/components/platform-admin/format";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function PlatformOverviewPage() {
  const admin = await requirePlatformAdmin();
  const totals = await platformOverview(admin.id);

  return (
    <>
      <PageHeader title="Platform overview" description="Counts across every business on Climvia, read from the database now." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Organizations" value={totals.organizations} icon={Building2} hint="Businesses with a workspace" href="/platform-admin/organizations" />
        <KpiCard label="Users" value={totals.users} icon={Users} hint="Accounts that can sign in" href="/platform-admin/users" />
        <KpiCard label="Active memberships" value={totals.activeMemberships} icon={UserCheck} hint="People in a business's workspace" />
        <KpiCard label="Sites" value={totals.sites} icon={Globe} hint={`${plural(totals.publishedSites, "site")} published`} />
        <KpiCard label="Published sites" value={totals.publishedSites} icon={CircleCheck} hint="Visible to the public" tone={totals.publishedSites > 0 ? "positive" : "default"} />
        <KpiCard label="Marketplace listings" value={totals.listings} icon={Store} hint={`${plural(totals.publishedListings, "listing")} published by their businesses`} href="/platform-admin/marketplace" />
        <KpiCard label="Published listings" value={totals.publishedListings} icon={Megaphone} hint="Chosen by the business to appear" />
        <KpiCard label="Suspended listings" value={totals.suspendedListings} icon={Ban} hint="Held back by the platform" href="/platform-admin/marketplace" />
        <KpiCard
          label="Review requests waiting"
          value={totals.pendingListingReviews}
          icon={Inbox}
          hint="Businesses asking for a suspension to be looked at again"
          href="/platform-admin/marketplace"
        />
        <KpiCard label="Bookings" value={totals.bookings} icon={CalendarCheck} hint="Across every business" />
        <KpiCard label="Reviews" value={totals.reviews} icon={Star} hint={`${plural(totals.publicReviews, "review")} public, ${totals.hiddenReviews} hidden by the platform`} href="/platform-admin/reviews" />
      </div>
      {totals.organizations === 0 && (
        <p className="rounded-card border border-line bg-surface px-5 py-4 text-sm text-ink-muted">
          No business has signed up yet. Counts appear here as businesses are created.
        </p>
      )}
    </>
  );
}
