/**
 * Pure edits to a listing's configuration while it is being edited: moving a Service in the listing's order and selecting or dropping
 * one. Nothing here can change a Service or the business record, and nothing is stored by these: Save sends the configuration to the
 * server (src/server/actions/marketplace), which validates it again and stores it.
 */
import type { ListingConfig } from "@/data/marketplace";

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
