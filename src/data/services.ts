/**
 * Canonical Service catalog.
 *
 * The six services below are the only HVAC offerings in the product. Website, Marketplace,
 * Bookings, Jobs, Customers and Analytics must read them through the selectors in this file;
 * never retype a name, price or booking method elsewhere.
 *
 * Sources: design-reference/stitch/ services_main_catalog + service_detail_* screens, with the
 * names, prices and booking methods locked by climvia_development_handoff and the audit board.
 * Stitch's other catalog rows (commercial rooftop maintenance, internal warranty callback) and
 * its emergency-handling wording are intentionally not carried over.
 *
 * Fixtures are read-only. Runtime edits (Add service, Save changes) live in React state in
 * components/services/ServicesProvider and reset on reload; they never touch these arrays.
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

export const SERVICES: readonly Service[] = [
  {
    id: "ac-repair-diagnostics",
    name: "AC Repair & Diagnostics",
    category: "Cooling",
    audience: ["residential", "commercial"],
    description:
      "Comprehensive inspection of your air conditioning system. Our technician checks electrical components, refrigerant levels, compressor operation, and airflow to identify the exact cause of cooling issues. You'll receive an upfront quote before any repairs begin.",
    internalDescription:
      "Standard cooling diagnostic fee covering up to 60 mins of electrical and mechanical testing. Parts and subsequent repair labor billed separately upon customer quote approval.",
    durationMinutes: 90,
    pricing: { model: "diagnostic-fee", amount: 89, label: "diagnostic fee" },
    bookingMethod: "request-appointment",
    visibility: "public-booking",
    active: true,
    displayOrder: 1,
    intake: [
      {
        id: "primary-issue",
        prompt: "What is your primary cooling issue?",
        type: "single-select",
        required: true,
        options: [
          "Blowing warm air",
          "System will not turn on",
          "Making unusual humming/buzzing",
          "Water leaking from indoor unit",
          "Thermostat error code",
          "Other diagnostic symptom",
        ],
      },
      {
        id: "system-type",
        prompt: "What type of cooling system do you have?",
        type: "single-select",
        required: false,
        options: ["Central AC", "Heat Pump", "Mini-Split", "Unsure"],
      },
      {
        id: "system-age",
        prompt: "Approximate age of your system",
        type: "single-select",
        required: false,
        options: ["Under 5 yrs", "5 - 10 yrs", "10 - 15 yrs", "Over 15 yrs", "Don't know"],
      },
      {
        id: "unit-photo",
        prompt: "Photo of unit or thermostat (optional)",
        type: "photo-upload",
        required: false,
        helper: "Allows technician to inspect model plates or error codes prior to arrival.",
      },
    ],
    checklist: [
      "Subcooling & superheat test",
      "Capacitor & contactor inspection",
      "Condensate drain & p-trap check",
    ],
  },
  {
    id: "annual-cooling-tune-up",
    name: "Annual Cooling Tune-Up & Maintenance",
    category: "Maintenance",
    audience: ["residential"],
    description: "21-point comprehensive seasonal inspection, coil clean, and capacitor check",
    durationMinutes: 60,
    pricing: { model: "fixed-price", amount: 129 },
    bookingMethod: "instant",
    visibility: "public-booking",
    active: true,
    displayOrder: 2,
    intake: [],
  },
  {
    id: "heat-pump-diagnostics-repair",
    name: "Heat Pump Diagnostics & Repair",
    category: "Heat pumps",
    audience: ["residential"],
    description: "Specialized reversing valve, defrost board, and compressor inspection",
    durationMinutes: 90,
    pricing: { model: "diagnostic-fee", amount: 99, label: "diagnostic fee" },
    bookingMethod: "request-appointment",
    visibility: "public-booking",
    active: true,
    displayOrder: 3,
    intake: [],
  },
  {
    id: "emergency-no-heat-no-cool",
    name: "Emergency No-Heat / No-Cool Service",
    category: "Emergency",
    audience: ["residential", "commercial"],
    description: "Urgent on-site diagnosis and repair for heating or cooling system failures",
    durationMinutes: 60,
    pricing: { model: "diagnostic-fee", amount: 149, label: "call fee" },
    bookingMethod: "request-appointment",
    visibility: "public-booking",
    active: true,
    displayOrder: 4,
    intake: [],
  },
  {
    id: "ductless-mini-split-estimate",
    name: "Ductless Mini-Split Installation & Estimate",
    category: "Cooling",
    audience: ["residential"],
    description: "In-home site assessment for multi-zone mini-split configuration",
    durationMinutes: 120,
    pricing: { model: "free-assessment" },
    bookingMethod: "request-quote",
    visibility: "public-booking",
    active: true,
    displayOrder: 5,
    intake: [],
  },
  {
    id: "furnace-safety-inspection",
    name: "Furnace Safety Inspection & Tune-Up",
    category: "Heating",
    audience: ["residential"],
    description: "Heat exchanger safety check, burner cleaning, and carbon monoxide test",
    durationMinutes: 60,
    pricing: { model: "fixed-price", amount: 119 },
    bookingMethod: "instant",
    visibility: "public-booking",
    active: true,
    displayOrder: 6,
    intake: [],
  },
];

/* ───────────────────────── selectors ─────────────────────────
 * Each accepts an optional list so the in-memory demo catalog (ServicesProvider) can reuse
 * the same logic. With no argument they read the canonical fixtures. */

export function getServices(list: readonly Service[] = SERVICES): Service[] {
  return [...list].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function getServiceById(id: string, list: readonly Service[] = SERVICES): Service | undefined {
  return list.find((service) => service.id === id);
}

/** Active services shown on the public website. (Website, Marketplace.) */
export function getPublicActiveServices(list: readonly Service[] = SERVICES): Service[] {
  return getServices(list).filter((service) => service.active && service.visibility !== "internal");
}

/** Active services a customer can book online without staff involvement first. (Booking widget.) */
export function getOnlineBookableServices(list: readonly Service[] = SERVICES): Service[] {
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
