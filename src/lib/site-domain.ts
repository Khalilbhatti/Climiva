/**
 * Where a Site's pages are, as addresses inside this application.
 *
 * A custom domain is NOT handled here: a claim on a hostname, its normalization and its states are in lib/hostname and lib/domain-rules.
 * Pure: no database, no network.
 */
import type { AppHref } from "@/config/routes";

/** Where a published site is served on the platform: its platform address as a path on this application. (On a customer's own domain its pages are at the root of the host.) */
export const publicSiteHref = (platformSlug: string, path = ""): AppHref => `/sites/${platformSlug}${path === "/" ? "" : path}` as AppHref;

/**
 * What the screens need to write a Site's address in full: the platform's own origin (scheme, host and port from BETTER_AUTH_URL, or null when it is not
 * configured) and the scheme a custom domain is served with. It comes from the environment on the server (lib/domain-config `siteAddressing`) and
 * nowhere else, so no name of a deployment is written in the application.
 */
export type SiteAddressing = { origin: string | null; customScheme: "http" | "https" };

/** What a screen without an environment (a test of the pure rules) gets: addresses are written as paths on whatever origin the visitor is on. */
export const NO_ADDRESSING: SiteAddressing = { origin: null, customScheme: "https" };

/**
 * A Site's address on the platform, written in full: the platform's origin, then `/sites/<platform slug>`. This is the address every Site has, on one
 * configured host, and it needs no wildcard name or certificate. A custom domain is added to it, never in its place.
 */
export const platformSiteUrl = (platformSlug: string, addressing: SiteAddressing = NO_ADDRESSING, path = ""): string =>
  `${addressing.origin ?? ""}${publicSiteHref(platformSlug, path)}`;

/** A Site's address on a custom domain of its own, written in full (its pages are at the root of that host). */
export const customSiteUrl = (hostname: string, addressing: SiteAddressing = NO_ADDRESSING, path = ""): string =>
  `${addressing.customScheme}://${hostname}${path === "/" ? "" : path}`;

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
