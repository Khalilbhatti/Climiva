/**
 * Customers, Properties and Equipment: the types and the pure helpers.
 *
 * The records live in PostgreSQL (customers, customer_properties, equipment), per organization. Every id here is the
 * record's PUBLIC REFERENCE (its slug: "sarah-mitchell", "prop-sarah-home"), unique within one business: it is what
 * URLs carry and what the operations sample data points at. The database's own uuids never reach a browser.
 *
 * The canonical Apex Climate records are seed data (scripts/db/seed-data/customers.ts) and ship to no browser.
 * Anything not on the approved screens is deliberately absent: no customer scoring, no revenue-derived metrics and no
 * live device data. Equipment is a record, not a monitoring system.
 *
 * `lastService` and `upcoming` are display text from the approved Customers list, stored on the customer until jobs and
 * bookings are on the database. Jobs and bookings are not stored here: they live in data/operations and are looked up
 * by customer id (getJobsForCustomer, getBookingsForCustomer).
 */
import { getServiceById, type Service } from "./services";

export type CustomerType = "residential";
export type ContactChannel = "SMS" | "Phone" | "Email";

export type Equipment = {
  id: string;
  propertyId: string;
  name: string;
  /** e.g. "Heat pump (split system)" */
  kind: string;
  /** e.g. "3.0 ton" */
  capacity?: string;
  manufacturer: string;
  model: string;
  modelCode: string;
  serialNumber: string;
  /** Where the equipment physically is. */
  location: string;
  /** "2016-05" */
  inServiceSince: string;
  refrigerant?: string;
  filter?: string;
  status: "Active";
  lastServiced?: {
    /** "2024-10-25" */
    date: string;
    jobId?: string;
    /** Canonical service performed; the name is read from the catalog. */
    serviceId?: string;
    note?: string;
  };
};

export type Property = {
  id: string;
  customerId: string;
  /** "Home", "Condo", "Bungalow"… */
  label: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  /** Neighborhood, shown in parentheses after the postal code. */
  area?: string;
  accessInstructions?: string;
  mechanicalAccess?: string;
};

export type CustomerNote = {
  body: string;
  /** "2024-10-24" */
  updatedOn: string;
  recordedBy: string;
};

export type Customer = {
  /** URL slug: /customers/[customerId] */
  id: string;
  name: string;
  type: CustomerType;
  phone: string;
  email: string;
  preferredContact: ContactChannel;
  language?: string;
  /** First entry is the primary property. */
  propertyIds: readonly string[];
  notes: readonly CustomerNote[];
  preferences: readonly string[];
  /**
   * A plan label with no detailed plan record behind it. Customers who have a record in data/maintenance-plans
   * (Sarah Mitchell, David Chen) take their plan from there; this is only the older Customers-list label.
   */
  maintenancePlan?: {
    name: string;
    status: "Active";
    /** USD per year; only where the approved design shows it. */
    pricePerYear?: number;
    visitsPerYear?: number;
  };
  /** Display text for the list's "Last service" column. */
  lastService?: { date: string; serviceId?: string; summary?: string; jobId?: string };
  /** Display text for the list's "Upcoming" column. */
  upcoming?: { at: string; summary: string };
};

/* ───────────────────────── selectors ───────────────────────── */

/** The business's customer book: what these selectors read. The directory and the Customers pages both provide it. */
export type CustomerBook = {
  customers: readonly Customer[];
  properties: readonly Property[];
  equipment: readonly Equipment[];
};

export const EMPTY_CUSTOMER_BOOK: CustomerBook = { customers: [], properties: [], equipment: [] };

export function getCustomerById(id: string, book: Pick<CustomerBook, "customers">): Customer | undefined {
  return book.customers.find((customer) => customer.id === id);
}

export function getPropertyById(id: string, book: Pick<CustomerBook, "properties">): Property | undefined {
  return book.properties.find((property) => property.id === id);
}

export function getPropertiesForCustomer(customerId: string, book: Pick<CustomerBook, "properties">): Property[] {
  return book.properties.filter((property) => property.customerId === customerId);
}

/** The customer's first property: the one shown in lists and headers. */
export function getPrimaryProperty(customer: Customer, book: Pick<CustomerBook, "properties">): Property | undefined {
  return getPropertyById(customer.propertyIds[0], book);
}

export function getEquipmentForProperty(propertyId: string, book: Pick<CustomerBook, "equipment">): Equipment[] {
  return book.equipment.filter((item) => item.propertyId === propertyId);
}

export function getEquipmentForCustomer(customerId: string, book: Pick<CustomerBook, "properties" | "equipment">): Equipment[] {
  const propertyIds = new Set(getPropertiesForCustomer(customerId, book).map((property) => property.id));
  return book.equipment.filter((item) => propertyIds.has(item.propertyId));
}

/* ───────────────────────── presentation ───────────────────────── */

/** "Austin, TX 78704" */
export function formatPropertyCityLine(property: Property): string {
  return `${property.city}, ${property.state} ${property.postalCode}`;
}

/** "1402 Kinney Ave, Austin, TX 78704" */
export function formatPropertyAddress(property: Property): string {
  return `${property.street}, ${formatPropertyCityLine(property)}`;
}

/** Last-service text: the Service's name when one is referenced, otherwise the stored summary. */
export function describeLastService(customer: Customer, services: readonly Service[]): string | undefined {
  const last = customer.lastService;
  if (!last) return undefined;
  return (last.serviceId && getServiceById(last.serviceId, services)?.name) || last.summary;
}
