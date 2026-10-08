/**
 * Pure state transitions for the Marketplace demo. Nothing is published anywhere: a listing is a status and a
 * saved configuration held in memory. Hiding never touches the saved configuration, and nothing here can change a
 * Service or the business record.
 */
import type { ListingConfig, MarketplaceState } from "@/data/marketplace";

/** Saves the listing's configuration. The published or hidden status is unchanged. */
export function saveListing(state: MarketplaceState, config: ListingConfig): MarketplaceState {
  return { ...state, config };
}

export function publishListing(state: MarketplaceState): MarketplaceState {
  return { ...state, status: "published" };
}

/** Hides the listing from the directory. Its saved configuration stays exactly as it was. */
export function hideListing(state: MarketplaceState): MarketplaceState {
  return state.status === "published" ? { ...state, status: "hidden" } : state;
}

/** First-time setup: saves the configuration and publishes in one step. */
export function setUpListing(state: MarketplaceState, config: ListingConfig): MarketplaceState {
  return { status: "published", config: { ...config } };
}

/** Moves a Service one place up or down the listing order. Unknown ids and the ends are left alone. */
export function moveService(config: ListingConfig, serviceId: string, by: -1 | 1): ListingConfig {
  const order = [...config.order];
  const index = order.indexOf(serviceId);
  const target = index + by;
  if (index === -1 || target < 0 || target >= order.length) return config;
  [order[index], order[target]] = [order[target], order[index]];
  return { ...config, order };
}

export function toggleService(config: ListingConfig, serviceId: string, on: boolean): ListingConfig {
  const selected = on ? (config.selected.includes(serviceId) ? config.selected : [...config.selected, serviceId]) : config.selected.filter((id) => id !== serviceId);
  return { ...config, selected };
}
