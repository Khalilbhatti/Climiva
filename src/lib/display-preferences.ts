/**
 * How dates and times are written, as chosen in Settings → Workspace preferences.
 *
 * The formatters in lib/format and lib/dates are plain functions called from hundreds of places (including code that
 * renders on the server), so the saved choice is held here and read by them. Only the Settings provider ever writes it,
 * and only in the browser: the server always renders the defaults, which is also what the first client render uses, so
 * hydration never disagrees. A reload restores the defaults along with every other demo edit.
 *
 * Everything is formatted by hand (no Intl, no system clock, no browser timezone) so server and client always agree.
 */

export type DateFormatId = "mdy-short" | "mdy-numeric" | "dmy-numeric" | "ymd-iso";
export type TimeFormatId = "12h" | "24h";

export type DisplayPreferences = { dateFormat: DateFormatId; timeFormat: TimeFormatId };

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = { dateFormat: "mdy-short", timeFormat: "12h" };

let current: DisplayPreferences = DEFAULT_DISPLAY_PREFERENCES;

export function getDisplayPreferences(): DisplayPreferences {
  return current;
}

export function setDisplayPreferences(next: DisplayPreferences): void {
  current = next;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad = (value: number) => String(value).padStart(2, "0");

/** A date with its year in the chosen style. `month` is 0–11. */
export function formatDateParts(year: number, month: number, day: number, format: DateFormatId = current.dateFormat): string {
  switch (format) {
    case "mdy-numeric":
      return `${pad(month + 1)}/${pad(day)}/${year}`;
    case "dmy-numeric":
      return `${pad(day)}/${pad(month + 1)}/${year}`;
    case "ymd-iso":
      return `${year}-${pad(month + 1)}-${pad(day)}`;
    default:
      return `${MONTHS_SHORT[month]} ${day}, ${year}`;
  }
}

/** A date without its year in the chosen style. `month` is 0–11. */
export function formatMonthDayParts(month: number, day: number, format: DateFormatId = current.dateFormat): string {
  switch (format) {
    case "mdy-numeric":
      return `${pad(month + 1)}/${pad(day)}`;
    case "dmy-numeric":
      return `${pad(day)}/${pad(month + 1)}`;
    case "ymd-iso":
      return `${pad(month + 1)}-${pad(day)}`;
    default:
      return `${MONTHS_SHORT[month]} ${day}`;
  }
}

/** A time of day in the chosen style: "1:30 PM" or "13:30". */
export function formatClockParts(hours: number, minutes: number, format: TimeFormatId = current.timeFormat): string {
  if (format === "24h") return `${pad(hours)}:${pad(minutes)}`;
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad(minutes)} ${hours < 12 ? "AM" : "PM"}`;
}
