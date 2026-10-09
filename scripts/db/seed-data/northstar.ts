/**
 * Northstar Heating & Cooling: just enough core data to prove that businesses are kept apart.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY (nothing in src/ imports this file). Invented values, unlike Apex in every way a test
 * can notice: another city, other names, other prices, other staff. One Service deliberately reuses an Apex slug
 * ("ac-repair-diagnostics") with different details, because the same public reference in two businesses must be two
 * unrelated records. It is not a copy of the Apex dataset.
 */
import type { Customer, Equipment, Property } from "@/data/customers";
import type { OperationsData } from "@/data/operations";
import type { Service } from "@/data/services";
import { SYSTEM_ROLES, weeklyFromBusinessHours, type TeamMember } from "@/data/team";

export const NORTHSTAR_HOURS = {
  0: null,
  1: { open: "08:00", close: "17:00" },
  2: { open: "08:00", close: "17:00" },
  3: { open: "08:00", close: "17:00" },
  4: { open: "08:00", close: "17:00" },
  5: { open: "08:00", close: "17:00" },
  6: { open: "09:00", close: "13:00" },
} as const;

export const NORTHSTAR_PROPERTIES: readonly Property[] = [
  { id: "prop-olsen-house", customerId: "marta-olsen", label: "House", street: "55 Juniper Court", city: "Denver", state: "CO", postalCode: "80206", area: "Cherry Creek" },
  { id: "prop-raman-loft", customerId: "priya-raman", label: "Loft", street: "1200 Wynkoop St, #4B", city: "Denver", state: "CO", postalCode: "80202" },
];

export const NORTHSTAR_EQUIPMENT: readonly Equipment[] = [
  {
    id: "eq-olsen-furnace",
    propertyId: "prop-olsen-house",
    name: "Gas Furnace",
    kind: "Gas furnace (two-stage)",
    capacity: "80,000 BTU",
    manufacturer: "Lennox",
    model: "SL280V",
    modelCode: "SL280V090XV36B",
    serialNumber: "5921M08417",
    location: "Basement utility room",
    inServiceSince: "2019-09",
    status: "Active",
  },
];

export const NORTHSTAR_CUSTOMERS: readonly Customer[] = [
  {
    id: "marta-olsen",
    name: "Marta Olsen",
    type: "residential",
    phone: "(720) 555-0161",
    email: "marta.olsen@northstar-clients.test",
    preferredContact: "Email",
    propertyIds: ["prop-olsen-house"],
    notes: [{ body: "Furnace closet is behind the basement stairs. Call before arriving.", updatedOn: "2024-10-20", recordedBy: "Taylor Brooks" }],
    preferences: ["Prefers afternoon visits"],
  },
  {
    id: "priya-raman",
    name: "Priya Raman",
    type: "residential",
    phone: "(303) 555-0172",
    email: "priya.raman@northstar-clients.test",
    preferredContact: "SMS",
    language: "English",
    propertyIds: ["prop-raman-loft"],
    notes: [],
    preferences: [],
  },
];

export const NORTHSTAR_SERVICES: readonly Service[] = [
  {
    id: "ac-repair-diagnostics",
    name: "Cooling Diagnostic Visit",
    category: "Cooling",
    audience: ["residential"],
    description: "A technician finds out why your air conditioner is not keeping up and quotes the repair before any work starts.",
    durationMinutes: 75,
    pricing: { model: "diagnostic-fee", amount: 79, label: "diagnostic fee" },
    bookingMethod: "request-appointment",
    visibility: "public-booking",
    active: true,
    displayOrder: 1,
    intake: [],
  },
  {
    id: "furnace-tune-up",
    name: "Furnace Tune-Up",
    category: "Heating",
    audience: ["residential", "commercial"],
    description: "Seasonal furnace inspection, burner clean and carbon monoxide check.",
    durationMinutes: 45,
    pricing: { model: "fixed-price", amount: 109 },
    bookingMethod: "instant",
    visibility: "public-booking",
    active: true,
    displayOrder: 2,
    intake: [],
  },
  {
    id: "radiant-heat-estimate",
    name: "Radiant Heat Estimate",
    category: "Heating",
    audience: ["residential"],
    description: "A walk-through to size and price in-floor radiant heating.",
    durationMinutes: 90,
    pricing: { model: "free-assessment" },
    bookingMethod: "request-quote",
    visibility: "public-only",
    active: true,
    displayOrder: 3,
    intake: [],
  },
];

