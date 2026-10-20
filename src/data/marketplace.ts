/**
 * Marketplace: how the business appears in the Climvia directory. Types, labels and pure helpers.
 *
 * The listing is DATA in PostgreSQL, per organization (`marketplace_listings`, `marketplace_listing_services`). It owns only
 * listing-specific configuration: its description, a cover treatment, which eligible Services are shown and in what order, which contact
 * details are visible, which customer actions are offered, and whether the listing is published or hidden. It owns no copy of anything
 * else. Business name, phone, email, address and hours come from the organization, the website address from the business's primary site,
 * and every Service's name, description, price, duration and booking method from the Services catalog.
 *
 * A business that has not set a listing up has none (status "not-set-up"). The approved Apex Climate Heating & Air listing, which shows
 * five of its six Services and leaves Emergency No-Heat / No-Cool Service off, is seed data (scripts/db/seed-data/website.ts).
 * Maintenance plan coverage ("Cooling maintenance", "Heating maintenance") is not a Service and is never offered here.
 */
import { getPublicActiveServices, type Service } from "./services";

export type ListingStatus = "not-set-up" | "published" | "hidden";

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  "not-set-up": "Not published",
  published: "Published",
  hidden: "Hidden",
};

export const DESCRIPTION_MAX = 300;
export const DEFAULT_DESCRIPTION =
  "HVAC maintenance, diagnostics, repair, and installation services for residential and commercial customers.";

/** Cover treatments are drawn in CSS: there is no image upload, so a cover is a reference to one of these. */
export type CoverId = "teal-horizon" | "warm-linen" | "cool-slate";
export const COVERS: readonly { id: CoverId; label: string; description: string }[] = [
  { id: "teal-horizon", label: "Teal horizon", description: "Deep teal with a soft light edge" },
  { id: "warm-linen", label: "Warm linen", description: "Warm neutral with a teal accent" },
  { id: "cool-slate", label: "Cool slate", description: "Cool grey-blue with a teal accent" },
];

export type ContactField = "phone" | "email" | "address" | "hours" | "website";
export const CONTACT_FIELDS: readonly { id: ContactField; label: string; toggle: string }[] = [
  { id: "phone", label: "Phone", toggle: "Show phone" },
  { id: "email", label: "Email", toggle: "Show email" },
  { id: "address", label: "Address", toggle: "Show address" },
  { id: "hours", label: "Business hours", toggle: "Show business hours" },
  { id: "website", label: "Website", toggle: "Show website" },
];

export type ListingAction = "book" | "website" | "contact";
export const LISTING_ACTIONS: readonly { id: ListingAction; label: string; toggle: string; detail: string }[] = [
  { id: "book", label: "Book service", toggle: 'Show "Book service"', detail: "Opens your Booking page, where customers choose a Service." },
  { id: "website", label: "View website", toggle: 'Show "View website"', detail: "Sends customers to your primary business website." },
  { id: "contact", label: "Contact business", toggle: 'Show "Contact business"', detail: "Opens the contact form on your website." },
];

/**
 * A place a business serves: ONE of a city (with its state) or a ZIP code, and an optional label ("South Austin"). Only what a business lists here is
 * ever claimed as coverage; its headquarters address is not. See lib/marketplace-discovery for how areas are read, checked and matched.
 */
export type ServiceArea = {
  city: string | null;
  state: string | null;
  postal: string | null;
  label: string | null;
};

export type ListingConfig = {
  description: string;
  cover?: CoverId;
  /** Every eligible Service id, once, in the order the listing shows them. */
  order: readonly string[];
  /** The Services the listing shows. */
  selected: readonly string[];
  contact: Record<ContactField, boolean>;
  actions: Record<ListingAction, boolean>;
  /** Where the business works, in the order it gave them. None is allowed: the listing is then found by Service and name, but by no place. */
  areas: readonly ServiceArea[];
};

