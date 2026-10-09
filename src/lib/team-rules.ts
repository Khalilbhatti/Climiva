/**
 * What a browser may send to change the Team, checked on the server. Pure functions: no database, no framework.
 *
 * These check SHAPE and the rules that need nothing else (a name is present, a time is a time). The rules that depend on
 * the business's records (the role exists, the Service exists, the email is not already used) are checked by the
 * server action against the data it loads under the verified organization.
 */
import {
  MODULE_IDS,
  PERMISSION_LEVELS,
  type Availability,
  type AvailabilityMode,
  type DayHours,
  type Permissions,
  type TeamMember,
  type UnavailablePeriod,
  type WeeklyHours,
} from "@/data/team";
import { isRecord, text, type Parsed } from "./validation";

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+().\s-]{7,30}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const REFERENCE = /^[a-z0-9-]{1,60}$/;
const AVAILABILITY_MODES: readonly AvailabilityMode[] = ["business-hours", "custom", "not-set"];
const LEVELS = new Set<string>(PERMISSION_LEVELS.map((level) => level.id));

export type NewMember = {
  name: string;
  email: string;
  phone?: string;
  roleId: string;
  fieldAssignable: boolean;
  availabilityMode: AvailabilityMode;
};

export function parseNewMember(input: unknown): Parsed<NewMember> {
  if (!isRecord(input)) return fail("The team member details were not understood.");
  const name = text(input.name, 200)?.trim();
  const email = text(input.email, 200)?.trim();
  const phone = input.phone === undefined || input.phone === "" ? "" : text(input.phone, 60)?.trim();
  const roleId = text(input.roleId, 80);
  const mode = AVAILABILITY_MODES.find((candidate) => candidate === input.availabilityMode);
  if (name === undefined || email === undefined || phone === undefined || !roleId || !mode || typeof input.fieldAssignable !== "boolean") return fail("The team member details were not understood.");
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Enter the person's name.";
  else if (name.length > 80) errors.name = "Keep the name to 80 characters or fewer.";
  if (!email) errors.email = "Enter an email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address, like name@example.com.";
  if (phone && !PHONE_PATTERN.test(phone)) errors.phone = "Enter a phone number, for example (555) 123-4567.";
  if (Object.keys(errors).length > 0) return fail(Object.values(errors)[0], errors);
  return { ok: true, value: { name, email, phone: phone || undefined, roleId, fieldAssignable: input.fieldAssignable, availabilityMode: mode } };
}

export function parsePermissions(input: unknown): Parsed<Permissions> {
  if (!isRecord(input)) return fail("The permissions were not understood.");
  const permissions: Record<string, string> = {};
  for (const id of MODULE_IDS) {
    const level = input[id];
    if (typeof level !== "string" || !LEVELS.has(level)) return fail("The permissions were not understood.");
    permissions[id] = level;
  }
  if (Object.keys(input).length !== MODULE_IDS.length) return fail("The permissions were not understood.");
  return { ok: true, value: permissions as unknown as Permissions };
}

function parseDay(value: unknown): DayHours | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return undefined;
  const start = text(value.start, 5);
  const end = text(value.end, 5);
  if (!start || !end || !CLOCK.test(start) || !CLOCK.test(end)) return undefined;
  const day: DayHours = { enabled: value.enabled, start, end };
  if (value.breakStart !== undefined || value.breakEnd !== undefined) {
    const breakStart = text(value.breakStart, 5);
    const breakEnd = text(value.breakEnd, 5);
    if (!breakStart || !breakEnd || !CLOCK.test(breakStart) || !CLOCK.test(breakEnd)) return undefined;
    day.breakStart = breakStart;
    day.breakEnd = breakEnd;
  }
  return day;
}

