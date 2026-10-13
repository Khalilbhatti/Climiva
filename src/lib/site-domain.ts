/**
 * Where a Site's pages are, as addresses inside this application.
 *
 * A custom domain is NOT handled here: a claim on a hostname, its normalization and its states are in lib/hostname and lib/domain-rules.
 * Pure: no database, no network.
 */
import type { AppHref } from "@/config/routes";

/** Where a published site is served on the platform: its platform address as a path on this application. (On a customer's own domain its pages are at the root of the host.) */
export const publicSiteHref = (platformSlug: string, path = ""): AppHref => `/sites/${platformSlug}${path === "/" ? "" : path}` as AppHref;

/** Where a published Marketplace listing is served: its public address under /listings. */
export const publicListingHref = (publicSlug: string): AppHref => `/listings/${publicSlug}` as AppHref;

/**
 * The address a page of a site calls itself, for its metadata: on the site's main ACTIVE custom domain, or null when it has none.
 * `scheme` is `https` in production (a domain is served over TLS) and may be `http` in development; `path` is "" for the home page.
 */
export function canonicalUrl(canonicalHost: string | null, scheme: "http" | "https", path: string): string | null {
  if (!canonicalHost) return null;
  const clean = path === "" || path === "/" ? "" : `/${path.replace(/^\/+/, "")}`;
  return `${scheme}://${canonicalHost}${clean}`;
}
