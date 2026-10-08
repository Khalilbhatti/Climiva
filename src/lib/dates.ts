/**
 * Deterministic date/time helpers for operational records.
 *
 * Dates are "YYYY-MM-DD" and times are "HH:mm" (24-hour), both in the business's local time
 * (Austin, America/Chicago). Nothing here reads the system clock, the browser timezone or Intl, so
 * server rendering, the browser and tests always agree. The date and time style is the saved Settings preference
 * (lib/display-preferences); the stored values are never converted.
 */

import { formatClockParts, formatDateParts, formatMonthDayParts, getDisplayPreferences } from "./display-preferences";

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function toUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const next = toUtc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return fromUtc(next);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayIndex(date: string): WeekdayIndex {
  return toUtc(date).getUTCDay() as WeekdayIndex;
}

/** The Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const offset = (weekdayIndex(date) + 6) % 7;
  return addDays(date, -offset);
}

/** Monday through Sunday. */
export function weekDates(date: string): string[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function isValidDate(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;
}

/** "Fri" */
export function formatWeekday(date: string): string {
  return WEEKDAYS_SHORT[weekdayIndex(date)];
}

/** "Oct 25" (or "10/25", "25/10", "10-25" per the saved preference) */
export function formatMonthDay(date: string): string {
  const parsed = toUtc(date);
  return formatMonthDayParts(parsed.getUTCMonth(), parsed.getUTCDate());
}

/** "Fri, Oct 25" */
export function formatWeekdayDate(date: string): string {
  return `${formatWeekday(date)}, ${formatMonthDay(date)}`;
}

/** "Friday, October 25, 2024" (the weekday, then the date in the saved style, when that style is numeric) */
export function formatLongDate(date: string): string {
  const parsed = toUtc(date);
  const weekday = WEEKDAYS_LONG[parsed.getUTCDay()];
  if (getDisplayPreferences().dateFormat !== "mdy-short") {
    return `${weekday}, ${formatDateParts(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())}`;
  }
  return `${weekday}, ${MONTHS_LONG[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

/** "Oct 21 – Oct 27, 2024" (or "Oct 28 – Nov 3, 2024", or across years) */
export function formatWeekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const start = toUtc(weekStart);
  const last = toUtc(end);
  if (getDisplayPreferences().dateFormat !== "mdy-short") {
    return `${formatDateParts(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())} – ${formatDateParts(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate())}`;
  }
  const startYear = start.getUTCFullYear();
  const endYear = last.getUTCFullYear();
  const left = startYear === endYear ? formatMonthDay(weekStart) : `${formatMonthDay(weekStart)}, ${startYear}`;
  return `${left} – ${formatMonthDay(end)}, ${endYear}`;
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** formatTime("13:30") → "1:30 PM" (or "13:30" when the workspace uses 24-hour time) */
export function formatTime(time: string): string {
  const minutes = timeToMinutes(time);
  return formatClockParts(Math.floor(minutes / 60), minutes % 60);
}

/** "10:00 AM – 12:00 PM" */
export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** formatDateTime("2024-10-24T09:42") → "Oct 24, 9:42 AM" */
export function formatLocalDateTime(dateTime: string): string {
  const [date, time] = dateTime.split("T");
  return `${formatMonthDay(date)}, ${formatTime(time.slice(0, 5))}`;
}
