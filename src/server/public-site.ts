import "server-only";
import { cache } from "react";
import type { DiscoveryFacets, DiscoveryResults, MarketplaceSitemap } from "@/data/marketplace-discovery";
import type { PublicListingData, PublicSite } from "@/data/public-site";
import {
  loadMarketplaceBooking,
  loadMarketplaceFacets,
  loadMarketplaceResults,
  loadMarketplaceSitemap,
  loadPublicListing,
  loadPublicSite,
  loadPublicSiteDomain,
  type MarketplaceBookingContext,
} from "@/db/public-queries";
import type { DiscoveryQuery } from "@/lib/marketplace-discovery";
import type { SiteView } from "@/components/website/site-view";
import { summarizeHours } from "@/lib/settings-state";

/**
 * Reading what a visitor may see, for the PUBLIC pages. There is no session here and none is asked for: a published site and a published
 * listing are found by their public identity, and the answer is only the public projection (src/db/public-queries). Nothing is read from a
 * cookie or from a request body, and nothing is shared between visitors: `cache()` memoises within ONE request (the page and its metadata
 * both ask) and is never shared across requests or people.
 */

/** A published site and one of its pages by address ("" is the home page), or null (unknown, private or unpublished). */
export const getPublicSite = cache(async (platformSlug: string, pageSlug: string): Promise<PublicSite | null> => loadPublicSite(platformSlug, pageSlug));

/**
 * A published site's main ACTIVE custom domain, or null. Memoised for the request like the site itself, because the page AND its metadata ask:
 * both wait for the same answer, so what is in the page's head never depends on which of them happened to finish first.
 */
export const getPublicSiteDomain = cache(async (platformSlug: string): Promise<string | null> => loadPublicSiteDomain(platformSlug));

/** A published Marketplace listing by its public identity, or null. */
export const getPublicListing = cache(async (publicSlug: string): Promise<PublicListingData | null> => loadPublicListing(publicSlug));

/**
 * The Marketplace for a visitor: the providers a search matches, what there is to choose from, the pages a search engine may be told about, and one
 * Service of one listing for its booking page. Like the rest of this file there is no session and nothing is shared between visitors; each is
 * memoised for ONE request on primitive arguments (an object would never be the same twice), because a page and its metadata both ask.
 */
const resultsFor = cache(async (words: string, service: string, location: string, booking: string, category: string, page: number): Promise<DiscoveryResults> =>
  loadMarketplaceResults(filtersOf(words, service, location, booking, category), page),
);
const facetsFor = cache(async (words: string, service: string, location: string, booking: string, category: string): Promise<DiscoveryFacets> =>
  loadMarketplaceFacets(filtersOf(words, service, location, booking, category)),
);

function filtersOf(words: string, service: string, location: string, booking: string, category: string) {
  return {
    tokens: words === "" ? [] : words.split(" "),
    service: service || null,
    location: location || null,
    booking: (booking || null) as DiscoveryQuery["booking"],
    category: (category || null) as DiscoveryQuery["category"],
  };
}

export const getMarketplaceResults = (query: DiscoveryQuery): Promise<DiscoveryResults> =>
  resultsFor(query.tokens.join(" "), query.service ?? "", query.location ?? "", query.booking ?? "", query.category ?? "", query.page);

export const getMarketplaceFacets = (query: DiscoveryQuery): Promise<DiscoveryFacets> =>
  facetsFor(query.tokens.join(" "), query.service ?? "", query.location ?? "", query.booking ?? "", query.category ?? "");

export const getMarketplaceSitemap = cache(async (): Promise<MarketplaceSitemap> => loadMarketplaceSitemap());

/** One Service of one published, allowed listing that offers online booking, or null. */
export const getMarketplaceBooking = cache(async (listingSlug: string, serviceSlug: string): Promise<MarketplaceBookingContext | null> => loadMarketplaceBooking(listingSlug, serviceSlug));

/**
 * The renderer's input for a visitor: the published pages, the business, its hours and its public Services. `base` is where its pages' links
 * lead: `/sites/<address>` on the platform (the default), and the empty string on a customer's own domain, where the pages are at the root.
 */
export function publicViewOf(site: PublicSite, base: string = `/sites/${site.site.platformSlug}`): SiteView {
  return {
    business: site.business,
    logo: site.logo,
    hours: summarizeHours(site.hours, site.preferences.timeFormat),
    services: site.services,
    display: site.version.settings.serviceDisplay,
    theme: site.version.theme,
    base,
    pages: site.nav.map((page) => ({ key: page.key, title: page.title, slug: page.slug, type: page.type })),
    visitor: true,
  };
}
