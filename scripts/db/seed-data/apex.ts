/**
 * Apex Climate Heating & Air: the approved canonical business record, user and weekly hours.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY (nothing in src/ imports this file, and a test holds the line: e2e/tenant-fixture-boundary.spec.ts).
 * The seed writes these values to PostgreSQL for the Apex organization, and tests use them as the expected values. The application
 * never reads them: a signed-in business gets its name, phone, hours and person from its own rows, and a visitor gets them from the
 * public projection of those rows. Do not import this file from anything under src/, and do not retype these values there.
 *
 * Source: design-reference/stitch/climvia_development_handoff ("Canonical Business Record", "Locked Representative Fixtures") and the
 * Phase 1 brief. Northstar's equivalent is northstar.ts (and its organization record in seed-lib.ts).
 */
import { DEFAULT_ACCENT, getTimeZone, type SettingsData } from "@/data/settings";

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

/** Business timezone. Operational times are business-local wall-clock. */
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
 * What Settings holds for the Apex business, built from the records above, so a test of the Settings rules starts from the same
 * business the database does. Test baseline only: the application builds each business's Settings from that business's own rows
 * (src/server/workspace.ts). The logo is not part of it: it is an Asset (a row and a stored file) that the seed stores for Apex from
 * APEX_CREST_FILE (seed-lib ensureSampleLogo), so a test of the Settings rules does not start from a file that may not exist.
 */
export const apexSettings: SettingsData = {
  business: {
    name: business.name,
    phone: business.phone,
    email: business.email,
    address: { ...business.address },
  },
  hours: businessHoursByWeekday,
  branding: { logo: null, accent: DEFAULT_ACCENT },
  preferences: {
    timeZone: getTimeZone(BUSINESS_TIME_ZONE).id,
    currency: "USD",
    dateFormat: "mdy-short",
    timeFormat: "12h",
  },
  profile: { name: currentUser.name, role: currentUser.role },
};

/** The name the Apex reference crest is shown under in Settings (the seed stores it as the Apex logo). */
export const APEX_CREST_FILE_NAME = "apex-climate-crest-revised.svg";
