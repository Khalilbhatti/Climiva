/**
 * Canonical Customers, Properties and Equipment.
 *
 * Source: design-reference/stitch/ customers_main_list, customer_detail_overview and
 * customer_properties_equipment. Where those screens disagree with each other, the dedicated
 * screen wins (equipment details come from the Properties & Equipment screen, not the Overview
 * snapshot). Anything not on those screens is deliberately absent: no customer scoring, no
 * revenue-derived metrics and no live device data. Equipment is a record, not a monitoring system.
 *
 * `lastService` and `upcoming` are display text carried over from the approved Customers list.
 * Jobs and bookings are not stored here: they live in data/operations and are looked up by customer id
 * (getJobsForCustomer, getBookingsForCustomer).
 */
import { currentUser } from "./fixtures";
import { getServiceById } from "./services";

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

export const PROPERTIES: readonly Property[] = [
  {
    id: "prop-sarah-home",
    customerId: "sarah-mitchell",
    label: "Home",
    street: "1402 Kinney Ave",
    city: "Austin",
    state: "TX",
    postalCode: "78704",
    area: "Barton Hills",
    accessInstructions:
      "Gate code #4412. Side gate latch on left side of garage. Dogs secured inside home during service window.",
    mechanicalAccess:
      "Attic pull-down stairs requires 6ft ladder. Outdoor condenser on south exterior wall along paved stone path.",
  },
  {
    id: "prop-david-home",
    customerId: "david-chen",
    label: "Home",
    street: "3104 South Congress",
    city: "Austin",
    state: "TX",
    postalCode: "78704",
  },
  {
    id: "prop-elena-condo",
    customerId: "elena-rodriguez",
    label: "Condo",
    street: "7820 Mesa Dr, #204",
    city: "Austin",
    state: "TX",
    postalCode: "78731",
    area: "Northwest",
  },
  {
    id: "prop-bradley-bungalow",
    customerId: "bradley-cooper",
    label: "Bungalow",
    street: "4501 Speedway",
    city: "Austin",
    state: "TX",
    postalCode: "78751",
    area: "Hyde Park",
  },
  {
    id: "prop-hannah-residence",
    customerId: "hannah-wright",
    label: "Residence",
    street: "2208 Barton Hills Dr",
    city: "Austin",
    state: "TX",
    postalCode: "78704",
  },
];

export const EQUIPMENT: readonly Equipment[] = [
  {
    id: "eq-sarah-heat-pump",
    propertyId: "prop-sarah-home",
    name: "Main Central Heat Pump & AC",
    kind: "Heat pump (split system)",
    capacity: "3.0 ton",
    manufacturer: "Carrier",
    model: "Infinity 19VS",
    modelCode: "25VNA836A003",
    serialNumber: "1618E42109",
    location: "South exterior pad & attic air handler",
    inServiceSince: "2016-05",
    refrigerant: "R-410A (factory charge 8.2 lbs)",
    filter: "20×25×4 MERV 11",
    status: "Active",
    lastServiced: {
      date: "2024-10-25",
      jobId: "JB-204",
      serviceId: "ac-repair-diagnostics",
      note: "Dual run capacitor replaced. System tested OK.",
    },
  },
  {
    id: "eq-sarah-thermostat",
    propertyId: "prop-sarah-home",
    name: "Smart Thermostat",
    kind: "Digital programmable thermostat",
    manufacturer: "Ecobee",
    model: "Smart Thermostat Premium",
    modelCode: "EB-STATE6-01",
    serialNumber: "EB-884019-TX",
    location: "Central hallway wall",
    inServiceSince: "2021-11",
    status: "Active",
    lastServiced: {
      date: "2024-05-14",
      jobId: "JB-142",
      serviceId: "annual-cooling-tune-up",
      note: "Inspection completed OK.",
    },
  },
];

