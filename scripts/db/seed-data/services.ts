/**
 * The six canonical Apex Climate Services, verbatim: names, durations, prices and booking methods are the approved values.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY (nothing in src/ imports this file). The development seed writes it to PostgreSQL for
 * the Apex organization. A Maintenance Plan's coverage labels are plan internals and are never Services: the public
 * catalog is exactly these six.
 *
 * Sources: design-reference/stitch/ services_main_catalog + service_detail_* screens, with the names, prices and booking
 * methods locked by climvia_development_handoff and the audit board.
 */
import type { Service } from "@/data/services";

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
