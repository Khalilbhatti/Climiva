/**
 * Pure rules for Settings: validation, tidying, and the transitions that save a section. Nothing here reads a clock or
 * a browser API, and nothing mutates what it is given; the provider keeps the result in memory only.
 */
import {
  WEEK_ORDER,
  WEEKDAY_ABBREVIATIONS,
  type Branding,
  type BusinessInfo,
  type DayHours,
  type Preferences,
  type Profile,
  type SettingsData,
  type WeeklyHours,
} from "@/data/settings";
import { timeToMinutes } from "./dates";
import { formatClockParts, getDisplayPreferences, type TimeFormatId } from "./display-preferences";

/* ───────────────────────── business information ───────────────────────── */

export type BusinessErrors = Partial<Record<"name" | "phone" | "email" | "street" | "city" | "state" | "postalCode", string>>;

/** "5550100100" or "+1 555 010 0100" → "(555) 010-0100"; undefined when it is not a ten-digit US number. */
export function normalizePhone(input: string): string | undefined {
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return undefined;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

export function validateBusiness(business: BusinessInfo): BusinessErrors {
  const errors: BusinessErrors = {};
  if (!business.name.trim()) errors.name = "Enter your business name.";
  if (!normalizePhone(business.phone)) errors.phone = "Enter a ten-digit phone number, for example (555) 010-0100.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email.trim())) errors.email = "Enter a valid email address.";
  if (!business.address.street.trim()) errors.street = "Enter a street address.";
  if (!business.address.city.trim()) errors.city = "Enter a city.";
  if (!business.address.state) errors.state = "Select a state.";
  if (!/^\d{5}$/.test(business.address.postalCode.trim())) errors.postalCode = "Enter a 5-digit ZIP code.";
  return errors;
}

/** The record as it is stored: trimmed, with the phone number in one format. */
export function normalizeBusiness(business: BusinessInfo): BusinessInfo {
  return {
    name: business.name.trim(),
    phone: normalizePhone(business.phone) ?? business.phone.trim(),
    email: business.email.trim(),
    address: {
      street: business.address.street.trim(),
      city: business.address.city.trim(),
      state: business.address.state,
      postalCode: business.address.postalCode.trim(),
    },
  };
}

export function isSameBusiness(a: BusinessInfo, b: BusinessInfo): boolean {
  return (
    a.name === b.name &&
    a.phone === b.phone &&
    a.email === b.email &&
    a.address.street === b.address.street &&
    a.address.city === b.address.city &&
    a.address.state === b.address.state &&
    a.address.postalCode === b.address.postalCode
  );
}

/* ───────────────────────── business hours ───────────────────────── */

export type HoursRow = { days: string; hours: string };

/** "7:30 AM–6:00 PM" (or "07:30–18:00" in 24-hour time), "Closed" for a closed day. */
export function formatDayHours(day: DayHours, format: TimeFormatId = getDisplayPreferences().timeFormat): string {
  if (!day) return "Closed";
  const at = (time: string) => formatClockParts(Math.floor(timeToMinutes(time) / 60), timeToMinutes(time) % 60, format);
  return `${at(day.open)}–${at(day.close)}`;
}

/** Monday-first rows with consecutive days that share hours joined: "Mon–Fri", "Sat", "Sun". */
export function summarizeHours(hours: WeeklyHours, format?: TimeFormatId): HoursRow[] {
  const groups: { first: number; last: number; text: string }[] = [];
  WEEK_ORDER.forEach((day, position) => {
    const text = formatDayHours(hours[day], format);
    const previous = groups[groups.length - 1];
    if (previous && previous.text === text) previous.last = position;
    else groups.push({ first: position, last: position, text });
  });
  return groups.map((group) => ({
    days:
      group.first === group.last
        ? WEEKDAY_ABBREVIATIONS[WEEK_ORDER[group.first]]
        : `${WEEKDAY_ABBREVIATIONS[WEEK_ORDER[group.first]]}–${WEEKDAY_ABBREVIATIONS[WEEK_ORDER[group.last]]}`,
    hours: group.text,
  }));
}

/** Per-day error text; a day that is closed, or whose closing time follows its opening time, has none. */
export function validateHours(hours: WeeklyHours): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const day of WEEK_ORDER) {
    const value = hours[day];
    if (value && timeToMinutes(value.close) <= timeToMinutes(value.open)) errors[day] = "Closing time must be after opening time.";
  }
  return errors;
}

export function isSameHours(a: WeeklyHours, b: WeeklyHours): boolean {
  return WEEK_ORDER.every((day) => a[day]?.open === b[day]?.open && a[day]?.close === b[day]?.close);
}

/** Tuesday to Friday take Monday's hours (or its closed state). Saturday and Sunday are left alone. */
export function copyMondayToWeekdays(hours: WeeklyHours): WeeklyHours {
  const monday = hours[1];
  const next: Record<number, DayHours> = { ...hours };
  for (const day of [2, 3, 4, 5]) next[day] = monday ? { ...monday } : null;
  return next;
}

/* ───────────────────────── branding ───────────────────────── */

const luminance = (hex: string) => {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

/** "0d5c63" or "#0d5c63" → "#0D5C63"; empty → null (no accent); anything else → undefined. */
export function normalizeAccent(input: string): string | null | undefined {
  const value = input.trim();
  if (value === "") return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  return match ? `#${match[1].toUpperCase()}` : undefined;
}

/** White text must stay readable on the accent, because customer-facing buttons use it as their background. */
export function validateAccent(input: string): string | undefined {
  const accent = normalizeAccent(input);
  if (accent === undefined) return "Enter a 6-digit hex colour such as #0D5C63.";
  if (accent !== null && 1.05 / (luminance(accent) + 0.05) < 4.5) return "Choose a darker colour so white button text stays readable.";
  return undefined;
}

/* ───────────────────────── my profile ───────────────────────── */

export function validateProfileName(name: string): string | undefined {
  if (!name.trim()) return "Enter your full name.";
  if (name.trim().length > 60) return "Keep your name to 60 characters or fewer.";
  return undefined;
}

export function isSameProfile(a: Profile, b: Profile): boolean {
  return a.name === b.name && a.photo === b.photo;
}

/* ───────────────────────── saving a section ───────────────────────── */

export const saveBusiness = (settings: SettingsData, business: BusinessInfo): SettingsData => ({ ...settings, business: normalizeBusiness(business) });
export const saveHours = (settings: SettingsData, hours: WeeklyHours): SettingsData => ({ ...settings, hours });
export const saveBranding = (settings: SettingsData, branding: Branding): SettingsData => ({ ...settings, branding });
export const savePreferences = (settings: SettingsData, preferences: Preferences): SettingsData => ({ ...settings, preferences });

/** The role is the Team record's: saving the profile changes the display name and photo only. */
export const saveProfile = (settings: SettingsData, profile: Profile): SettingsData => ({
  ...settings,
  profile: { ...settings.profile, name: profile.name.trim(), photo: profile.photo },
});
