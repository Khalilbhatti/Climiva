/**
 * Core business data: rows <-> the shapes the screens already use.
 *
 * The UI types (Customer, Service, TeamMember …) predate the database and stay as they are; this file is the only place that
 * knows how they map to columns. Every public reference (a record's `id` in the UI) is its slug; the database uuids never
 * leave the server. No `server-only` here on purpose: the seed and the tests import it too.
 */
import type { ContactChannel, Customer, CustomerNote, Equipment, Property } from "@/data/customers";
import type { IntakeQuestion, Service, ServicePricing } from "@/data/services";
import type {
  ActivityEntry,
  Availability,
  DayHours,
  Permissions,
  Role,
  TeamMember,
  UnavailablePeriod,
  WeeklyHours,
} from "@/data/team";
import type {
  CustomerNoteRow,
  CustomerPropertyRow,
  CustomerRow,
  EquipmentRow,
  ServiceRow,
  TeamActivityRow,
  TeamMemberRow,
  TeamRoleRow,
} from "./schema";
import { teamMemberAvailability, teamMemberUnavailablePeriods } from "./schema";

type AvailabilityRow = typeof teamMemberAvailability.$inferSelect;
type UnavailableRow = typeof teamMemberUnavailablePeriods.$inferSelect;

const orUndefined = <T,>(value: T | null | undefined): T | undefined => (value === null || value === undefined ? undefined : value);

/** "08:00:00" -> "08:00". PostgreSQL's `time` comes back with seconds; the screens use HH:mm. */
export const hhmm = (time: string | null | undefined): string | undefined => (time ? time.slice(0, 5) : undefined);

/* ───────────────────────── customers ───────────────────────── */

export function propertyFromRow(row: CustomerPropertyRow, customerSlug: string): Property {
  return {
    id: row.slug,
    customerId: customerSlug,
    label: row.label,
    street: row.addressLine2 ? `${row.addressLine1}, ${row.addressLine2}` : row.addressLine1,
    city: row.city,
    state: row.stateRegion,
    postalCode: row.postalCode,
    area: orUndefined(row.area),
    accessInstructions: orUndefined(row.accessInstructions),
    mechanicalAccess: orUndefined(row.mechanicalAccess),
  };
}

export function equipmentFromRow(row: EquipmentRow, propertySlug: string): Equipment {
  return {
    id: row.slug,
    propertyId: propertySlug,
    name: row.name,
    kind: row.kind,
    capacity: orUndefined(row.capacity),
    manufacturer: row.manufacturer,
    model: row.model,
    modelCode: row.modelCode,
    serialNumber: row.serialNumber,
    location: row.location,
    inServiceSince: row.inServiceSince,
    refrigerant: orUndefined(row.refrigerant),
    filter: orUndefined(row.filter),
    status: "Active",
    lastServiced: orUndefined(row.lastServiced as Equipment["lastServiced"] | null),
  };
}

export function customerFromRows(row: CustomerRow, propertySlugs: readonly string[], notes: readonly CustomerNoteRow[]): Customer {
  return {
    id: row.slug,
    name: row.name,
    type: "residential",
    phone: row.phone ?? "",
    email: row.email ?? "",
    preferredContact: row.preferredContact as ContactChannel,
    language: orUndefined(row.language),
    propertyIds: propertySlugs,
    notes: notes.map((note): CustomerNote => ({ body: note.body, updatedOn: note.updatedOn, recordedBy: note.recordedBy })),
    preferences: row.preferences,
    maintenancePlan: orUndefined(row.maintenancePlan as Customer["maintenancePlan"] | null),
    lastService: orUndefined(row.lastService as Customer["lastService"] | null),
    upcoming: orUndefined(row.upcoming as Customer["upcoming"] | null),
  };
}

/* ───────────────────────── services ───────────────────────── */

export function serviceFromRow(row: ServiceRow): Service {
  const amount = row.priceAmount === null ? 0 : Number(row.priceAmount);
  const pricing: ServicePricing =
    row.pricingModel === "free-assessment"
      ? { model: "free-assessment" }
      : row.pricingModel === "fixed-price"
        ? { model: "fixed-price", amount }
        : { model: "diagnostic-fee", amount, label: row.priceLabel ?? "diagnostic fee" };
  return {
    id: row.slug,
    name: row.name,
    category: row.category as Service["category"],
    audience: row.audience as Service["audience"],
    description: row.description,
    internalDescription: orUndefined(row.internalDescription),
    durationMinutes: row.durationMinutes,
    pricing,
    bookingMethod: row.bookingMethod as Service["bookingMethod"],
    visibility: row.visibility as Service["visibility"],
    active: row.isActive,
    displayOrder: row.displayOrder,
    intake: row.intake as readonly IntakeQuestion[],
    checklist: orUndefined(row.checklist),
  };
}

