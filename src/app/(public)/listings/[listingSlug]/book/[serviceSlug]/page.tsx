import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingFrame } from "@/components/marketplace/ListingFrame";
import { MarketplaceBooking } from "@/components/marketplace/MarketplaceBooking";
import { businessClock } from "@/lib/business-time";
import { profileHref, readDiscoveryContext } from "@/lib/marketplace-discovery";
import { PROTOTYPE_NOW } from "@/lib/prototype-clock";
import { getMarketplaceBooking } from "@/server/public-site";

/**
 * Booking one Service of a provider from the Marketplace, for anyone. The address names a LISTING and one of its Services; the server finds the
 * business and the Service from them and nothing else. A listing that is hidden, suspended, not taking online bookings, or a Service it does not
 * show or the business does not offer online, is the same "not found". The booking this page makes is recorded as a Marketplace booking: the
 * source is set by the server, never by the address.
 */
export async function generateMetadata({ params }: PageProps<"/listings/[listingSlug]/book/[serviceSlug]">): Promise<Metadata> {
  const { listingSlug, serviceSlug } = await params;
  const context = await getMarketplaceBooking(listingSlug, serviceSlug);
  if (!context) return { title: { absolute: "Page not found" }, robots: { index: false } };
  return { title: { absolute: `${context.service.name} · ${context.business.name} · Climvia Marketplace` }, robots: { index: false, follow: false } };
}

export default async function MarketplaceBookingPage({ params, searchParams }: PageProps<"/listings/[listingSlug]/book/[serviceSlug]">) {
  const { listingSlug, serviceSlug } = await params;
  const context = await getMarketplaceBooking(listingSlug, serviceSlug);
  if (!context) notFound();
  const discovery = readDiscoveryContext(await searchParams);
  const profile = profileHref(context.listingSlug, discovery);

  return (
    <div className="min-h-dvh bg-surface-low px-4 py-6">
      <ListingFrame businessName={context.business.name} back={{ href: profile, label: `Back to ${context.business.name}` }}>
        <main>
          <MarketplaceBooking
            listingSlug={context.listingSlug}
            business={context.business}
            service={context.service}
            hours={context.hours}
            today={businessClock(context.fixedClock, context.preferences.timeZone, PROTOTYPE_NOW).today}
            profileHref={profile}
            discoveryService={discovery.service ?? null}
            discoveryLocation={discovery.location ?? null}
          />
        </main>
      </ListingFrame>
    </div>
  );
}
