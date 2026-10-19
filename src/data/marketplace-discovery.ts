/**
 * What the public Marketplace is given: the types of the PUBLIC discovery projections.
 *
 * A visitor to the Marketplace has no session and no organization. The pages are drawn only from these shapes, which the SQL functions
 * (migration 0025) build field by field and src/db/public-queries parses again: a provider's public name and description, its logo, its public
 * rating, the Service a search matched, the places it works. There is no organization id, no contact detail, no moderation state and no reviewer
 * name beyond a first name and last initial in anything here.
 */
import type { BookingMethod, ServicePricing, ServiceCategory } from "./services";

/** The Service of a provider that a search matched (or the one it leads with), enough to draw a price and a way to book. */
export type DiscoveryService = {
  slug: string;
  name: string;
  category: ServiceCategory;
  pricing: ServicePricing;
  bookingMethod: BookingMethod;
  durationMinutes: number;
};

export type DiscoveryArea = { display: string; slug: string };

/** One provider in the results. */
export type ProviderCard = {
  /** The listing's public address: `/listings/<slug>`. */
  slug: string;
  name: string;
  description: string;
  logo: { src: string } | null;
  /** The average of the provider's public reviews and how many there are; null when it has none. Never invented. */
  rating: { average: number; count: number } | null;
  /** The Service the search matched (the chosen one, else the best word match, else the provider's first). */
  service: DiscoveryService | null;
  serviceCount: number;
  categories: ServiceCategory[];
  /** Up to four of the places the provider works, the one the visitor asked for first. Empty when the provider listed none. */
  areas: DiscoveryArea[];
  areaCount: number;
  /** The provider offers online booking for the matched Service. */
  canBook: boolean;
};

export type DiscoveryResults = { total: number; page: number; pageSize: number; results: ProviderCard[] };

export type FacetService = { slug: string; name: string; providers: number };
export type FacetLocation = { slug: string; kind: "city" | "postal"; label: string; providers: number };
export type FacetCategory = { name: ServiceCategory; providers: number };
export type FacetBookingMode = { mode: BookingMethod; providers: number };

/** What there is to choose from given what has been chosen. Real data only. */
export type DiscoveryFacets = {
  services: FacetService[];
  locations: FacetLocation[];
  categories: FacetCategory[];
  bookingModes: FacetBookingMode[];
};

/** The pages a search engine may be told about: each one has at least one discoverable provider. */
export type MarketplaceSitemap = {
  listings: { slug: string; updatedAt: string }[];
  services: string[];
  locations: string[];
  combinations: { service: string; location: string }[];
};
