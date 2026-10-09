/**
 * Core business data: the queries.
 *
 * Every function takes an open transaction (`tx`) and the organization it is working for, and names that organization in
 * every statement's WHERE clause. They are meant to be called from `withTenant(...)`, where PostgreSQL's Row Level Security
 * then enforces the same boundary a second time (see src/db/tenant.ts); the explicit `organization_id` predicates are the
 * first layer, not a substitute for it. The seed calls the same functions on the owner connection, so the data it writes is
 * exactly what the application reads and writes.
 *
 * No `server-only` import on purpose: scripts and tests use these too. Nothing under src/ that is a Client Component may
 * import this file (a test enforces it).
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Customer, CustomerBook, Equipment, Property } from "@/data/customers";
import type { Service } from "@/data/services";
import type { Role, TeamData, TeamMember } from "@/data/team";
import {
  customerFromRows,
  equipmentFromRow,
  memberFromRows,
  memberValues,
  propertyFromRow,
  roleFromRow,
  roleValues,
  serviceFromRow,
  serviceValues,
} from "./core-mappers";
import type { Tx } from "./index";
import {
  customerNotes,
  customerProperties,
  customers,
  equipment,
  services,
  teamActivity,
  teamMemberAvailability,
  teamMemberServices,
  teamMemberUnavailablePeriods,
  teamMembers,
  teamRoles,
} from "./schema";
import { stableId } from "./stable-id";

/** Give the canonical sample records the same database identity on every rebuild (seed and tests only). */
export type IdOptions = { stableIds?: boolean };

const idFor = (options: IdOptions, organizationId: string, kind: string, slug: string) =>
  options.stableIds ? { id: stableId(organizationId, kind, slug) } : {};

/* ───────────────────────── services ───────────────────────── */

export async function loadServices(tx: Tx, organizationId: string): Promise<Service[]> {
  const rows = await tx
    .select()
    .from(services)
    .where(eq(services.organizationId, organizationId))
    .orderBy(asc(services.displayOrder), asc(services.name));
  return rows.map(serviceFromRow);
}

export async function insertServices(tx: Tx, organizationId: string, list: readonly Service[], options: IdOptions = {}): Promise<void> {
  for (const service of list) {
    await tx.insert(services).values({ organizationId, slug: service.id, ...idFor(options, organizationId, "service", service.id), ...serviceValues(service) });
  }
}

/* ───────────────────────── customers ───────────────────────── */

type BookRows = {
  customerRows: (typeof customers.$inferSelect)[];
  propertyRows: (typeof customerProperties.$inferSelect)[];
  equipmentRows: (typeof equipment.$inferSelect)[];
  noteRows: (typeof customerNotes.$inferSelect)[];
};

function assembleBook({ customerRows, propertyRows, equipmentRows, noteRows }: BookRows): CustomerBook {
  const customerSlugById = new Map(customerRows.map((row) => [row.id, row.slug]));
  const propertySlugById = new Map(propertyRows.map((row) => [row.id, row.slug]));

  const propertiesByCustomer = new Map<string, typeof propertyRows>();
  for (const row of propertyRows) propertiesByCustomer.set(row.customerId, [...(propertiesByCustomer.get(row.customerId) ?? []), row]);
  const notesByCustomer = new Map<string, typeof noteRows>();
  for (const row of noteRows) notesByCustomer.set(row.customerId, [...(notesByCustomer.get(row.customerId) ?? []), row]);

  const customerList: Customer[] = customerRows.map((row) => {
    // The primary property first, then the rest in the order they were added.
    const owned = [...(propertiesByCustomer.get(row.id) ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.position ?? 0) - (b.position ?? 0));
    return customerFromRows(row, owned.map((property) => property.slug), notesByCustomer.get(row.id) ?? []);
  });
  const propertyList: Property[] = propertyRows.map((row) => propertyFromRow(row, customerSlugById.get(row.customerId) ?? ""));
  const equipmentList: Equipment[] = equipmentRows.map((row) => equipmentFromRow(row, propertySlugById.get(row.propertyId) ?? ""));
  return { customers: customerList, properties: propertyList, equipment: equipmentList };
}

