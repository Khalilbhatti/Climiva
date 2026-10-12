import "server-only";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { AppHref } from "@/config/routes";
import { PROTOTYPE_NOW } from "@/data/fixtures";
import { getShownServices } from "@/data/website";
import { PublicBooking } from "@/components/website/public/PublicBooking";
import { SiteFooter, SiteHeader, SiteRenderer } from "@/components/website/SiteRenderer";
import { pageHrefIn } from "@/components/website/site-view";
import { businessClock } from "@/lib/business-time";
import { themeAttributes, themeStyle } from "@/lib/site-theme";
import { getPublicSite, publicViewOf } from "./public-site";

/**
 * A PUBLISHED website page, for anyone. There is no session and no workspace here: the address names a site (its public identity), the
 * server finds the business that owns it, and the page is drawn from that site's published version only: its visible pages and sections,
 * the business's public contact details and hours, and its active public Services. A draft, a hidden page, a private site and a site
 * that does not exist are all the same "not found".
 *
 * The route files under src/app/(public)/sites call these two functions: the home page and every other page share them.
 */

const NOT_FOUND: Metadata = { title: { absolute: "Page not found" }, robots: { index: false } };

export async function publicSiteMetadata(siteSlug: string, segments: string[]): Promise<Metadata> {
  const site = await getPublicSite(siteSlug, segments[0] ?? "");
  if (!site?.page) return NOT_FOUND;
  return { title: { absolute: `${site.page.title} · ${site.business.name}` }, description: `${site.business.name}: ${site.page.title}.` };
}

export async function PublicSiteRoute({ siteSlug, segments }: { siteSlug: string; segments: string[] }) {
  const site = await getPublicSite(siteSlug, segments[0] ?? "");
  if (!site?.page) notFound();
  const { page } = site;
  // A page has no sub-addresses, except the Booking page: one Service's booking journey.
  if (segments.length > 2 || (segments.length === 2 && page.type !== "booking")) notFound();

  const view = publicViewOf(site);
  const content =
    segments.length === 2 ? (
      <PublicBooking
        siteSlug={site.site.platformSlug}
        view={view}
        service={getShownServices(site.version.settings.serviceDisplay, site.services).find((candidate) => candidate.id === segments[1])}
        hours={site.hours}
        today={businessClock(site.fixedClock, site.preferences.timeZone, PROTOTYPE_NOW).today}
        bookingHref={pageHrefIn(view, page.key)}
        homeHref={view.base as AppHref}
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
