/**
 * Domain names for a Site: what a custom domain may look like, and how a site's addresses are chosen.
 *
 * A domain here is a RECORD of an address the business wants to use. Nothing is looked up, verified or routed: there is no DNS, no
 * certificate and no host-based routing yet (that is a later phase), and a recorded domain is therefore never described as live.
 * Pure: no database, no network.
 */
import type { AppHref } from "@/config/routes";
import { PLATFORM_DOMAIN } from "@/data/website";

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** A hostname that looks like a domain name and is not one of Climvia's own; nothing is looked up. */
export function normalizeDomain(input: string): string | undefined {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  if (!HOST.test(host)) return undefined;
  if (host === PLATFORM_DOMAIN || host.endsWith(`.${PLATFORM_DOMAIN}`)) return undefined;
  return host;
}

export const DOMAIN_PROBLEM = "Enter a domain name like www.yourbusiness.com.";

/** Where a published site is served until domain routing exists: the platform address as a path on this application. */
export const publicSiteHref = (platformSlug: string, path = ""): AppHref => `/sites/${platformSlug}${path === "/" ? "" : path}` as AppHref;

/** Where a published Marketplace listing is served: its public address under /listings. */
export const publicListingHref = (publicSlug: string): AppHref => `/listings/${publicSlug}` as AppHref;

