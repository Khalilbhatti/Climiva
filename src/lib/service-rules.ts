/**
 * The rules a Service must satisfy, shared by the forms (which show the messages) and the server (which enforces them).
 * Pure functions: no database, no framework.
 */
import {
  SERVICE_CATEGORIES,
  type IntakeQuestion,
  type PricingModel,
  type Service,
  type ServiceAudience,
  type ServicePricing,
} from "@/data/services";
import { isRecord, text, type Parsed } from "./validation";

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
export function createServiceId(name: string, existing: readonly Pick<Service, "id">[]): string {
  const base = (slugify(name) || "service").slice(0, 70).replace(/-+$/g, "");
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

/* ───────────────────────── what a browser may send ───────────────────────── */

const BOOKING_METHODS = ["instant", "request-appointment", "request-quote"] as const;
const VISIBILITIES = ["public-booking", "public-only", "internal"] as const;
const AUDIENCES: readonly ServiceAudience[] = ["residential", "commercial"];
const MAX_QUESTIONS = 20;

function parseIntake(value: unknown): IntakeQuestion[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS) return undefined;
  const questions: IntakeQuestion[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const id = text(item.id, 60);
    const prompt = text(item.prompt, 200);
    if (!id || !/^[a-z0-9-]+$/.test(id) || !prompt || (item.type !== "single-select" && item.type !== "photo-upload") || typeof item.required !== "boolean") return undefined;
    const question: IntakeQuestion = { id, prompt, type: item.type, required: item.required };
    if (item.options !== undefined) {
      if (!Array.isArray(item.options) || item.options.length > 20 || !item.options.every((option) => typeof option === "string" && option.length <= 100)) return undefined;
      question.options = item.options as string[];
    }
    if (item.helper !== undefined) {
      const helper = text(item.helper, 300);
      if (helper === undefined) return undefined;
      question.helper = helper;
    }
    questions.push(question);
  }
  return questions;
}

/**
 * Understand a Service a browser sent. `others` is the business's other Services (for the duplicate-name rule). The id is
 * whatever was sent and is NOT trusted: the server decides it. Anything malformed is refused with a plain message.
 */
export function parseService(input: unknown, others: readonly Service[]): Parsed<Service> {
  const bad = { ok: false as const, error: "The service details were not understood." };
  if (!isRecord(input) || !isRecord(input.pricing)) return bad;

  const name = text(input.name, 200);
  const description = text(input.description, 2000);
  if (name === undefined || description === undefined) return bad;
  const category = SERVICE_CATEGORIES.find((candidate) => candidate === input.category);
  if (!category) return bad;
  if (!Array.isArray(input.audience) || input.audience.length > 2 || !input.audience.every((item): item is ServiceAudience => AUDIENCES.includes(item as ServiceAudience))) return bad;
  const audience = [...new Set(input.audience)] as ServiceAudience[];
  if (typeof input.durationMinutes !== "number" || !Number.isInteger(input.durationMinutes) || input.durationMinutes > 1440) return bad;
  const bookingMethod = BOOKING_METHODS.find((candidate) => candidate === input.bookingMethod);
  const visibility = VISIBILITIES.find((candidate) => candidate === input.visibility);
  if (!bookingMethod || !visibility || typeof input.active !== "boolean") return bad;
  if (typeof input.displayOrder !== "number" || !Number.isInteger(input.displayOrder) || input.displayOrder < 1 || input.displayOrder > 999) return bad;

  let internalDescription: string | undefined;
  if (input.internalDescription !== undefined && input.internalDescription !== null) {
    internalDescription = text(input.internalDescription, 2000);
    if (internalDescription === undefined) return bad;
  }

  const rawPricing = input.pricing;
  let pricing: ServicePricing;
  if (rawPricing.model === "free-assessment") {
    pricing = { model: "free-assessment" };
  } else if (rawPricing.model === "fixed-price" || rawPricing.model === "diagnostic-fee") {
    const amount = rawPricing.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return bad;
    // Whole cents only: the database stores two decimal places.
    const cents = Math.round(amount * 100) / 100;
    if (rawPricing.model === "fixed-price") {
      pricing = { model: "fixed-price", amount: cents };
    } else {
      const label = text(rawPricing.label, 40);
      if (label === undefined) return bad;
      pricing = { model: "diagnostic-fee", amount: cents, label: label.trim() };
    }
  } else {
    return bad;
  }

  const intake = input.intake === undefined ? [] : parseIntake(input.intake);
  if (!intake) return bad;
  let checklist: string[] | undefined;
  if (input.checklist !== undefined && input.checklist !== null) {
    if (!Array.isArray(input.checklist) || input.checklist.length > 30 || !input.checklist.every((item) => typeof item === "string" && item.length <= 200)) return bad;
    checklist = input.checklist as string[];
  }

  const service: Service = {
    id: typeof input.id === "string" ? input.id : "",
    name: name.trim(),
    category,
    audience,
    description: description.trim(),
    internalDescription: internalDescription?.trim() || undefined,
    durationMinutes: input.durationMinutes,
    pricing,
    bookingMethod,
    visibility,
    active: input.active,
    displayOrder: input.displayOrder,
    intake,
    checklist,
  };
  const errors = validateService(service, others);
  if (Object.keys(errors).length > 0) return { ok: false, error: Object.values(errors)[0] as string, fields: errors as Record<string, string> };
  return { ok: true, value: service };
}