/** The whole customer book of one business: the customers, their properties and the equipment, in the order they were added. */
export async function loadCustomerBook(tx: Tx, organizationId: string): Promise<CustomerBook> {
  const customerRows = await tx.select().from(customers).where(eq(customers.organizationId, organizationId)).orderBy(asc(customers.position));
  const propertyRows = await tx.select().from(customerProperties).where(eq(customerProperties.organizationId, organizationId)).orderBy(asc(customerProperties.position));
  const equipmentRows = await tx.select().from(equipment).where(eq(equipment.organizationId, organizationId)).orderBy(asc(equipment.position));
  const noteRows = await tx.select().from(customerNotes).where(eq(customerNotes.organizationId, organizationId)).orderBy(asc(customerNotes.position));
  return assembleBook({ customerRows, propertyRows, equipmentRows, noteRows });
}

/**
 * One customer by its public reference, with its properties and equipment. Null when this business has no such customer,
 * which is also what a customer of ANY OTHER business looks like: the answer never distinguishes the two.
 */
export async function loadCustomerDetail(tx: Tx, organizationId: string, slug: string): Promise<{ customer: Customer; properties: readonly Property[]; equipment: readonly Equipment[] } | null> {
  const customerRows = await tx.select().from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.slug, slug))).limit(1);
  if (customerRows.length === 0) return null;
  const customerId = customerRows[0].id;
  const propertyRows = await tx
    .select()
    .from(customerProperties)
    .where(and(eq(customerProperties.organizationId, organizationId), eq(customerProperties.customerId, customerId)))
    .orderBy(asc(customerProperties.position));
  const equipmentRows =
    propertyRows.length === 0
      ? []
      : await tx
          .select()
          .from(equipment)
          .where(and(eq(equipment.organizationId, organizationId), inArray(equipment.propertyId, propertyRows.map((row) => row.id))))
          .orderBy(asc(equipment.position));
  const noteRows = await tx
    .select()
    .from(customerNotes)
    .where(and(eq(customerNotes.organizationId, organizationId), eq(customerNotes.customerId, customerId)))
    .orderBy(asc(customerNotes.position));
  const book = assembleBook({ customerRows, propertyRows, equipmentRows, noteRows });
  return { customer: book.customers[0], properties: book.properties, equipment: book.equipment };
}

/** Seed and tests: write a customer book (customers, notes, properties, equipment). Not used by the application. */
export async function insertCustomerBook(tx: Tx, organizationId: string, book: CustomerBook, options: IdOptions = {}): Promise<void> {
  const customerIdBySlug = new Map<string, string>();
  for (const customer of book.customers) {
    const [row] = await tx
      .insert(customers)
      .values({
        organizationId,
        slug: customer.id,
        ...idFor(options, organizationId, "customer", customer.id),
        name: customer.name,
        type: customer.type,
        phone: customer.phone || null,
        email: customer.email || null,
        preferredContact: customer.preferredContact,
        language: customer.language ?? null,
        preferences: [...customer.preferences],
        maintenancePlan: customer.maintenancePlan ?? null,
        lastService: customer.lastService ?? null,
        upcoming: customer.upcoming ?? null,
      })
      .returning({ id: customers.id });
    customerIdBySlug.set(customer.id, row.id);
    for (const note of customer.notes) {
      await tx.insert(customerNotes).values({ organizationId, customerId: row.id, body: note.body, updatedOn: note.updatedOn, recordedBy: note.recordedBy });
    }
  }
  const propertyIdBySlug = new Map<string, string>();
  for (const property of book.properties) {
    const customerId = customerIdBySlug.get(property.customerId);
    if (!customerId) throw new Error(`Property ${property.id} names an unknown customer ${property.customerId}.`);
    const owner = book.customers.find((customer) => customer.id === property.customerId);
    const [row] = await tx
      .insert(customerProperties)
      .values({
        organizationId,
        customerId,
        slug: property.id,
        ...idFor(options, organizationId, "property", property.id),
        label: property.label,
        addressLine1: property.street,
        city: property.city,
        stateRegion: property.state,
        postalCode: property.postalCode,
        area: property.area ?? null,
        accessInstructions: property.accessInstructions ?? null,
        mechanicalAccess: property.mechanicalAccess ?? null,
        isPrimary: owner?.propertyIds[0] === property.id,
      })
      .returning({ id: customerProperties.id });
    propertyIdBySlug.set(property.id, row.id);
  }
  for (const item of book.equipment) {
    const propertyId = propertyIdBySlug.get(item.propertyId);
    if (!propertyId) throw new Error(`Equipment ${item.id} names an unknown property ${item.propertyId}.`);
    await tx.insert(equipment).values({
      organizationId,
      propertyId,
      slug: item.id,
      ...idFor(options, organizationId, "equipment", item.id),
      name: item.name,
      kind: item.kind,
      capacity: item.capacity ?? null,
      manufacturer: item.manufacturer,
      model: item.model,
      modelCode: item.modelCode,
      serialNumber: item.serialNumber,
      location: item.location,
      inServiceSince: item.inServiceSince,
      refrigerant: item.refrigerant ?? null,
      filter: item.filter ?? null,
      lastServiced: item.lastServiced ?? null,
    });
  }
}

