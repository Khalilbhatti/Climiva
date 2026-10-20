import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ListingFrame } from "@/components/marketplace/ListingFrame";
import { ListingView, type ListingViewData } from "@/components/marketplace/ListingView";
import { PublicHeader } from "@/components/public/PublicHeader";
import { siteAddressing } from "@/lib/domain-config";
import { platformSiteUrl } from "@/lib/site-domain";
import { platformOrigin } from "@/lib/domain-config";
import { discoveryHref, readDiscoveryContext } from "@/lib/marketplace-discovery";
import { summarizeHours } from "@/lib/settings-state";
import { jsonLd, providerStructuredData } from "@/lib/structured-data";
import { getPublicListing } from "@/server/public-site";

/**
 * A PUBLISHED Marketplace listing, for anyone: a provider's profile. The address names a listing (its public identity), the server finds the
 * business that owns it, and the page shows only what the listing switches on: a contact detail the business turned off is not even in the
 * answer. A listing that is hidden, not set up, suspended by the platform or unknown is the same "not found".
 *
 * The profile is the Marketplace's page about the business (its Services, the places it works, its public reviews and a way to book). The business's
 * own website is a different page at a different address, and the profile only links to it when the business chose to.
 *
 * Three different things are offered on it and kept apart: booking THIS provider (the Service buttons inside the profile), the provider's own website
 * (only when it chose to link it), and Climvia's own invitation to a business to list itself (the header's "List your business" and the note under the
 * profile, which says in words that it is not about booking this provider).
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
    website: listing.siteSlug ? platformSiteUrl(listing.siteSlug, siteAddressing()) : null,
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
  const origin = platformOrigin();
  const address = listing.contact.address ? listing.business.address : null;
  // Structured data says only what the profile shows: the details the business switched on, and a rating only from reviews that are public right now.
  const structured = providerStructuredData(origin, {
    slug: listing.slug,
    name: listing.business.name,
    description: listing.description,
    phone: listing.contact.phone && listing.business.phone ? listing.business.phone : null,
    address: address ? { street: address.street || null, city: address.city || null, state: address.state || null, postalCode: address.postalCode || null } : null,
    rating: listing.rating,
  });
  return (
    <div className="min-h-dvh bg-surface-low">
      {structured && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />}
      <PublicHeader tone="on-light" className="border-b border-line bg-surface" />
      <div className="px-4 py-6">
        <ListingFrame businessName={listing.business.name} back={{ href: discoveryHref({ service: context.service, location: context.location }), label: searched ? "Back to results" : "All providers" }}>
          <main className="p-4 @2xl:p-6">
            <ListingView data={data} variant="page" />
          </main>
        </ListingFrame>
        <aside aria-labelledby="own-business-heading" className="mx-auto mt-6 max-w-5xl rounded-card border border-line bg-surface p-5">
          <h2 id="own-business-heading" className="text-base font-bold text-ink">
            Do you run an HVAC business?
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Climvia is also business software, and this Marketplace lists the businesses that use it. This is an invitation to businesses: to book {listing.business.name}, use the
            service buttons above.
          </p>
          <Link prefetch={false} href="/signup" className="mt-3 inline-block rounded-btn text-sm font-semibold text-primary underline-offset-4 hover:underline">
            List your business on Climvia
          </Link>
        </aside>
      </div>
    </div>
  );
}
