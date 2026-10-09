/**
 * Server-side input checks for anything a browser sends to a server action.
 *
 * A server action is a public endpoint: its arguments are whatever the caller chose to send, whatever the TypeScript
 * signature says. Every action parses its input here first, and re-runs the same rules the forms use
 * (`lib/settings-state`) so the browser's checks are a convenience and these are the enforcement.
 *
 * Pure functions: no database, no framework.
 */
import {
  DATE_FORMATS,
  HOUR_OPTIONS,
  TIME_FORMATS,
  TIME_ZONES,
  US_STATES,
  type BusinessInfo,
  type DayHours,
  type Preferences,
  type WeeklyHours,
} from "@/data/settings";
import { normalizeBusiness, validateBusiness, validateHours, validateProfileName } from "./settings-state";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; fields?: Record<string, string> };

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A string no longer than `max`; anything else (a number, an object, a megabyte of text) is refused. */
export function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

export function parseBusiness(input: unknown): Parsed<BusinessInfo> {
  if (!isRecord(input) || !isRecord(input.address)) return fail("The business details were not understood.");
  const address = input.address;
  const name = text(input.name, 200);
  const phone = text(input.phone, 60);
  const email = text(input.email, 200);
  const street = text(address.street, 200);
  const city = text(address.city, 120);
  const state = text(address.state, 2);
  const postalCode = text(address.postalCode, 10);
  if (name === undefined || phone === undefined || email === undefined || street === undefined || city === undefined || state === undefined || postalCode === undefined) {
    return fail("The business details were not understood.");
  }
  const business: BusinessInfo = { name, phone, email, address: { street, city, state, postalCode } };
  const errors = validateBusiness(business);
  if (name.trim().length > 80) errors.name = "Keep the business name to 80 characters or fewer.";
  if (state && !(US_STATES as readonly string[]).includes(state)) errors.state = "Select a state.";
  if (Object.keys(errors).length > 0) return fail("Check the highlighted fields.", errors);
  return { ok: true, value: normalizeBusiness(business) };
}

const CLOCK = new Set<string>(HOUR_OPTIONS);

function parseDay(value: unknown): DayHours | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const open = text(value.open, 5);
  const close = text(value.close, 5);
  if (!open || !close || !CLOCK.has(open) || !CLOCK.has(close)) return undefined;
  return { open, close };
}

export function parseHours(input: unknown): Parsed<WeeklyHours> {
  if (!isRecord(input)) return fail("The business hours were not understood.");
  const week: Record<number, DayHours> = {};
  for (let day = 0; day <= 6; day++) {
    const parsed = parseDay(input[String(day)]);
    if (parsed === undefined) return fail("The business hours were not understood.");
    week[day] = parsed;
  }
  const errors = validateHours(week);
  if (Object.keys(errors).length > 0) return fail("Closing time must be after opening time.", Object.fromEntries(Object.entries(errors).map(([day, message]) => [`day${day}`, message])));
  return { ok: true, value: week };
}

export function parsePreferences(input: unknown): Parsed<Preferences> {
  if (!isRecord(input)) return fail("The preferences were not understood.");
  const timeZone = TIME_ZONES.find((zone) => zone.id === input.timeZone)?.id;
  const dateFormat = DATE_FORMATS.find((format) => format.id === input.dateFormat)?.id;
  const timeFormat = TIME_FORMATS.find((format) => format.id === input.timeFormat)?.id;
  if (!timeZone || !dateFormat || !timeFormat || input.currency !== "USD") return fail("The preferences were not understood.");
  return { ok: true, value: { timeZone, currency: "USD", dateFormat, timeFormat } };
}

export function parseProfileName(input: unknown): Parsed<string> {
  const name = text(input, 200);
  if (name === undefined) return fail("Enter your full name.");
  const problem = validateProfileName(name);
  if (problem) return fail(problem, { name: problem });
  return { ok: true, value: name.trim() };
}

/* ───────────────────────── slugs ───────────────────────── */

/** Words that would collide with routes or look official. A business that asks for one gets a suffix. */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "assets", "auth", "billing", "climvia", "help", "login", "logout", "mail", "onboarding",
  "settings", "signup", "static", "status", "support", "www",
]);

/** "Apex Climate Heating & Air" → "apex-climate-heating-air". Always matches the database's slug check. */
export function slugify(name: string, fallback = "workspace"): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  const slug = base || fallback;
  return RESERVED_SLUGS.has(slug) ? `${slug}-co` : slug;
}

/** The candidates to try, in order, when a slug is taken: "x", "x-2", "x-3" … then a random tail. */
export function slugCandidates(base: string, randomTail: () => string): string[] {
  const candidates = [base];
  for (let n = 2; n <= 6; n++) candidates.push(`${base}-${n}`.slice(0, 63));
  candidates.push(`${base.slice(0, 55)}-${randomTail()}`);
  return candidates;
}

/* ───────────────────────── new workspace ───────────────────────── */

export function parseNewOrganization(input: unknown): Parsed<{ business: BusinessInfo; preferences: Preferences; hours: WeeklyHours }> {
  if (!isRecord(input)) return fail("The workspace details were not understood.");
  const business = parseBusiness(input.business);
  if (!business.ok) return business;
  const preferences = parsePreferences(input.preferences);
  if (!preferences.ok) return preferences;
  const hours = parseHours(input.hours);
  if (!hours.ok) return hours;
  return { ok: true, value: { business: business.value, preferences: preferences.value, hours: hours.value } };
}
