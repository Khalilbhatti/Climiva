/**
 * Seed data for the Website and the Marketplace: the approved Apex Climate Heating & Air site and listing, and a small, different site and
 * listing for Northstar. Local tooling only: nothing here ships in the app, and nothing under src/ imports it.
 *
 * Apex. The approved website is the application's default template (src/db/default-template.ts) with one piece of authored copy that
 * names the business in a short form ("Why customers choose Apex Climate"): everything else says the business's name and place through
 * the two text tokens, so it reads word for word as it did before it was stored. The site is published (version 1 is exactly the draft),
 * has its custom domain recorded, and the business has a second, private site so the "an organization owns many sites" rule is real data.
 * The approved listing is published and shows five of the six Services; Emergency No-Heat / No-Cool Service is not selected.
 *
 * Northstar. A smaller, deliberately different site (its own copy and colour, a hidden section) and a listing with two Services, so a
 * mix-up between the businesses is visible on screen.
 */
import { DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_KEY } from "../../../src/db/default-template";
import type { SeedListing } from "../../../src/db/marketplace-queries";
import type { SeedSite } from "../../../src/db/site-queries";
import { DEFAULT_DESCRIPTION } from "../../../src/data/marketplace";
import { getPublicActiveServices } from "../../../src/data/services";
import type { Props } from "../../../src/lib/site-sections";
import type { SiteContent } from "../../../src/lib/site-template";
import { SERVICES } from "./services";

/** A copy of the content with some sections' text replaced (and, optionally, hidden). */
function authored(
  base: SiteContent,
  edits: { theme?: Partial<SiteContent["theme"]>; props?: Record<string, Props>; hidden?: readonly string[] },
): SiteContent {
  return {
    theme: { ...base.theme, ...edits.theme },
    settings: { serviceDisplay: { order: [...base.settings.serviceDisplay.order], hidden: [...base.settings.serviceDisplay.hidden] } },
    pages: base.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => {
        const path = `${page.key}.${section.key}`;
        return { ...section, props: { ...section.props, ...edits.props?.[path] }, visible: edits.hidden?.includes(path) ? false : section.visible };
      }),
    })),
  };
}

const TEMPLATE: SiteContent = { theme: DEFAULT_TEMPLATE.theme, settings: DEFAULT_TEMPLATE.settings, pages: DEFAULT_TEMPLATE.pages };

/** The approved Apex website. */
export const APEX_CONTENT: SiteContent = authored(TEMPLATE, { props: { "home.why": { heading: "Why customers choose Apex Climate" } } });

export const APEX_SITES: SeedSite[] = [
  {
    name: "Apex Climate Heating & Air",
    slug: "main",
    platformSlug: "apexclimate",
    isPrimary: true,
    template: DEFAULT_TEMPLATE_KEY,
    draft: APEX_CONTENT,
    published: [APEX_CONTENT],
  },
  {
    name: "Apex Climate Heating & Air Commercial",
    slug: "commercial",
    platformSlug: "apexclimate-commercial",
    isPrimary: false,
    template: DEFAULT_TEMPLATE_KEY,
    draft: TEMPLATE,
    published: [],
  },
];

/** Five of the six public Services, in the order the listing shows them: Emergency No-Heat / No-Cool is not selected. */
const APEX_LISTED = getPublicActiveServices(SERVICES)
  .filter((service) => service.id !== "emergency-no-heat-no-cool")
  .map((service) => service.id);

export const APEX_LISTING: SeedListing = {
  status: "published",
  config: {
    description: DEFAULT_DESCRIPTION,
    cover: "teal-horizon",
    order: APEX_LISTED,
    selected: APEX_LISTED,
    contact: { phone: true, email: true, address: true, hours: true, website: true },
    actions: { book: true, website: true, contact: true },
    // Where Apex works: the city of its headquarters, two ZIP codes it names (one is the headquarters' own, one is labelled), and a neighbouring city.
    areas: [
      { city: "Austin", state: "TX", postal: null, label: null },
      { city: null, state: null, postal: "78704", label: "South Austin" },
      { city: null, state: null, postal: "78741", label: null },
      { city: "Round Rock", state: "TX", postal: null, label: null },
    ],
  },
};

/** Northstar's own website: different words, a different colour, and the hours card switched off on the home page. */
export const NORTHSTAR_CONTENT: SiteContent = authored(TEMPLATE, {
  theme: { accent: "#1F5FAF" },
  props: {
    "home.hero": {
      headline: "Denver's heating and cooling crew.",
      supportingText: "Book furnace tune-ups and cooling visits with {{business.name}}.",
      primaryCta: "Book a visit",
      secondaryCta: "See what we do",
    },
    "about.business": { body: "{{business.name}} keeps homes in {{business.location}} comfortable through every season." },
  },
  hidden: ["home.hours"],
});

export const NORTHSTAR_SITES: SeedSite[] = [
  {
    name: "Northstar Heating & Cooling",
    slug: "main",
    platformSlug: "northstar",
    isPrimary: true,
    template: DEFAULT_TEMPLATE_KEY,
    draft: NORTHSTAR_CONTENT,
    published: [NORTHSTAR_CONTENT],
  },
];

export const NORTHSTAR_LISTING: SeedListing = {
  status: "published",
  config: {
    description: "Furnace tune-ups, cooling diagnostics and radiant heat estimates across the Denver metro.",
    cover: "cool-slate",
    order: ["furnace-tune-up", "ac-repair-diagnostics", "radiant-heat-estimate"],
    selected: ["furnace-tune-up", "ac-repair-diagnostics"],
    contact: { phone: true, email: true, address: true, hours: false, website: true },
    actions: { book: true, website: true, contact: false },
    areas: [
      { city: "Denver", state: "CO", postal: null, label: null },
      { city: "Aurora", state: "CO", postal: null, label: null },
      { city: "Lakewood", state: "CO", postal: null, label: null },
    ],
  },
};

export type WebsiteSeed = { sites: readonly SeedSite[]; listing?: SeedListing };

export const APEX_WEBSITE: WebsiteSeed = { sites: APEX_SITES, listing: APEX_LISTING };
export const NORTHSTAR_WEBSITE: WebsiteSeed = { sites: NORTHSTAR_SITES, listing: NORTHSTAR_LISTING };
