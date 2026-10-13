/**
 * The canonical Apex Climate customers, properties and equipment: the approved representative records, verbatim.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY. Nothing in src/ imports this file, so none of it ships to a browser. The development
 * seed writes it to PostgreSQL for the Apex organization (scripts/db/core-seed.ts); the tests read it to check what the
 * database returned.
 *
 * Source: design-reference/stitch/ customers_main_list, customer_detail_overview and customer_properties_equipment.
 * Where those screens disagree, the dedicated screen wins. Sarah Mitchell has ONE property, Home, 1402 Kinney Ave
 * (the stale South Lamar address is not carried over). The customer is Elena RODRIGUEZ, never the stale spelling.
 */
import { currentUser } from "./apex";
import type { Customer, Equipment, Property } from "@/data/customers";

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