/* ───────────────────────── team ───────────────────────── */

export async function loadTeamData(tx: Tx, organizationId: string): Promise<TeamData> {
  const roleRows = await tx.select().from(teamRoles).where(eq(teamRoles.organizationId, organizationId)).orderBy(asc(teamRoles.position));
  const memberRows = await tx.select().from(teamMembers).where(eq(teamMembers.organizationId, organizationId)).orderBy(asc(teamMembers.position));
  const serviceRows = await tx.select({ id: services.id, slug: services.slug }).from(services).where(eq(services.organizationId, organizationId));
  const assignmentRows = await tx.select().from(teamMemberServices).where(eq(teamMemberServices.organizationId, organizationId));
  const availabilityRows = await tx.select().from(teamMemberAvailability).where(eq(teamMemberAvailability.organizationId, organizationId));
  const unavailableRows = await tx.select().from(teamMemberUnavailablePeriods).where(eq(teamMemberUnavailablePeriods.organizationId, organizationId)).orderBy(asc(teamMemberUnavailablePeriods.position));
  const activityRows = await tx.select().from(teamActivity).where(eq(teamActivity.organizationId, organizationId)).orderBy(desc(teamActivity.position));

  const roleSlugById = new Map(roleRows.map((row) => [row.id, row.slug]));
  const serviceSlugById = new Map(serviceRows.map((row) => [row.id, row.slug]));
  const memberSlugById = new Map(memberRows.map((row) => [row.id, row.slug]));

  const group = <T extends { memberId: string }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.memberId, [...(map.get(row.memberId) ?? []), row]);
    return map;
  };
  const assignments = group(assignmentRows);
  const availability = group(availabilityRows);
  const unavailable = group(unavailableRows);
  const activity = group(activityRows);

  return {
    roles: roleRows.map(roleFromRow),
    members: memberRows.map((row) =>
      memberFromRows(
        row,
        row.roleId ? roleSlugById.get(row.roleId) : undefined,
        {
          availability: availability.get(row.id) ?? [],
          unavailable: unavailable.get(row.id) ?? [],
          serviceSlugs: (assignments.get(row.id) ?? []).map((assignment) => serviceSlugById.get(assignment.serviceId) ?? "").filter(Boolean),
          activity: activity.get(row.id) ?? [],
        },
        memberSlugById,
      ),
    ),
  };
}

