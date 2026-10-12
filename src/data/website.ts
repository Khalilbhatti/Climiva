/**
 * The Website module's types, labels and pure helpers.
 *
 * The Website itself is DATA in PostgreSQL, per organization:
 *
 *     Organization -> many Sites -> many Site Versions (one Draft, any number of immutable Published snapshots)
 *                                      -> many Pages -> many Sections
 *
 * Nothing authored is in this file: the pages, their sections and their copy are rows (`site_pages`, `site_sections`), seeded from the
 * application's default template (a row of `site_templates`) and read back for the verified business only. What is here is the SHAPE the
 * browser holds (a version with its pages and sections), the rules that compare a Draft with what is Published, and the helpers that
 * work out a page's address and which Services a version shows.
 *
 * Business identity (name, phone, email, address, hours) and the Services are never part of a version: a page is drawn from its
 * sections plus the organization's current record and the business's public Services (see docs/saas-architecture.md, section 28).
 *
 * Fixtures: none. The approved Apex Climate Heating & Air site is seed data (scripts/db/seed-data/website.ts).
 */
import type { Props, SectionType } from "@/lib/site-sections";
import type { SiteTheme } from "@/lib/site-theme";
import { getPublicActiveServices, type Service } from "./services";

/* ───────────────────────── pages, sections, versions ───────────────────────── */

export const PAGE_TYPES = ["home", "services", "content", "contact", "booking"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** The stable internal key of a page ("home", "services", "about", "contact", "booking"): its identity, not its title or its address. */
export type PageKey = string;

/** Which Services the site shows, and in what order. The Services themselves are never copied. */
export type ServiceDisplay = { order: readonly string[]; hidden: readonly string[] };
export type VersionSettings = { serviceDisplay: ServiceDisplay };

export const EMPTY_SERVICE_DISPLAY: ServiceDisplay = { order: [], hidden: [] };

export type SectionModel = {
  id: string;
  /** Stable within its page ("hero", "bookingCta"): how the editor and a comparison name a section. */
  key: string;
  label: string;
  type: SectionType;
  variant: string;
  props: Props;
  visible: boolean;
  sortOrder: number;
};

export type PageModel = {
  id: string;
  key: PageKey;
  title: string;
  /** The page's address segment; "" for the home page (the site's root). */
  slug: string;
  type: PageType;
  visible: boolean;
  sortOrder: number;
  sections: SectionModel[];
};

export type VersionStatus = "draft" | "published";

export type VersionModel = {
  id: string;
  /** Null for the Draft; a Published version has the number it was given when it was published (1, 2, 3 ...). */
  number: number | null;
  status: VersionStatus;
  templateKey: string | null;
  theme: SiteTheme;
  settings: VersionSettings;
  publishedAt: string | null;
  pages: PageModel[];
};

/* ───────────────────────── addresses and domains ───────────────────────── */

/** The domain every Site's platform address lives under: `<platform-slug>.climvia.com`. Nothing resolves it yet (see section 28). */
export const PLATFORM_DOMAIN = "climvia.com";
export const platformHost = (platformSlug: string) => `${platformSlug}.${PLATFORM_DOMAIN}`;

export type CustomDomainStatus = "configured" | "pending_verification" | "verified";

export const CUSTOM_DOMAIN_STATUS_LABEL: Record<CustomDomainStatus, string> = {
  configured: "Configured",
  pending_verification: "Pending verification",
  // Nothing sets this yet: verifying a domain belongs to the domain-routing phase.
  verified: "Verified",
};

export type DomainState = {
  /** The custom domain recorded for the site, if any. It is a RECORD: nothing verifies it or routes to it yet. */
  custom?: string;
  customStatus?: CustomDomainStatus;
  /** Which address is the main one. The Climvia address can't be removed. */
  primary: "climvia" | "custom";
};

export type SiteIdentity = {
  id: string;
  name: string;
  /** The public identity of the site: globally unique, the same in `/sites/<platformSlug>` and `<platformSlug>.climvia.com`. */
  platformSlug: string;
};

/** What the browser holds for the business's primary Site (the one the Website module edits). */
export type WebsiteState = {
  site: SiteIdentity;
  /** Whether visitors can open the site: it has a published version. */
  published: boolean;
  draft: VersionModel;
  /** The published snapshot visitors see, or null while the site is private. */
  live: VersionModel | null;
  domain: DomainState;
};

export const getPrimaryDomain = (site: SiteIdentity, domain: DomainState) => (domain.primary === "custom" && domain.custom ? domain.custom : platformHost(site.platformSlug));

/** The site's pages in the order they are shown. */
export const orderedPages = (version: VersionModel): PageModel[] => [...version.pages].sort((a, b) => a.sortOrder - b.sortOrder);

export const pagePath = (page: Pick<PageModel, "slug">): string => (page.slug === "" ? "/" : `/${page.slug}`);

export const findPage = (version: VersionModel, key: string): PageModel | undefined => version.pages.find((page) => page.key === key);

export const orderedSections = (page: PageModel): SectionModel[] => [...page.sections].sort((a, b) => a.sortOrder - b.sortOrder);

/** True when a page lists Services (a service section is on it), so a change to which Services are shown changes the page. */
export const showsServices = (page: PageModel): boolean => page.sections.some((section) => section.type === "service_list");

/* ───────────────────────── Services shown ───────────────────────── */

/** The services the site shows: public and active in the business's catalog, minus the hidden ones, in site order. */
export function getShownServices(display: ServiceDisplay, services: readonly Service[]): Service[] {
  const catalog = getPublicActiveServices(services);
  const rank = (id: string) => {
    const index = display.order.indexOf(id);
    return index === -1 ? display.order.length : index;
  };
  return catalog
    .filter((service) => !display.hidden.includes(service.id))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.displayOrder - b.displayOrder);
}

/* ───────────────────────── Draft against Published ───────────────────────── */

const canonicalSection = (section: SectionModel) => ({ k: section.key, l: section.label, t: section.type, v: section.variant, p: section.props, on: section.visible, o: section.sortOrder });
const canonicalPage = (page: PageModel) => ({
  k: page.key,
  title: page.title,
  slug: page.slug,
  type: page.type,
  on: page.visible,
  o: page.sortOrder,
  s: orderedSections(page).map(canonicalSection),
});

/** What a version SAYS, without ids or timestamps: two versions with the same content compare equal. */
export const canonicalContent = (version: VersionModel) => JSON.stringify({ theme: version.theme, settings: version.settings, pages: orderedPages(version).map(canonicalPage) });

export const canonicalPageContent = (page: PageModel | undefined) => JSON.stringify(page ? canonicalPage(page) : null);

export type PageStatus = "published" | "unpublished-changes" | "private";

export const PAGE_STATUS_LABEL: Record<PageStatus, string> = {
  published: "Published",
  "unpublished-changes": "Saved · unpublished changes",
  private: "Private",
};

export function getPageStatus(state: WebsiteState, key: PageKey): PageStatus {
  if (!state.published || !state.live) return "private";
  const draft = findPage(state.draft, key);
  const live = findPage(state.live, key);
  const servicesChanged = draft !== undefined && showsServices(draft) && JSON.stringify(state.draft.settings.serviceDisplay) !== JSON.stringify(state.live.settings.serviceDisplay);
  return !servicesChanged && canonicalPageContent(draft) === canonicalPageContent(live) ? "published" : "unpublished-changes";
}

export const hasUnpublishedChanges = (state: WebsiteState): boolean => !state.live || canonicalContent(state.draft) !== canonicalContent(state.live);
