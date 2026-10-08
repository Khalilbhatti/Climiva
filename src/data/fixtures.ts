/**
 * Canonical prototype data — the ONE place representative values live.
 *
 * Every screen reads from here. Do not retype these values in components or pages.
 * Source: design-reference/stitch/climvia_development_handoff ("Canonical Business Record",
 * "Locked Representative Fixtures") and the Phase 1 brief.
 *
 * This is prototype data only; there is no backend yet.
 */

export const business = {
  name: "Apex Climate Heating & Air",
  phone: "(555) 392-8100",
  email: "service@apexclimate.com",
  address: {
    street: "4820 East Riverside Dr, Suite 110",
    city: "Austin",
    state: "TX",
    postalCode: "78741",
  },
  hours: [
    { days: "Mon–Fri", hours: "7:30 AM–6:00 PM" },
    { days: "Sat", hours: "8:00 AM–2:00 PM" },
    { days: "Sun", hours: "Closed" },
  ],
  website: "apexclimate.climvia.com",
} as const;

export const currentUser = {
  name: "Alex Morgan",
  role: "Operations Lead",
} as const;

/**
 * The post-#PAY-1008 baseline the audit board locks. The Overview derives its payment totals from the financial
 * records (data/financials), which must equal these at the canonical state; a test checks it.
 */
export const overviewMetrics = {
  bookings: 24,
  completedJobs: 18,
  /** USD */
  totalInvoiced: 6240,
  /** USD, excludes voided payments */
  paymentsReceived: 2130,
  /** Count of recorded, non-voided payments */
  recordedPayments: 7,
} as const;

/** "Austin, TX 78741" */
export function formatCityStateZip(address: { city: string; state: string; postalCode: string }): string {
  return `${address.city}, ${address.state} ${address.postalCode}`;
}

/** Business timezone. Operational times are business-local wall-clock; Settings will formalize this later. */
export const BUSINESS_TIME_ZONE = "America/Chicago";

/**
 * Structured form of `business.hours` for scheduling (slot availability, closed days).
 * Index 0 = Sunday. A test asserts this stays consistent with the display strings above.
 */
export const businessHoursByWeekday: Readonly<Record<number, { open: string; close: string } | null>> = {
  0: null,
  1: { open: "07:30", close: "18:00" },
  2: { open: "07:30", close: "18:00" },
  3: { open: "07:30", close: "18:00" },
  4: { open: "07:30", close: "18:00" },
  5: { open: "07:30", close: "18:00" },
  6: { open: "08:00", close: "14:00" },
};

/**
 * The prototype's fixed clock. The approved Stitch screens are set on Friday, October 25, 2024, so
 * "today" in every operational screen is this date, never the real one.
 */
export const PROTOTYPE_TODAY = "2024-10-25";
/** Business-local timestamp stamped on demo records created during a session (confirmations, new bookings). */
export const PROTOTYPE_NOW = "2024-10-25T10:45";
