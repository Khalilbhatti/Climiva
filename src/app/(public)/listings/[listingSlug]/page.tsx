import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingFrame } from "@/components/marketplace/ListingFrame";
import { ListingView, type ListingViewData } from "@/components/marketplace/ListingView";
import { platformHost } from "@/data/website";
import { summarizeHours } from "@/lib/settings-state";
import { getPublicListing } from "@/server/public-site";

/**
 * A PUBLISHED Marketplace listing, for anyone. The address names a listing (its public identity), the server finds the business that owns
 * it, and the page shows only what the listing switches on: a contact detail the business turned off is not even in the answer. A listing
 * that is hidden, not set up or unknown is the same "not found".
 */
export async function generateMetadata({ params }: PageProps<"/listings/[listingSlug]">): Promise<Metadata> {
  const { listingSlug } = await params;
  const listing = await getPublicListing(listingSlug);
  if (!listing) return { title: { absolute: "Page not found" }, robots: { index: false } };
  return { title: { absolute: `${listing.business.name} · Climvia Marketplace` }, description: listing.description };
}

export default async function PublicListingPage({ params }: PageProps<"/listings/[listingSlug]">) {
  const { listingSlug } = await params;
  const listing = await getPublicListing(listingSlug);
  if (!listing) notFound();

  const data: ListingViewData = {
    description: listing.description,
    cover: listing.cover,
    contact: listing.contact,
    actions: listing.actions,
    business: listing.business,
    logo: listing.logo,
    hours: summarizeHours(listing.hours, listing.timeFormat),
    services: listing.services,
    website: listing.siteSlug ? platformHost(listing.siteSlug) : null,
    // The actions lead to the business's published website, when it has one.
    site: listing.siteSlug
      ? { base: `/sites/${listing.siteSlug}`, pages: listing.sitePages.map((page) => ({ key: page.key, title: page.title, slug: page.slug, type: page.type })) }
      : null,
  };
  return (
    <div className="min-h-dvh bg-surface-low px-4 py-6">
      <ListingFrame businessName={listing.business.name}>
        <main className="p-4 @2xl:p-6">
          <ListingView data={data} variant="page" />
        </main>
      </ListingFrame>
    </div>
  );
}