export const CUSTOMERS: readonly Customer[] = [
  {
    id: "sarah-mitchell",
    name: "Sarah Mitchell",
    type: "residential",
    phone: "(512) 555-0194",
    email: "sarah.m@gmail.com",
    preferredContact: "SMS",
    language: "English",
    propertyIds: ["prop-sarah-home"],
    notes: [
      {
        body: "Attic drop-down ladder located in upstairs hallway near laundry. Yellow lab is secured in utility room during visits. Prefers morning appointments between 10:00 AM and 1:00 PM.",
        updatedOn: "2024-10-24",
        recordedBy: currentUser.name,
      },
    ],
    preferences: ["Paperless invoices sent by email"],
    lastService: { date: "2024-10-25", serviceId: "ac-repair-diagnostics", jobId: "JB-204" },
  },
  {
    id: "david-chen",
    name: "David Chen",
    type: "residential",
    phone: "(512) 670-1190",
    email: "d.chen@outlook.com",
    preferredContact: "Phone",
    propertyIds: ["prop-david-home"],
    notes: [],
    preferences: [],
    lastService: { date: "2024-10-25", summary: "Heat Pump Reversing Valve" },
  },
  {
    id: "elena-rodriguez",
    name: "Elena Rodriguez",
    type: "residential",
    phone: "(512) 492-3831",
    email: "elena.r@icloud.com",
    preferredContact: "SMS",
    propertyIds: ["prop-elena-condo"],
    notes: [],
    preferences: [],
    lastService: { date: "2024-09-18", summary: "Capacitor Swap (Carrier 3-ton)" },
    upcoming: { at: "2024-10-25T15:00:00Z", summary: "Dual Capacitor Replacement" },
  },
  {
    id: "bradley-cooper",
    name: "Bradley Cooper",
    type: "residential",
    phone: "(512) 330-9411",
    email: "bcooper@gmail.com",
    preferredContact: "SMS",
    propertyIds: ["prop-bradley-bungalow"],
    notes: [],
    preferences: [],
    maintenancePlan: { name: "Seasonal Maintenance", status: "Active" },
    lastService: { date: "2024-08-04", summary: "Mini-Split Tune-up (Mitsubishi)" },
    upcoming: { at: "2024-10-26T09:00:00Z", summary: "Mini-Split Line Flush" },
  },
  {
    id: "hannah-wright",
    name: "Hannah Wright",
    type: "residential",
    phone: "(512) 902-8822",
    email: "hannah.w@austin.rr.com",
    preferredContact: "Phone",
    propertyIds: ["prop-hannah-residence"],
    notes: [],
    preferences: [],
    lastService: { date: "2024-06-14", summary: "Thermostat Replacement (Ecobee)" },
    upcoming: { at: "2024-10-26T14:00:00Z", summary: "Sensor Fault Follow-up" },
  },
];

/* ───────────────────────── selectors ───────────────────────── */

export function getCustomers(): readonly Customer[] {
  return CUSTOMERS;
}

export function getCustomerById(id: string): Customer | undefined {
  return CUSTOMERS.find((customer) => customer.id === id);
}

export function getPropertyById(id: string): Property | undefined {
  return PROPERTIES.find((property) => property.id === id);
}

export function getPropertiesForCustomer(customerId: string): Property[] {
  return PROPERTIES.filter((property) => property.customerId === customerId);
}

/** The customer's first property: the one shown in lists and headers. */
export function getPrimaryProperty(customer: Customer): Property | undefined {
  return getPropertyById(customer.propertyIds[0]);
}

export function getEquipmentForProperty(propertyId: string): Equipment[] {
  return EQUIPMENT.filter((item) => item.propertyId === propertyId);
}

export function getEquipmentForCustomer(customerId: string): Equipment[] {
  const propertyIds = new Set(getPropertiesForCustomer(customerId).map((property) => property.id));
  return EQUIPMENT.filter((item) => propertyIds.has(item.propertyId));
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

/** Last-service text: the canonical service name when one is referenced, otherwise the stored summary. */
export function describeLastService(customer: Customer): string | undefined {
  const last = customer.lastService;
  if (!last) return undefined;
  return (last.serviceId && getServiceById(last.serviceId)?.name) || last.summary;
}
