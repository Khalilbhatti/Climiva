import type { Route } from "next";

/**
 * Typed hrefs for record routes. IDs are fixture slugs, never Stitch screen IDs.
 *
 * Next's `Route` type only covers static routes (dynamic ones are inferred per <Link>), so shared
 * components that accept an href use `AppHref`: every static route plus the record patterns below.
 * Add a pattern here when a new dynamic route is created.
 */
export type AppHref =
  | Route
  | `/customers/${string}`
  | `/customers/${string}/properties`
  | `/services/${string}`
  | `/services/${string}/${string}`
  | `/jobs/${string}`
  | `/jobs/${string}/${string}`
  | `/team/${string}`
  | `/team/${string}/${string}`
  | `/quotes-invoices/quotes/${string}`
  | `/quotes-invoices/invoices/${string}`
  | `/payments/${string}`
  | `/maintenance-plans/${string}`
  | `/website/builder?page=${string}`
  | `/website/preview/${string}`
  | `/sites/${string}`
  | `/listings/${string}`
  | `/reviews/${string}`
  | `/marketing/${string}`
  | `/marketing/${string}/edit`;

export const customerHref = (customerId: string) => `/customers/${customerId}` as const;
export const customerPropertiesHref = (customerId: string) => `/customers/${customerId}/properties` as const;

/** URL segment per Service tab; "overview" is the service's root route. */
export const SERVICE_TAB_SEGMENT = {
  overview: "",
  pricing: "pricing",
  "booking-settings": "booking-settings",
  "customer-intake": "customer-intake",
  availability: "availability",
} as const;

export type ServiceTab = keyof typeof SERVICE_TAB_SEGMENT;

export const serviceHref = (serviceId: string) => `/services/${serviceId}` as const;
export const serviceTabHref = (serviceId: string, tab: ServiceTab): AppHref => {
  const segment = SERVICE_TAB_SEGMENT[tab];
  return segment ? `/services/${serviceId}/${segment}` : `/services/${serviceId}`;
};

/** URL segment per Job tab; "overview" is the job's root route. */
export const JOB_TAB_SEGMENT = {
  overview: "",
  "work-details": "work-details",
  files: "files",
} as const;

export type JobTab = keyof typeof JOB_TAB_SEGMENT;

export const jobHref = (jobId: string) => `/jobs/${jobId}` as const;
export const jobTabHref = (jobId: string, tab: JobTab): AppHref => {
  const segment = JOB_TAB_SEGMENT[tab];
  return segment ? `/jobs/${jobId}/${segment}` : `/jobs/${jobId}`;
};

/** URL segment per team member tab; "overview" is the member's root route. */
export const MEMBER_TAB_SEGMENT = {
  overview: "",
  availability: "availability",
  permissions: "permissions",
  services: "services",
  activity: "activity",
} as const;

export type MemberTab = keyof typeof MEMBER_TAB_SEGMENT;

export const memberHref = (memberId: string) => `/team/${memberId}` as const;
export const memberTabHref = (memberId: string, tab: MemberTab): AppHref => {
  const segment = MEMBER_TAB_SEGMENT[tab];
  return segment ? `/team/${memberId}/${segment}` : `/team/${memberId}`;
};
export const roleHref = (roleId: string) => `/team/roles/${roleId}` as const;

export const quoteHref = (quoteId: string) => `/quotes-invoices/quotes/${quoteId}` as const;
export const invoiceHref = (invoiceId: string) => `/quotes-invoices/invoices/${invoiceId}` as const;
export const paymentHref = (paymentId: string) => `/payments/${paymentId}` as const;
