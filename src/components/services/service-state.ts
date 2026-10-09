/**
 * Pure helpers for the working copy of the catalog. Every function returns new objects/arrays and never mutates its input.
 * The rules themselves (names, prices, durations …) are in lib/service-rules, shared with the server.
 */
import type { Service } from "@/data/services";

export {
  DEFAULT_FEE_LABEL,
  NAME_MAX_LENGTH,
  createBlankService,
  createServiceId,
  isSameService,
  slugify,
  validateService,
  withPricingModel,
  type ServiceErrors,
} from "@/lib/service-rules";

export function withAddedService(list: readonly Service[], service: Service): Service[] {
  return [...list, service];
}

export function withUpdatedService(list: readonly Service[], service: Service): Service[] {
  return list.map((item) => (item.id === service.id ? service : item));
}
