/**
 * What a visitor to a published site or listing is given: the types of the PUBLIC projections.
 *
 * A visitor has no session and no organization. The server resolves a site's (or a listing's) public identity to the business that owns it
 * and hands the page ONLY these shapes: the published version's visible pages and sections, the business's public contact details and hours,
 * and its active, non-internal Services. There is nothing here about customers, jobs, money, the team, analytics, unpublished drafts or
 * another business. The shapes are built field by field by SQL functions (migration 0013) and parsed again in src/db/public-queries.
 */
import type { BusinessInfo, WeeklyHours } from "./settings";
import type { DateFormatId, TimeFormatId } from "@/lib/display-preferences";
import type { Service } from "./services";
import type { SectionModel, SiteIdentity, VersionSettings } from "./website";
import type { PageType } from "./website";
import type { SiteTheme } from "@/lib/site-theme";

/** What a request's Host resolves to: the public identity of the site (read through the same visit as any other) and the name its pages call themselves. */
export type PublicHost = { platformSlug: string; canonicalHost: string };

export type PublicNavPage = { key: string; title: string; slug: string; type: PageType; sortOrder: number };

export type PublicPage = { key: string; title: string; slug: string; type: PageType; sections: SectionModel[] };

export type PublicSite = {
  site: SiteIdentity;
  business: BusinessInfo;
  /** The business's logo, as an address on this site (built from an Asset id; no storage detail), or null: its initials are drawn instead. */
  logo: { src: string } | null;
  preferences: { timeZone: string; dateFormat: DateFormatId; timeFormat: TimeFormatId };
  hours: WeeklyHours;
  /** The sample business keeps the product's fixed day (its records are dated around it); every other business is at the real time. */
  fixedClock: boolean;
  version: { number: number; theme: SiteTheme; settings: VersionSettings; publishedAt: string };
  /** Every visible page of the published version, in order: the navigation. */
  nav: PublicNavPage[];
  /** The page at the requested address, or null when the site has no visible page there. */
  page: PublicPage | null;
  /** The business's active, non-internal Services (a Service's internal notes and checklist are never part of this). */
  services: Service[];
};

export type PublicListingContact = { phone: boolean; email: boolean; address: boolean; hours: boolean; website: boolean };
export type PublicListingActions = { book: boolean; website: boolean; contact: boolean };

export type PublicListingData = {
  slug: string;
  description: string;
  cover: "teal-horizon" | "warm-linen" | "cool-slate" | null;
  contact: PublicListingContact;
  actions: PublicListingActions;
  /** Only what the listing shows: a detail the business turned off is an empty string here, not just hidden. */
  business: BusinessInfo;
  /** The business's logo, as for a site. */
  logo: { src: string } | null;
  hours: WeeklyHours;
  timeFormat: TimeFormatId;
  /** The business's primary site, only while it is published: where "Book service", "View website" and "Contact business" lead. */
  siteSlug: string | null;
  /** That site's visible pages (address and kind), so the actions can lead to its Booking and Contact pages. */
  sitePages: PublicNavPage[];
  services: Service[];
};
