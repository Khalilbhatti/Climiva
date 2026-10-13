/**
 * Settings: the editable business identity and workspace preferences.
 *
 * There is no second dataset and no business in this file. Each business's Settings are built from that business's own rows
 * (src/server/workspace.ts), so a screen that reads Settings and a screen that reads those rows can never disagree. Edits live in
 * components/settings/SettingsProvider until they are saved; nothing here is mutated. This file holds the types and the
 * application-owned lists (time zones, formats, swatches) that every business shares, and ships to the browser; the Apex
 * business's values are seed and test data (scripts/db/seed-data/apex.ts) and are not part of it.
 *
 * Settings owns only what a business sets once for the whole workspace: Business information, Business hours,
 * Branding, Workspace preferences and My profile. It does not own Services (the catalog), Team (people, roles and
 * each person's availability), the Website (pages and domains) or the Marketplace listing; those read these values.
 *
 * Sources: design-reference/stitch/ settings_* screens. Conflicts are listed in docs/stitch-screen-map.md §12.
 */
import type { DateFormatId, TimeFormatId } from "@/lib/display-preferences";
import { formatDateParts } from "@/lib/display-preferences";

/* ───────────────────────── business information ───────────────────────── */

export type BusinessAddress = { street: string; city: string; state: string; postalCode: string };

export type BusinessInfo = {
  name: string;
  phone: string;
  email: string;
  address: BusinessAddress;
};

/** The 50 states and DC, for the address's State field. */
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

/* ───────────────────────── business hours ───────────────────────── */

/** "HH:mm" in business-local time, or null for a closed day. */
export type DayHours = { open: string; close: string } | null;

/** Index 0 = Sunday … 6 = Saturday, the same indexing as lib/dates `weekdayIndex`. */
export type WeeklyHours = Readonly<Record<number, DayHours>>;

/** The order the editor and every summary list days in. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_ABBREVIATIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Opening and closing times are offered in half-hour steps from 5:00 AM to 11:00 PM. */
export const HOUR_OPTIONS: readonly string[] = Array.from({ length: 37 }, (_, index) => {
  const minutes = 5 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** What a closed day is given when it is switched back on. */
export const DEFAULT_OPEN_HOURS = { open: "09:00", close: "17:00" } as const;

/* ───────────────────────── branding ───────────────────────── */

/**
 * The business logo: one of the business's own stored files (an Asset, src/db/schema/assets), reached at `src`, its public address on this
 * site. `fileName` is what the person called the file, shown in Settings. The picture itself is not here and is never a data URL or a browser
 * object URL; a page that draws the logo asks the server, which reads the business's Branding when the page is drawn.
 */
export type BrandLogo = { fileName: string; src: string };

export type Branding = {
  logo: BrandLogo | null;
  /**
   * "#RRGGBB", or null to keep the Climvia teal. The base colour of the customer-facing frames inside the workspace (the Website picture, the
   * Builder canvas, the previews); a Site's own Theme accent is drawn over it and is never replaced by it. The admin shell never changes.
   */
  accent: string | null;
};

/** The limits of a profile photo (a session-only picture). A business logo's rules are lib/asset-rules. */
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;
export const LOGO_TYPES = ["image/svg+xml", "image/png", "image/jpeg"] as const;
/** The Climvia teal the whole product is already drawn in; saving it as the accent changes nothing visible. */
export const DEFAULT_ACCENT = "#0D5C63";
export const ACCENT_SWATCHES = [DEFAULT_ACCENT, "#0A494E", "#17766B", "#8B3A1E"] as const;

/* ───────────────────────── workspace preferences ───────────────────────── */

export const TIME_ZONES = [
  { id: "America/New_York", label: "America/New_York (Eastern Time)", short: "Eastern Time (ET)" },
  { id: "America/Chicago", label: "America/Chicago (Central Time)", short: "Central Time (CT)" },
  { id: "America/Denver", label: "America/Denver (Mountain Time)", short: "Mountain Time (MT)" },
  { id: "America/Phoenix", label: "America/Phoenix (Mountain Time – No DST)", short: "Mountain Time (MT)" },
  { id: "America/Los_Angeles", label: "America/Los_Angeles (Pacific Time)", short: "Pacific Time (PT)" },
  { id: "America/Anchorage", label: "America/Anchorage (Alaska Time)", short: "Alaska Time (AKT)" },
  { id: "Pacific/Honolulu", label: "Pacific/Honolulu (Hawaii Time)", short: "Hawaii Time (HT)" },
] as const;

export type TimeZoneId = (typeof TIME_ZONES)[number]["id"];

export const getTimeZone = (id: string) => TIME_ZONES.find((zone) => zone.id === id) ?? TIME_ZONES[1];

export const DATE_FORMATS: readonly { id: DateFormatId; pattern: string }[] = [
  { id: "mdy-short", pattern: "MMM D, YYYY" },
  { id: "mdy-numeric", pattern: "MM/DD/YYYY" },
  { id: "dmy-numeric", pattern: "DD/MM/YYYY" },
  { id: "ymd-iso", pattern: "YYYY-MM-DD" },
];

/** The fixed sample date Stitch uses to show a format: Oct 30, 2024. */
export const dateFormatExample = (id: DateFormatId) => formatDateParts(2024, 9, 30, id);

export const TIME_FORMATS: readonly { id: TimeFormatId; title: string; example: string }[] = [
  { id: "12h", title: "12-hour", example: "e.g., 9:00 AM" },
  { id: "24h", title: "24-hour", example: "e.g., 09:00" },
];

export type Preferences = {
  timeZone: TimeZoneId;
  /** Read-only: the workspace is USD. */
  currency: "USD";
  dateFormat: DateFormatId;
  timeFormat: TimeFormatId;
};

/* ───────────────────────── my profile ───────────────────────── */

/** Display information only. There is no sign-in, email address or password here; the role comes from the Team record. */
export type Profile = { name: string; role: string; photo?: string };

/* ───────────────────────── the whole ───────────────────────── */

export type SettingsData = {
  business: BusinessInfo;
  hours: WeeklyHours;
  branding: Branding;
  preferences: Preferences;
  profile: Profile;
};