/** The roles are the six every business starts with; the team is the owner and one technician who has no login. */
export const NORTHSTAR_ROLES = SYSTEM_ROLES;

export const NORTHSTAR_TEAM: readonly TeamMember[] = [
  {
    id: "taylor-brooks",
    name: "Taylor Brooks",
    role: "Owner",
    roleId: "owner",
    phone: "(555) 410-7788",
    status: "active",
    fieldAssignable: true,
    availability: { mode: "business-hours", weekly: weeklyFromBusinessHours(NORTHSTAR_HOURS), unavailable: [] },
    serviceMode: "all",
    serviceIds: [],
    activity: [],
  },
  {
    id: "jordan-pike",
    name: "Jordan Pike",
    role: "Technician",
    roleId: "technician",
    title: "Lead Technician",
    email: "jordan.pike@northstar-hvac.test",
    phone: "(720) 555-0144",
    status: "active",
    fieldAssignable: true,
    availability: { mode: "business-hours", weekly: weeklyFromBusinessHours(NORTHSTAR_HOURS), unavailable: [] },
    serviceMode: "selected",
    serviceIds: ["ac-repair-diagnostics", "furnace-tune-up"],
    activity: [
      { id: "act-jordan-1", at: "2024-10-18T08:30", category: "access", title: "Joined the team", detail: "Added by Taylor Brooks as Technician", byId: "taylor-brooks" },
    ],
  },
];

/**
 * Northstar's operations: deliberately few. One confirmed booking with its job (assigned to Northstar's own technician) and
 * one request awaiting confirmation, all for Northstar's own customers and Services. Its numbers start at 1001, so
 * "BK-1001" exists in Northstar and is a different record from any Apex booking: a number is unique per business only.
 * Nothing here exists in Apex, and no Apex record appears here.
 */
export const NORTHSTAR_OPERATIONS: OperationsData = {
  bookings: [
    {
      id: "BK-1001",
      customerId: "marta-olsen",
      propertyId: "prop-olsen-house",
      serviceId: "furnace-tune-up",
      date: "2024-10-29",
      start: "09:00",
      end: "09:45",
      status: "confirmed",
      assigneeId: "jordan-pike",
      source: "Phone / Front desk",
      receivedAt: "2024-10-22T13:05",
      confirmedAt: "2024-10-22T13:05",
      note: "Annual tune-up before the heating season",
      jobId: "JB-1001",
    },
    {
      id: "BK-1002",
      contactName: "Dev Kapoor",
      serviceId: "ac-repair-diagnostics",
      date: "2024-10-30",
      start: "13:00",
      end: "15:00",
      status: "pending",
      source: "Website",
      receivedAt: "2024-10-23T18:20",
      contact: { phone: "(720) 555-0188", email: "dev.kapoor@northstar-clients.test", address: "2204 Larimer St, Denver, CO 80205" },
      note: "Condenser is not starting",
    },
  ],
  jobs: [
    {
      id: "JB-1001",
      bookingId: "BK-1001",
      customerId: "marta-olsen",
      propertyId: "prop-olsen-house",
      serviceId: "furnace-tune-up",
      assigneeId: "jordan-pike",
      date: "2024-10-29",
      start: "09:00",
      end: "09:45",
      status: "scheduled",
      equipmentId: "eq-olsen-furnace",
      note: "Annual tune-up before the heating season",
      details: { customerRequest: "Annual tune-up before the heating season. Call before arriving." },
      files: [],
    },
  ],
  blocks: [],
};
