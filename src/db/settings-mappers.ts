/**
 * Conversions between database rows and the Settings types the screens already use (`@/data/settings`).
 * Pure functions, no connection: the seed, the server layer and the tests all use this one definition.
 *
 * The UI's address has one street line; the table has two. The street goes in `address_line1` and `address_line2`
 * is left empty, so nothing the UI shows or edits is lost or split.
 */
import { getTimeZone, type BusinessInfo, type DayHours, type Preferences, type WeeklyHours } from "@/data/settings";
import type { DateFormatId, TimeFormatId } from "@/lib/display-preferences";
import type { BusinessHoursRow } from "./schema/business-hours";
import type { OrganizationRow } from "./schema/organizations";

/** The country every business has until international addresses are supported. */
export const DEFAULT_COUNTRY = "US";

export function businessFromOrganization(row: OrganizationRow): BusinessInfo {
  return {
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: {
      street: row.addressLine1 ?? "",
      city: row.city ?? "",
      state: row.stateRegion ?? "",
      postalCode: row.postalCode ?? "",
    },
  };
}

export function preferencesFromOrganization(row: OrganizationRow): Preferences {
  return {
    timeZone: getTimeZone(row.timezone).id,
    currency: "USD",
    dateFormat: row.dateFormat as DateFormatId,
    timeFormat: row.timeFormat as TimeFormatId,
  };
}

/** The columns a Business information save writes. */
export function organizationValuesFromBusiness(business: BusinessInfo) {
  return {
    name: business.name,
    phone: business.phone,
    email: business.email,
    addressLine1: business.address.street,
    addressLine2: null,
    city: business.address.city,
    stateRegion: business.address.state,
    postalCode: business.address.postalCode,
    country: DEFAULT_COUNTRY,
  };
}

export function organizationValuesFromPreferences(preferences: Preferences) {
  return {
    timezone: preferences.timeZone,
    currency: preferences.currency,
    dateFormat: preferences.dateFormat,
    timeFormat: preferences.timeFormat,
  };
}

/* ───────────────────────── business hours ───────────────────────── */

const toClock = (value: string | null): string | null => (value ? value.slice(0, 5) : null);

/** "HH:MM:SS" from the database to the app's "HH:mm". A day with no row is closed. */
export function weeklyHoursFromRows(rows: readonly Pick<BusinessHoursRow, "dayOfWeek" | "isOpen" | "opensAt" | "closesAt">[]): WeeklyHours {
  const week: Record<number, DayHours> = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  for (const row of rows) {
    const open = toClock(row.opensAt);
    const close = toClock(row.closesAt);
    week[row.dayOfWeek] = row.isOpen && open && close ? { open, close } : null;
  }
  return week;
}

/** Seven rows, Sunday to Saturday, ready to insert for an organization. */
export function hoursRowsFromWeekly(organizationId: string, hours: WeeklyHours) {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => {
    const value = hours[day];
    return {
      organizationId,
      dayOfWeek: day,
      isOpen: value !== null && value !== undefined,
      opensAt: value ? value.open : null,
      closesAt: value ? value.close : null,
    };
  });
}
