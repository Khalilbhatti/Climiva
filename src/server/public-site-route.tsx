import "server-only";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PROTOTYPE_NOW } from "@/lib/prototype-clock";
import { getShownServices } from "@/data/website";
import { PublicBooking } from "@/components/website/public/PublicBooking";
import { SiteFooter, SiteHeader, SiteRenderer } from "@/components/website/SiteRenderer";
import { homeHrefIn, pageHrefIn } from "@/components/website/site-view";
import type { PublicHost } from "@/data/public-site";
import { canonicalScheme } from "@/lib/domain-config";
import { canonicalUrl } from "@/lib/site-domain";
import { businessClock } from "@/lib/business-time";
import { themeAttributes, themeStyle } from "@/lib/site-theme";
import { getPublicSite, getPublicSiteDomain, publicViewOf } from "./public-site";

/**
 * A PUBLISHED website page, for anyone. There is no session and no workspace here: the address names a site (its public identity), the
 * server finds the business that owns it, and the page is drawn from that site's published version only: its visible pages and sections,
 * the business's public contact details and hours, and its active public Services. A draft, a hidden page, a private site and a site
 * that does not exist are all the same "not found".
 *
 * The route files under src/app/(public)/sites call these two functions: the home page and every other page share them. So does the one route
 * a customer's own domain is rewritten to (src/app/(public)/custom-site): a custom domain is another way to ARRIVE at the same renderer, not
 * a second renderer. Only `base` (where the links lead) and the canonical address differ.
 */

const NOT_FOUND: Metadata = { title: { absolute: "Page not found" }, robots: { index: false } };

/**
 * `custom` is the host a customer's own domain resolved to. A page calls itself by the site's main active custom domain when it has one
 * (the one it was reached on, otherwise), and a page opened through the platform address says so too; with no active custom domain nothing
 * is claimed. The scheme is https unless the deployment says otherwise (CUSTOM_DOMAIN_URL_SCHEME), and no redirect is made.
 */
export async function publicSiteMetadata(siteSlug: string, segments: string[], custom?: PublicHost): Promise<Metadata> {
  const site = await getPublicSite(siteSlug, segments[0] ?? "");
  if (!site?.page) return NOT_FOUND;
  const canonical = canonicalUrl(custom ? custom.canonicalHost : await getPublicSiteDomain(siteSlug), canonicalScheme(), segments.join("/"));
  return {
    title: { absolute: `${site.page.title} · ${site.business.name}` },
    description: `${site.business.name}: ${site.page.title}.`,
    ...(canonical ? { alternates: { canonical } } : {}),
  };
}

export async function PublicSiteRoute({ siteSlug, segments, base }: { siteSlug: string; segments: string[]; base?: string }) {
  const site = await getPublicSite(siteSlug, segments[0] ?? "");
  if (!site?.page) notFound();
  // Asked for here as well as by the metadata, so the two are ready together and the page's head is the same every time it is drawn.
  if (base === undefined) await getPublicSiteDomain(siteSlug);
  const { page } = site;
  // A page has no sub-addresses, except the Booking page: one Service's booking journey.
  if (segments.length > 2 || (segments.length === 2 && page.type !== "booking")) notFound();

  const view = publicViewOf(site, base);
  const content =
    segments.length === 2 ? (
      <PublicBooking
        siteSlug={site.site.platformSlug}
        view={view}
        service={getShownServices(site.version.settings.serviceDisplay, site.services).find((candidate) => candidate.id === segments[1])}
        hours={site.hours}
        today={businessClock(site.fixedClock, site.preferences.timeZone, PROTOTYPE_NOW).today}
        bookingHref={pageHrefIn(view, page.key)}
        homeHref={homeHrefIn(view)}
      />
    ) : (
      <SiteRenderer page={{ id: page.key, key: page.key, title: page.title, slug: page.slug, type: page.type, visible: true, sortOrder: 0, sections: page.sections }} view={view} />
    );

  return (
    <div data-testid="site-frame" {...themeAttributes(site.version.theme)} style={themeStyle(site.version.theme)} className="@container min-h-dvh bg-surface">
      <SiteHeader view={view} />
      <main>{content}</main>
      <SiteFooter view={view} />
    </div>
  );
}
