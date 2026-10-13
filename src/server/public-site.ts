import "server-only";
import { cache } from "react";
import type { PublicListingData, PublicSite } from "@/data/public-site";
import { loadPublicListing, loadPublicSite, loadPublicSiteDomain } from "@/db/public-queries";
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
