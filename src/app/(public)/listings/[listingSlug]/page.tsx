import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingFrame } from "@/components/marketplace/ListingFrame";
import { ListingView, type ListingViewData } from "@/components/marketplace/ListingView";
import { platformHost } from "@/data/website";
import { platformOrigin } from "@/lib/domain-config";
import { discoveryHref, readDiscoveryContext } from "@/lib/marketplace-discovery";
import { summarizeHours } from "@/lib/settings-state";
import { getPublicListing } from "@/server/public-site";

/**
 * A PUBLISHED Marketplace listing, for anyone: a provider's profile. The address names a listing (its public identity), the server finds the
 * business that owns it, and the page shows only what the listing switches on: a contact detail the business turned off is not even in the
 * answer. A listing that is hidden, not set up, suspended by the platform or unknown is the same "not found".
 *
 * The profile is the Marketplace's page about the business (its Services, the places it works, its public reviews and a way to book). The business's
 * own website is a different page at a different address, and the profile only links to it when the business chose to.
 */
export async function generateMetadata({ params }: PageProps<"/listings/[listingSlug]">): Promise<Metadata> {
  const { listingSlug } = await params;
  const listing = await getPublicListing(listingSlug);
  if (!listing) return { title: { absolute: "Page not found" }, robots: { index: false } };
  const origin = platformOrigin();
  return {
    title: { absolute: `${listing.business.name} · Climvia Marketplace` },
    description: listing.description,
    // The address with nothing after it is the profile; what a visitor was looking for (carried in the query) is not a different page.
    ...(origin ? { alternates: { canonical: `${origin}/listings/${listing.slug}` } } : {}),
  };
}

export default async function PublicListingPage({ params, searchParams }: PageProps<"/listings/[listingSlug]">) {
  const { listingSlug } = await params;
  const listing = await getPublicListing(listingSlug);
  if (!listing) notFound();
  const context = readDiscoveryContext(await searchParams);

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
    areas: listing.serviceAreas.map((area) => area.display),
    rating: listing.rating,
    reviews: listing.reviews,
    // Booking from here is a Marketplace booking: the Services lead to this listing's own booking page.
    book: { listing: listing.slug, context },
  };
  const searched = Boolean(context.service || context.location);
  return (
    <div className="min-h-dvh bg-surface-low px-4 py-6">
      <ListingFrame businessName={listing.business.name} back={{ href: discoveryHref({ service: context.service, location: context.location }), label: searched ? "Back to results" : "All providers" }}>
        <main className="p-4 @2xl:p-6">
          <ListingView data={data} variant="page" />
        </main>
      </ListingFrame>
    </div>
  );
}
