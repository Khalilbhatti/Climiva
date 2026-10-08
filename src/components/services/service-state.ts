/**
 * Pure helpers for the in-memory demo catalog. Every function returns new objects/arrays and
 * never mutates its input, which is what keeps the canonical fixtures in data/services.ts
 * untouched no matter what happens in the UI.
 */
import type { PricingModel, Service, ServicePricing } from "@/data/services";

export const NAME_MAX_LENGTH = 60;
export const DEFAULT_FEE_LABEL = "diagnostic fee";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A URL-safe id derived from the name, de-duplicated against the catalog. */
export function createServiceId(name: string, existing: readonly Service[]): string {
  const base = slugify(name) || "service";
  const taken = new Set(existing.map((service) => service.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function createBlankService(existing: readonly Service[]): Service {
  return {
    id: "",
    name: "",
    category: "Cooling",
    audience: ["residential"],
    description: "",
    durationMinutes: 60,
    pricing: { model: "fixed-price", amount: 0 },
    bookingMethod: "request-appointment",
    visibility: "public-booking",
    active: true,
    displayOrder: existing.reduce((max, service) => Math.max(max, service.displayOrder), 0) + 1,
    intake: [],
  };
}

export function withAddedService(list: readonly Service[], service: Service): Service[] {
  return [...list, service];
}

export function withUpdatedService(list: readonly Service[], service: Service): Service[] {
  return list.map((item) => (item.id === service.id ? service : item));
}

export function isSameService(a: Service, b: Service): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Switch pricing model, carrying the amount across where it still applies. */
export function withPricingModel(service: Service, model: PricingModel): Service {
  if (service.pricing.model === model) return service;
  const amount = service.pricing.model === "free-assessment" ? 0 : service.pricing.amount;
  const pricing: ServicePricing =
    model === "free-assessment"
      ? { model }
      : model === "fixed-price"
        ? { model, amount }
        : { model, amount, label: DEFAULT_FEE_LABEL };
  return { ...service, pricing };
}

export type ServiceErrors = Partial<
  Record<"name" | "description" | "audience" | "amount" | "priceLabel" | "duration", string>
>;

export function validateService(service: Service, others: readonly Service[]): ServiceErrors {
  const errors: ServiceErrors = {};
  const name = service.name.trim();

  if (!name) errors.name = "Enter a service name.";
  else if (name.length > NAME_MAX_LENGTH) errors.name = `Keep the name to ${NAME_MAX_LENGTH} characters or fewer.`;
  else if (others.some((other) => other.id !== service.id && other.name.toLowerCase() === name.toLowerCase()))
    errors.name = "A service with this name already exists.";

  if (!service.description.trim()) errors.description = "Describe what the service includes.";
  if (service.audience.length === 0) errors.audience = "Select at least one audience.";
  if (!Number.isFinite(service.durationMinutes) || service.durationMinutes < 15)
    errors.duration = "Enter a duration of at least 15 minutes.";

  if (service.pricing.model !== "free-assessment") {
    if (!(service.pricing.amount > 0)) errors.amount = "Enter an amount greater than $0.";
    if (service.pricing.model === "diagnostic-fee" && !service.pricing.label.trim())
      errors.priceLabel = "Enter a price label, such as “diagnostic fee”.";
  }
  return errors;
}