export type PersistTeamOptions = IdOptions & {
  /** Seed and onboarding: link new members to a Climvia login, by member slug. Existing members' links are never touched. */
  userIds?: Readonly<Record<string, string>>;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A member's own columns: what lives on its row, apart from the rows kept for it in other tables. */
const scalarsOf = (member: TeamMember) =>
  Object.fromEntries(Object.entries(member).filter(([key]) => key !== "availability" && key !== "activity" && key !== "serviceIds"));

async function replaceAvailability(tx: Tx, organizationId: string, memberId: string, member: TeamMember): Promise<void> {
  await tx.delete(teamMemberAvailability).where(and(eq(teamMemberAvailability.organizationId, organizationId), eq(teamMemberAvailability.memberId, memberId)));
  const days = Object.entries(member.availability.weekly).map(([day, hours]) => ({
    organizationId,
    memberId,
    dayOfWeek: Number(day),
    enabled: hours.enabled,
    startTime: hours.start,
    endTime: hours.end,
    breakStart: hours.breakStart ?? null,
    breakEnd: hours.breakEnd ?? null,
  }));
  if (days.length > 0) await tx.insert(teamMemberAvailability).values(days);
  await tx.delete(teamMemberUnavailablePeriods).where(and(eq(teamMemberUnavailablePeriods.organizationId, organizationId), eq(teamMemberUnavailablePeriods.memberId, memberId)));
  for (const period of member.availability.unavailable) {
    await tx.insert(teamMemberUnavailablePeriods).values({
      organizationId,
      memberId,
      ref: period.id,
      title: period.title,
      reason: period.reason,
      startDate: period.startDate,
      endDate: period.endDate,
      startTime: period.startTime ?? null,
      endTime: period.endTime ?? null,
    });
  }
}

async function replaceServiceAssignments(tx: Tx, organizationId: string, memberId: string, member: TeamMember, serviceIdBySlug: ReadonlyMap<string, string>): Promise<void> {
  await tx.delete(teamMemberServices).where(and(eq(teamMemberServices.organizationId, organizationId), eq(teamMemberServices.memberId, memberId)));
  const rows = member.serviceIds.map((slug) => {
    const serviceId = serviceIdBySlug.get(slug);
    if (!serviceId) throw new Error(`Unknown service "${slug}".`);
    return { organizationId, memberId, serviceId };
  });
  if (rows.length > 0) await tx.insert(teamMemberServices).values(rows);
}

/**
 * Make the database match `after`, given that it currently holds `before` (what the caller just loaded). Used by every
 * Team write: the pure transitions in lib/team-state.ts compute `after`; this writes only what changed. New roles and
 * members are inserted; changed ones updated; availability and service assignments replaced when they changed; new activity
 * entries appended (oldest first, so the newest ends up with the highest position).
 */
export async function persistTeamData(tx: Tx, organizationId: string, before: TeamData, after: TeamData, options: PersistTeamOptions = {}): Promise<void> {
  const roleIdBySlug = new Map<string, string>();
  const existingRoles = await tx.select({ id: teamRoles.id, slug: teamRoles.slug }).from(teamRoles).where(eq(teamRoles.organizationId, organizationId));
  for (const row of existingRoles) roleIdBySlug.set(row.slug, row.id);
  const serviceIdBySlug = new Map<string, string>();
  const serviceRows = await tx.select({ id: services.id, slug: services.slug }).from(services).where(eq(services.organizationId, organizationId));
  for (const row of serviceRows) serviceIdBySlug.set(row.slug, row.id);
  const memberIdBySlug = new Map<string, string>();
  const existingMembers = await tx.select({ id: teamMembers.id, slug: teamMembers.slug }).from(teamMembers).where(eq(teamMembers.organizationId, organizationId));
  for (const row of existingMembers) memberIdBySlug.set(row.slug, row.id);

  const beforeRoles = new Map(before.roles.map((role) => [role.id, role]));
  for (const role of after.roles) {
    const previous = beforeRoles.get(role.id);
    if (!previous) {
      const [row] = await tx.insert(teamRoles).values({ organizationId, slug: role.id, ...idFor(options, organizationId, "role", role.id), ...roleValues(role) }).returning({ id: teamRoles.id });
      roleIdBySlug.set(role.id, row.id);
    } else if (!same(previous, role)) {
      await tx
        .update(teamRoles)
        .set({ name: role.name, description: role.description, permissions: role.permissions })
        .where(and(eq(teamRoles.organizationId, organizationId), eq(teamRoles.id, roleIdBySlug.get(role.id) ?? "")));
    }
  }

  const beforeMembers = new Map(before.members.map((member) => [member.id, member]));
  // Members first (an activity entry may name a member who is added in the same change).
  for (const member of after.members) {
    const previous = beforeMembers.get(member.id);
    const roleDatabaseId = member.roleId ? (roleIdBySlug.get(member.roleId) ?? null) : null;
    if (member.roleId && !roleDatabaseId) throw new Error(`Unknown role "${member.roleId}".`);
    if (!previous) {
      const [row] = await tx
        .insert(teamMembers)
        .values({
          organizationId,
          slug: member.id,
          ...idFor(options, organizationId, "member", member.id),
          userId: options.userIds?.[member.id] ?? null,
          ...memberValues(member, roleDatabaseId),
        })
        .returning({ id: teamMembers.id });
      memberIdBySlug.set(member.id, row.id);
      await replaceAvailability(tx, organizationId, row.id, member);
      await replaceServiceAssignments(tx, organizationId, row.id, member, serviceIdBySlug);
      continue;
    }
    const memberId = memberIdBySlug.get(member.id);
    if (!memberId) throw new Error(`Unknown team member "${member.id}".`);
    if (!same(scalarsOf(previous), scalarsOf(member))) {
      await tx.update(teamMembers).set(memberValues(member, roleDatabaseId)).where(and(eq(teamMembers.organizationId, organizationId), eq(teamMembers.id, memberId)));
    }
    if (!same(previous.availability, member.availability)) await replaceAvailability(tx, organizationId, memberId, member);
    if (!same(previous.serviceIds, member.serviceIds) || previous.serviceMode !== member.serviceMode) {
      await replaceServiceAssignments(tx, organizationId, memberId, member, serviceIdBySlug);
    }
  }

  for (const member of after.members) {
    const memberId = memberIdBySlug.get(member.id);
    if (!memberId) continue;
    const known = new Set((beforeMembers.get(member.id)?.activity ?? []).map((entry) => entry.id));
    const fresh = member.activity.filter((entry) => !known.has(entry.id));
    for (const entry of [...fresh].reverse()) {
      let byMemberId: string | null = null;
      if (entry.byId) {
        byMemberId = memberIdBySlug.get(entry.byId) ?? null;
        if (!byMemberId) throw new Error(`Unknown team member "${entry.byId}".`);
      }
      await tx.insert(teamActivity).values({
        organizationId,
        memberId,
        ref: entry.id,
        occurredAt: entry.at,
        category: entry.category,
        title: entry.title,
        detail: entry.detail ?? null,
        byMemberId,
        jobRef: entry.jobId ?? null,
      });
    }
  }
}

/** The team member linked to this login in this business, if any. */
export async function findMemberSlugForUser(tx: Tx, organizationId: string, userId: string): Promise<string | undefined> {
  const rows = await tx.select({ slug: teamMembers.slug }).from(teamMembers).where(and(eq(teamMembers.organizationId, organizationId), eq(teamMembers.userId, userId))).limit(1);
  return rows[0]?.slug;
}

/** Remove every core record of one organization (tests reset a worker's copy of the sample business with this). */
export async function clearCoreData(tx: Tx, organizationId: string): Promise<void> {
  // Children first; the composite foreign keys cascade the rest.
  await tx.delete(teamActivity).where(eq(teamActivity.organizationId, organizationId));
  await tx.delete(teamMembers).where(eq(teamMembers.organizationId, organizationId));
  await tx.delete(teamRoles).where(eq(teamRoles.organizationId, organizationId));
  await tx.delete(customers).where(eq(customers.organizationId, organizationId));
  await tx.delete(services).where(eq(services.organizationId, organizationId));
}

export type { Role };