export function parseAvailability(input: unknown): Parsed<Availability> {
  const bad = fail("The availability was not understood.");
  if (!isRecord(input) || !isRecord(input.weekly) || !Array.isArray(input.unavailable)) return bad;
  const mode = AVAILABILITY_MODES.find((candidate) => candidate === input.mode);
  if (!mode || input.unavailable.length > 60) return bad;

  const weekly: Record<number, DayHours> = {};
  for (let day = 0; day <= 6; day++) {
    const parsed = parseDay(input.weekly[String(day)]);
    if (!parsed) return bad;
    // Only a working day has to make sense; a day that is off keeps whatever times it had.
    if (parsed.enabled && parsed.end <= parsed.start) return fail("A working day must end after it starts.");
    if (parsed.enabled && parsed.breakStart && parsed.breakEnd && (parsed.breakEnd <= parsed.breakStart || parsed.breakStart < parsed.start || parsed.breakEnd > parsed.end)) {
      return fail("A break must fall inside the working day.");
    }
    weekly[day] = parsed;
  }

  const unavailable: UnavailablePeriod[] = [];
  for (const item of input.unavailable) {
    if (!isRecord(item)) return bad;
    const id = text(item.id, 60);
    const title = text(item.title, 120)?.trim();
    const reason = text(item.reason, 120)?.trim();
    const startDate = text(item.startDate, 10);
    const endDate = text(item.endDate, 10);
    if (!id || !REFERENCE.test(id) || !title || !reason || !startDate || !endDate || !DATE.test(startDate) || !DATE.test(endDate)) return bad;
    if (endDate < startDate) return fail("A period cannot end before it starts.");
    const period: UnavailablePeriod = { id, title, reason, startDate, endDate };
    if (item.startTime !== undefined || item.endTime !== undefined) {
      const startTime = text(item.startTime, 5);
      const endTime = text(item.endTime, 5);
      if (!startTime || !endTime || !CLOCK.test(startTime) || !CLOCK.test(endTime)) return bad;
      period.startTime = startTime;
      period.endTime = endTime;
    }
    unavailable.push(period);
  }
  if (new Set(unavailable.map((period) => period.id)).size !== unavailable.length) return bad;
  return { ok: true, value: { mode, weekly: weekly as WeeklyHours, unavailable } };
}

export function parseServiceEligibility(mode: unknown, ids: unknown): Parsed<{ mode: TeamMember["serviceMode"]; serviceIds: string[] }> {
  if ((mode !== "all" && mode !== "selected") || !Array.isArray(ids) || ids.length > 200 || !ids.every((id) => typeof id === "string" && REFERENCE.test(id))) {
    return fail("The assigned services were not understood.");
  }
  return { ok: true, value: { mode, serviceIds: [...new Set(ids as string[])] } };
}

export const ROLE_NAME_MAX = 60;

export function parseNewRole(input: unknown): Parsed<{ name: string; description: string; permissions: Permissions }> {
  if (!isRecord(input)) return fail("The role details were not understood.");
  const name = text(input.name, 200)?.trim();
  const description = input.description === undefined ? "" : text(input.description, 500)?.trim();
  const permissions = parsePermissions(input.permissions);
  if (name === undefined || description === undefined || !permissions.ok) return fail("The role details were not understood.");
  if (!name) return fail("Enter a role name.", { name: "Enter a role name." });
  if (name.length > ROLE_NAME_MAX) return fail(`Keep the role name to ${ROLE_NAME_MAX} characters or fewer.`, { name: "Too long." });
  return { ok: true, value: { name, description, permissions: permissions.value } };
}

export function parseRolePatch(input: unknown): Parsed<{ name?: string; description?: string; permissions?: Permissions }> {
  if (!isRecord(input)) return fail("The role details were not understood.");
  const patch: { name?: string; description?: string; permissions?: Permissions } = {};
  if (input.name !== undefined) {
    const name = text(input.name, 200)?.trim();
    if (name === undefined) return fail("The role details were not understood.");
    if (!name) return fail("Enter a role name.", { name: "Enter a role name." });
    if (name.length > ROLE_NAME_MAX) return fail(`Keep the role name to ${ROLE_NAME_MAX} characters or fewer.`, { name: "Too long." });
    patch.name = name;
  }
  if (input.description !== undefined) {
    const description = text(input.description, 500)?.trim();
    if (description === undefined) return fail("The role details were not understood.");
    patch.description = description;
  }
  if (input.permissions !== undefined) {
    const permissions = parsePermissions(input.permissions);
    if (!permissions.ok) return permissions;
    patch.permissions = permissions.value;
  }
  return { ok: true, value: patch };
}