/** The writable columns of a Service. `id`, `organization_id` and the slug are never rewritten by an update. */
export function serviceValues(service: Service) {
  return {
    name: service.name,
    category: service.category,
    audience: [...service.audience],
    description: service.description,
    internalDescription: service.internalDescription ?? null,
    durationMinutes: service.durationMinutes,
    pricingModel: service.pricing.model,
    priceAmount: service.pricing.model === "free-assessment" ? null : service.pricing.amount.toFixed(2),
    priceLabel: service.pricing.model === "diagnostic-fee" ? service.pricing.label : null,
    bookingMethod: service.bookingMethod,
    visibility: service.visibility,
    isActive: service.active,
    displayOrder: service.displayOrder,
    intake: service.intake as IntakeQuestion[],
    checklist: service.checklist ? [...service.checklist] : null,
  };
}

/* ───────────────────────── team ───────────────────────── */

export function roleFromRow(row: TeamRoleRow): Role {
  return {
    id: row.slug,
    name: row.name,
    description: row.description,
    kind: row.kind as Role["kind"],
    ...(row.isProtected ? { protected: true } : {}),
    permissions: row.permissions as Permissions,
  };
}

export function roleValues(role: Role) {
  return {
    name: role.name,
    description: role.description,
    kind: role.kind,
    isProtected: Boolean(role.protected),
    permissions: role.permissions,
  };
}

function weeklyFromRows(rows: readonly AvailabilityRow[]): WeeklyHours {
  const weekly: Record<number, DayHours> = {};
  for (const row of rows) {
    weekly[row.dayOfWeek] = {
      enabled: row.enabled,
      start: hhmm(row.startTime) ?? "08:00",
      end: hhmm(row.endTime) ?? "17:00",
      ...(row.breakStart && row.breakEnd ? { breakStart: hhmm(row.breakStart), breakEnd: hhmm(row.breakEnd) } : {}),
    };
  }
  return weekly;
}

function periodFromRow(row: UnavailableRow): UnavailablePeriod {
  return {
    id: row.ref,
    title: row.title,
    reason: row.reason,
    startDate: row.startDate,
    endDate: row.endDate,
    ...(row.startTime && row.endTime ? { startTime: hhmm(row.startTime), endTime: hhmm(row.endTime) } : {}),
  };
}

export type MemberChildren = {
  availability: readonly AvailabilityRow[];
  unavailable: readonly UnavailableRow[];
  serviceSlugs: readonly string[];
  activity: readonly TeamActivityRow[];
};

/** `memberSlugById` resolves an activity entry's author. */
export function memberFromRows(
  row: TeamMemberRow,
  roleSlug: string | undefined,
  children: MemberChildren,
  memberSlugById: ReadonlyMap<string, string>,
): TeamMember {
  const availability: Availability = {
    mode: row.availabilityMode as Availability["mode"],
    weekly: weeklyFromRows(children.availability),
    unavailable: children.unavailable.map(periodFromRow),
  };
  return {
    id: row.slug,
    name: row.name,
    role: row.jobTitle,
    roleId: roleSlug ?? "",
    title: orUndefined(row.title),
    email: orUndefined(row.email),
    phone: orUndefined(row.phone),
    status: row.status as TeamMember["status"],
    fieldAssignable: row.fieldAssignable,
    memberSince: orUndefined(row.memberSince),
    notes: orUndefined(row.notes),
    availability,
    serviceMode: row.serviceMode as TeamMember["serviceMode"],
    serviceIds: children.serviceSlugs,
    permissionOverride: orUndefined(row.permissionOverride as Permissions | null),
    activity: children.activity.map(
      (entry): ActivityEntry => ({
        id: entry.ref,
        at: entry.occurredAt,
        category: entry.category as ActivityEntry["category"],
        title: entry.title,
        detail: orUndefined(entry.detail),
        byId: entry.byMemberId ? memberSlugById.get(entry.byMemberId) : undefined,
        jobId: orUndefined(entry.jobRef),
      }),
    ),
  };
}

/** The scalar columns of a member that an update may write. */
export function memberValues(member: TeamMember, roleDatabaseId: string | null) {
  return {
    name: member.name,
    jobTitle: member.role,
    title: member.title ?? null,
    roleId: roleDatabaseId,
    email: member.email ?? null,
    phone: member.phone ?? null,
    status: member.status,
    fieldAssignable: member.fieldAssignable,
    memberSince: member.memberSince ?? null,
    notes: member.notes ?? null,
    serviceMode: member.serviceMode,
    permissionOverride: member.permissionOverride ?? null,
    availabilityMode: member.availability.mode,
  };
}
