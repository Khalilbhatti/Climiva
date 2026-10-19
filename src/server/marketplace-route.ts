import "server-only";
import type { Metadata } from "next";
import { serviceNameOf, type DiscoveryMode } from "@/components/marketplace/discovery/DiscoveryPage";
import { plural } from "@/components/marketplace/discovery/Rating";
import { platformOrigin } from "@/lib/domain-config";
import { discoveryHref, locationLabel, type DiscoveryQuery } from "@/lib/marketplace-discovery";
import { getMarketplaceFacets, getMarketplaceResults } from "./public-site";

/**
 * What a search engine and a browser tab are told about a Marketplace page. It is drawn from the same two readers the page uses (so the head and
 * the body never disagree, and the database is asked once), and from nothing else.
 *
 * Which pages may be indexed: the Marketplace itself, and the clean Service / place / Service-in-place pages, when they list at least one
 * provider and are the first page. Everything else is `noindex`: a search with words or filters, a later page, a place that was not understood,
 * and a page with nobody on it. A page is "empty" because no discoverable provider matches, which is also what a suspended or unpublished provider
 * looks like, so a provider that is not discoverable can neither be indexed nor be the reason a page is.
 */
export async function discoveryMetadata(query: DiscoveryQuery, mode: DiscoveryMode): Promise<Metadata> {
  const [results, facets] = await Promise.all([getMarketplaceResults(query), getMarketplaceFacets(query)]);
  const serviceName = serviceNameOf(query, facets, results);
  const place = query.location ? locationLabel(query.location) : null;

  const subject =
    mode === "service" ? serviceName
    : mode === "location" ? `HVAC service in ${place}`
    : mode === "combination" ? `${serviceName} in ${place}`
    : query.q ? `Search for ${query.q}`
    : "Find HVAC service in your area";
  const title = `${subject} · Climvia Marketplace`;

  const narrowed = Boolean(query.q || query.booking || query.category || (mode === "index" && (query.service || query.location)));
  const unreadPlace = query.locationText !== "" && !query.location;
  const indexable = results.total > 0 && results.results.length > 0 && query.page === 1 && !narrowed && !unreadPlace;

  const cleanPath = discoveryHref({ service: query.service, location: query.location });
  const origin = platformOrigin();
  const description =
    results.total > 0
      ? mode === "index"
        ? `Compare ${plural(results.total, "HVAC provider")} on Climvia Marketplace by service, where they work and what their customers say.`
        : `Compare ${plural(results.total, "HVAC provider")} ${mode === "location" ? `that work in ${place}` : mode === "service" ? `that list ${serviceName}` : `that list ${serviceName} in ${place}`} on Climvia Marketplace.`
      : "Search HVAC providers on Climvia Marketplace by service and location.";

  return {
    title: { absolute: title },
    description,
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    ...(origin && indexable ? { alternates: { canonical: `${origin}${cleanPath}` } } : {}),
  };
}