/** Where the business's request for a second look at a suspension stands. */
export type SuspensionReviewState = "none" | "requested" | "resolved";

/**
 * What the business is told about a suspension, and nothing more. `message` is what the platform wrote FOR the business (a different field from the
 * internal reason, which is never sent to any page). `review` is the business's own request to have the suspension looked at again: asking changes nothing
 * about whether the listing is public, and only the platform lifts a suspension. Times are the business's local wall clock, "2024-10-25T10:45".
 */
export type ListingSuspension = {
  message: string | null;
  suspendedAt: string | null;
  review: {
    state: SuspensionReviewState;
    requestedAt: string | null;
    /** What the business wrote when it asked. */
    note: string | null;
    resolvedAt: string | null;
    /** `kept`: the platform looked and the suspension stays. */
    outcome: "kept" | "lifted" | null;
  };
};

export type MarketplaceState = {
  status: ListingStatus;
  /**
   * True when the platform has suspended the listing. It then cannot be found by the public, whatever `status` says, until the suspension is lifted.
   * The reason is never part of this: the business is told THAT, and what the platform chose to say to it (`suspension.message`), not why internally.
   */
  suspended: boolean;
  /** Present exactly when `suspended` is true. */
  suspension: ListingSuspension | null;
  config: ListingConfig;
  /** The listing's public identity (`/listings/<slug>`), once it has been set up. */
  slug?: string;
};

/** Services a listing can show: the public, active ones in the business's catalog. */
export const getEligibleServices = (services: readonly Service[]): Service[] => getPublicActiveServices(services);

/** What the first-time setup starts from: every eligible Service selected, every detail and action on. */
export function defaultListingConfig(services: readonly Service[]): ListingConfig {
  const eligible = getEligibleServices(services);
  return {
    description: DEFAULT_DESCRIPTION,
    cover: "teal-horizon",
    order: eligible.map((service) => service.id),
    selected: eligible.map((service) => service.id),
    contact: { phone: true, email: true, address: true, hours: true, website: true },
    actions: { book: true, website: true, contact: true },
    areas: [],
  };
}

/** A business with no listing: not set up, and the defaults the setup form starts from. */
export function emptyMarketplaceState(services: readonly Service[]): MarketplaceState {
  return { status: "not-set-up", suspended: false, suspension: null, config: defaultListingConfig(services) };
}

/** The Services the listing shows, in listing order. Catalog data is read, never copied. */
export function getListingServices(config: ListingConfig, services: readonly Service[]): Service[] {
  const eligible = getEligibleServices(services);
  const byId = new Map(eligible.map((service) => [service.id, service]));
  const rank = (id: string) => {
    const index = config.order.indexOf(id);
    return index === -1 ? config.order.length : index;
  };
  return config.selected
    .filter((id) => byId.has(id))
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => byId.get(id)!);
}

/** Every eligible Service in listing order, selected or not (for the editor's list). */
export function getOrderedEligibleServices(config: ListingConfig, services: readonly Service[]): Service[] {
  const eligible = getEligibleServices(services);
  const rank = (id: string) => {
    const index = config.order.indexOf(id);
    return index === -1 ? config.order.length : index;
  };
  return [...eligible].sort((a, b) => rank(a.id) - rank(b.id) || a.displayOrder - b.displayOrder);
}

export const isServiceSelected = (config: ListingConfig, serviceId: string) => config.selected.includes(serviceId);

export const isAnyContactShown = (config: ListingConfig) => Object.values(config.contact).some(Boolean);

/** A configuration with its selected Services in the listing's order: the order they were ticked in is not part of what is stored. */
const canonical = (config: ListingConfig): ListingConfig => {
  const rank = (id: string) => {
    const index = config.order.indexOf(id);
    return index === -1 ? config.order.length : index;
  };
  return { ...config, selected: [...config.selected].sort((a, b) => rank(a) - rank(b)) };
};

export const sameConfig = (a: ListingConfig, b: ListingConfig) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
