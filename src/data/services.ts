/**
 * Services: the types, the labels and the pure helpers.
 *
 * A business's Services live in PostgreSQL (the `services` table), per organization, and reach the browser through the
 * workspace snapshot. Website, Marketplace, Bookings, Jobs, Customers and Analytics read them through the selectors in
 * this file, always with the list they were given; never retype a name, price or booking method elsewhere. The six
 * canonical Apex Climate Services are seed data (scripts/db/seed-data/services.ts) and ship to no browser.
 *
 * A new business starts with NO Services (a future starter-template step may offer presets; see
 * docs/saas-architecture.md).
 */
import { formatUSD } from "@/lib/format";

export type ServiceCategory = "Cooling" | "Heating" | "Heat pumps" | "Maintenance" | "Emergency";
export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  "Cooling",
  "Heating",
  "Heat pumps",
  "Maintenance",
  "Emergency",
];

export type ServiceAudience = "residential" | "commercial";

export type BookingMethod = "instant" | "request-appointment" | "request-quote";

/** How the customer-facing price is presented. */
export type ServicePricing =
  | { model: "diagnostic-fee"; amount: number; /** "diagnostic fee" | "call fee" */ label: string }
  | { model: "fixed-price"; amount: number }
  | { model: "free-assessment" };

export type PricingModel = ServicePricing["model"];

/** website = listed on the public site only; booking = listed and bookable online. */
export type ServiceVisibility = "public-booking" | "public-only" | "internal";

export type IntakeQuestion = {
  id: string;
  prompt: string;
  type: "single-select" | "photo-upload";
  required: boolean;
  options?: readonly string[];
  helper?: string;
};

export type Service = {
  /** URL slug: /services/[serviceId] */
  id: string;
  name: string;
  category: ServiceCategory;
  audience: readonly ServiceAudience[];
  /** Customer-facing description, shown on the website, booking flow and confirmations. */
  description: string;
  /** Private to the team; only present where the approved design shows one. */
  internalDescription?: string;
  durationMinutes: number;
  pricing: ServicePricing;
  bookingMethod: BookingMethod;
  visibility: ServiceVisibility;
  active: boolean;
  /** Position in the public service list and booking picker (1 = first). */
  displayOrder: number;
  intake: readonly IntakeQuestion[];
  /** Technician checklist; only present where the approved design shows one. */
  checklist?: readonly string[];
};

/* ───────────────────────── selectors ─────────────────────────
 * Each takes the workspace's list of Services. */

export function getServices(list: readonly Service[]): Service[] {
  return [...list].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function getServiceById(id: string, list: readonly Service[]): Service | undefined {
  return list.find((service) => service.id === id);
}

/** Active services shown on the public website. (Website, Marketplace.) */
export function getPublicActiveServices(list: readonly Service[]): Service[] {
  return getServices(list).filter((service) => service.active && service.visibility !== "internal");
}

/** Active services a customer can book online without staff involvement first. (Booking widget.) */
export function getOnlineBookableServices(list: readonly Service[]): Service[] {
  return getServices(list).filter((service) => service.active && service.visibility === "public-booking");
}

/* ───────────────────────── presentation ───────────────────────── */

export const BOOKING_METHOD_LABEL: Record<BookingMethod, string> = {
  instant: "Instant booking",
  "request-appointment": "Request appointment",
  "request-quote": "Request quote / assessment",
};

/** What the customer experiences for each method. */
export const BOOKING_METHOD_DETAIL: Record<BookingMethod, string> = {
  instant: "Customer selects an available time slot directly on your calendar.",
  "request-appointment": "Customer requests a preferred date and time, and your business confirms the appointment.",
  "request-quote": "Customer requests an in-home assessment before any billable work is agreed.",
};

/** Short arrival expectation shown under the method in the catalog. */
export const BOOKING_METHOD_ARRIVAL: Record<BookingMethod, string> = {
  instant: "Exact time",
  "request-appointment": "2-hour arrival window",
  "request-quote": "In-home assessment",
};

/** The label on a customer-facing button that starts booking (website, Marketplace), by method. */
export const BOOKING_METHOD_ACTION: Record<BookingMethod, string> = {
  instant: "Book a time",
  "request-appointment": "Request appointment",
  "request-quote": "Request a quote",
};

export const PRICING_MODEL_LABEL: Record<PricingModel, string> = {
  "diagnostic-fee": "Diagnostic / service-call fee",
  "fixed-price": "Fixed price",
  "free-assessment": "Free estimate / inspection",
};

export const PRICING_MODEL_DETAIL: Record<PricingModel, string> = {
  "diagnostic-fee": "Customer pays for the assessment; repairs are quoted separately on-site.",
  "fixed-price": "Single transparent flat rate for turnkey, non-variable work.",
  "free-assessment": "No charge for the initial system assessment or replacement quote.",
};

export const VISIBILITY_LABEL: Record<ServiceVisibility, string> = {
  "public-booking": "Public · Website & booking",
  "public-only": "Public · Website only",
  internal: "Internal only",
};

/** "$89 diagnostic fee" · "$129 fixed price" · "Free assessment" */
export function formatServicePrice(pricing: ServicePricing): string {
  switch (pricing.model) {
    case "diagnostic-fee":
      return `${formatUSD(pricing.amount)} ${pricing.label}`;
    case "fixed-price":
      return `${formatUSD(pricing.amount)} fixed price`;
    case "free-assessment":
      return "Free assessment";
  }
}

/** 90 → "90 mins", 120 → "2 hours" */
export function formatDuration(minutes: number): string {
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} mins`;
}

export const AUDIENCE_LABEL: Record<ServiceAudience, string> = {
  residential: "Residential",
  commercial: "Commercial",
};

/** "Residential & Commercial" */
export function formatAudience(audience: readonly ServiceAudience[]): string {
  return audience.map((item) => AUDIENCE_LABEL[item]).join(" & ");
}
