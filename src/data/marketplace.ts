/**
 * Marketplace: how the business appears in the Climvia directory.
 *
 * The listing owns only listing-specific configuration: its description, a cover treatment, which eligible Services
 * are shown and in what order, which contact details are visible, which customer actions are offered, and whether
 * the listing is published or hidden. It owns no copy of anything else. Business name, phone, email, address and
 * hours come from the Business fixture (data/fixtures), the website address from the Website's primary domain, and
 * every Service's name, description, price, duration and booking method from the Services catalog.
 *
 * Exactly five of the six canonical public Services are shown at the baseline. Emergency No-Heat / No-Cool Service
 * is "Not selected": it is not deleted or deactivated, only left off this listing. Maintenance plan coverage
 * ("Cooling maintenance", "Heating maintenance") is not a Service and is never offered here.
 *
 * Sources: design-reference/stitch/ marketplace_*, edit_marketplace_listing_*, set_up_marketplace_listing_first_time.
 * Conflicts are listed in docs/stitch-screen-map.md §11.
 *
 * Fixtures are read-only. Demo edits live in components/marketplace/MarketplaceProvider and reset on reload.
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

export type ListingConfig = {
  description: string;
  cover?: CoverId;
  /** Every eligible Service id, once, in the order the listing shows them. */
  order: readonly string[];
  /** The Services the listing shows. */
  selected: readonly string[];
  contact: Record<ContactField, boolean>;
  actions: Record<ListingAction, boolean>;
};

export type MarketplaceState = { status: ListingStatus; config: ListingConfig };

/** The one eligible Service the baseline listing leaves off. */
export const BASELINE_EXCLUDED_SERVICE_ID = "emergency-no-heat-no-cool";

/** Services a listing can show: the public, active ones in the catalog. */
export const getEligibleServices = (): Service[] => getPublicActiveServices();

export function defaultListingConfig(): ListingConfig {
  const eligible = getEligibleServices();
  return {
    description: DEFAULT_DESCRIPTION,
    cover: "teal-horizon",
    order: eligible.map((service) => service.id),
    selected: eligible.filter((service) => service.id !== BASELINE_EXCLUDED_SERVICE_ID).map((service) => service.id),
    contact: { phone: true, email: true, address: true, hours: true, website: true },
    actions: { book: true, website: true, contact: true },
  };
}

/** The approved baseline: a published listing showing five of the six eligible Services. */
export function initialMarketplaceState(): MarketplaceState {
  return { status: "published", config: defaultListingConfig() };
}

/** The Services the listing shows, in listing order. Catalog data is read, never copied. */
export function getListingServices(config: ListingConfig): Service[] {
  const eligible = getEligibleServices();
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
export function getOrderedEligibleServices(config: ListingConfig): Service[] {
  const eligible = getEligibleServices();
  const rank = (id: string) => {
    const index = config.order.indexOf(id);
    return index === -1 ? config.order.length : index;
  };
  return [...eligible].sort((a, b) => rank(a.id) - rank(b.id) || a.displayOrder - b.displayOrder);
}

export const isServiceSelected = (config: ListingConfig, serviceId: string) => config.selected.includes(serviceId);

export const isAnyContactShown = (config: ListingConfig) => Object.values(config.contact).some(Boolean);

export const sameConfig = (a: ListingConfig, b: ListingConfig) => JSON.stringify(a) === JSON.stringify(b);
