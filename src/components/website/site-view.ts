import type { AppHref } from "@/config/routes";
import type { Service } from "@/data/services";
import type { BusinessInfo } from "@/data/settings";
import type { PageType, ServiceDisplay } from "@/data/website";
import { fillTokens, locationOf, type Props } from "@/lib/site-sections";
import type { HoursRow } from "@/lib/settings-state";
import type { SiteTheme } from "@/lib/site-theme";

/**
 * Everything the website renderer needs to draw a page that is not the page's own sections: the business, its hours, its Services and how
 * the pages link to each other.
 *
 * One renderer draws the Draft inside the workspace (the editor's canvas, the Overview's picture, the signed-in preview) and the
 * Published site for a visitor. They differ only in WHERE the data came from (the workspace's providers, or the public projection) and
 * WHERE the links lead (`base`). The data is plain and serializable, so a server page can build it and hand it to the renderer.
 */
export type SiteView = {
  business: BusinessInfo;
  hours: readonly HoursRow[];
  /** The business's Services that may be shown publicly; a section shows the ones the version's settings choose. */
  services: readonly Service[];
  display: ServiceDisplay;
  theme: SiteTheme;
  /** Where this view's pages live: "/sites/apexclimate" for a visitor, "/website/preview" for the signed-in Draft preview. */
  base: string;
  /** The visible pages, in order: the navigation and the targets of links. */
  pages: readonly { key: string; title: string; slug: string; type: PageType }[];
  /** True on the published site, seen by a real visitor; false for the Draft inside the workspace (a picture of the finished product). */
  visitor: boolean;
};

export const pageHrefIn = (view: Pick<SiteView, "base" | "pages">, key: string): AppHref => {
  const page = view.pages.find((candidate) => candidate.key === key);
  return (page && page.slug !== "" ? `${view.base}/${page.slug}` : view.base) as AppHref;
};

/** The page of a kind ("booking", "services"), if the site has a visible one. */
export const pageOfType = (view: Pick<SiteView, "pages">, type: PageType) => view.pages.find((page) => page.type === type);

export const typeHrefIn = (view: Pick<SiteView, "base" | "pages">, type: PageType): AppHref | undefined => {
  const page = pageOfType(view, type);
  return page ? pageHrefIn(view, page.key) : undefined;
};

/** The booking journey of one Service: under the Booking page. Undefined when the site has no visible Booking page. */
export const bookingHrefIn = (view: Pick<SiteView, "base" | "pages">, serviceSlug: string): AppHref | undefined => {
  const booking = typeHrefIn(view, "booking");
  return booking ? (`${booking}/${serviceSlug}` as AppHref) : undefined;
};

/** A section's authored text with the business's name and place filled in. */
export function fillProps(props: Props, business: BusinessInfo): Props {
  const values = { name: business.name, location: locationOf(business.address) };
  return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, fillTokens(value, values)]));
}
