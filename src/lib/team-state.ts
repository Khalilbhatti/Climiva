/**
 * Pure transitions of the Team. Nothing here mutates its input. The server runs them against the Team it just read from
 * PostgreSQL and writes the difference (src/db/core-queries.persistTeamData), so what the screens show after a change is
 * exactly what was stored. None of this is authorization: roles and permissions are configuration shown on screen, and the
 * only authority over who may change the Team is the SaaS role in organization_memberships.
 *
 * Deactivating a member changes only the Team record. Jobs and bookings that name them are never rewritten, nothing is
 * reassigned automatically, and their Climvia login (if they have one) is not touched.
 */
import { PROTOTYPE_NOW } from "./prototype-clock";
import {
  getRoleById,
  summarizeWeek,
  weeklyFromBusinessHours,
  type ActivityEntry,
  type Availability,
  type AvailabilityMode,
  type Permissions,
  type Role,
  type TeamData,
  type TeamMember,
} from "@/data/team";
import { formatTime } from "./dates";

/**
 * Who made a change. `id` is the team member's id when the signed-in person has a team record in this business; many owners
 * do, some admins do not, in which case the entry still carries their name in its text but no author link.
 */
export type Actor = { id?: string; name: string };

/** The business hours (the saved Settings hours), the starting point of a new member's schedule. */
export type BusinessHours = Readonly<Record<number, { open: string; close: string } | null>>;

function mapMember(data: TeamData, id: string, change: (member: TeamMember) => TeamMember): TeamData {
  return { ...data, members: data.members.map((member) => (member.id === id ? change(member) : member)) };
}

function withActivity(member: TeamMember, actor: Actor, entry: Pick<ActivityEntry, "category" | "title" | "detail">): TeamMember {
  const activity: ActivityEntry = {
    id: `act-${member.id}-${member.activity.length + 1}`,
    at: PROTOTYPE_NOW,
    byId: actor.id,
    ...entry,
  };
  return { ...member, activity: [activity, ...member.activity] };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export type NewMemberInput = {
  name: string;
  email: string;
  phone?: string;
  roleId: string;
  fieldAssignable: boolean;
  availabilityMode: AvailabilityMode;
};

/**
 * Adds a member who is pending (status "invited"). The Team record is real and stored; NO email is sent and NO sign-in is
 * created: inviting someone to sign in to Climvia is a separate step that arrives with email.
 */
export function addInvitedMember(data: TeamData, input: NewMemberInput, actor: Actor, businessHours: BusinessHours): { data: TeamData; member: TeamMember } {
  const role = getRoleById(input.roleId, data);
  const member: TeamMember = {
    id: uniqueId(slugify(input.name).slice(0, 70).replace(/-+$/g, "") || "member", data.members.map((item) => item.id)),
    name: input.name.trim(),
    role: role?.name ?? "Team member",
    roleId: input.roleId,
    email: input.email.trim(),
    phone: input.phone?.trim() || undefined,
    status: "invited",
    fieldAssignable: input.fieldAssignable,
    availability: { mode: input.availabilityMode, weekly: weeklyFromBusinessHours(businessHours), unavailable: [] },
    serviceMode: "all",
    serviceIds: [],
    activity: [],
  };
  const invited = withActivity(member, actor, {
    category: "access",
    title: "Added to the team",
    detail: `Added by ${actor.name} as ${role?.name ?? "a team member"}. No invitation email was sent.`,
  });
  return { data: { ...data, members: [...data.members, invited] }, member: invited };
}

/** The owner stays active; anyone else becomes Inactive. History keeps showing their name. */
export function deactivateMember(data: TeamData, memberId: string, actor: Actor): TeamData {
  return mapMember(data, memberId, (member) => {
    if (member.roleId === "owner" || member.status === "inactive") return member;
    return withActivity({ ...member, status: "inactive" }, actor, {
      category: "access",
      title: "Team member deactivated",
      detail: "No longer offered for new work. Historical Jobs and activity are preserved. Their sign-in, if any, is not changed.",
    });
  });
}

export function setFieldAssignable(data: TeamData, memberId: string, fieldAssignable: boolean, actor: Actor): TeamData {
  return mapMember(data, memberId, (member) =>
    member.fieldAssignable === fieldAssignable
      ? member
      : withActivity({ ...member, fieldAssignable }, actor, {
          category: "access",
          title: fieldAssignable ? "Assignable to Jobs enabled" : "Assignable to Jobs disabled",
        }),
  );
}

/** `override` undefined means "use the role's permissions". */
export function setPermissionOverride(data: TeamData, memberId: string, override: Permissions | undefined, actor: Actor): TeamData {
  return mapMember(data, memberId, (member) => {
    const role = getRoleById(member.roleId, data);
    return withActivity({ ...member, permissionOverride: override }, actor, {
      category: "access",
      title: "Permissions updated",
      detail: override ? "Member-specific permissions set" : `Inheriting ${role?.name ?? "role"} role defaults`,
    });
  });
}

export function setAvailability(data: TeamData, memberId: string, availability: Availability, actor: Actor): TeamData {
  return mapMember(data, memberId, (member) => {
    const detail =
      availability.mode === "business-hours"
        ? "Uses business hours"
        : availability.mode === "custom"
          ? `Custom schedule: ${summarizeWeek(availability.weekly, formatTime)}`
          : "Availability not set";
    return withActivity({ ...member, availability }, actor, { category: "availability", title: "Availability updated", detail });
  });
}

export function setServiceEligibility(
  data: TeamData,
  memberId: string,
  mode: TeamMember["serviceMode"],
  serviceIds: readonly string[],
  actor: Actor,
): TeamData {
  return mapMember(data, memberId, (member) =>
    withActivity({ ...member, serviceMode: mode, serviceIds }, actor, {
      category: "services",
      title: "Assigned services updated",
      detail: mode === "all" ? "Eligible for all active services" : `${serviceIds.length} services selected`,
    }),
  );
}

export type NewRoleInput = { name: string; description?: string; permissions: Permissions };

export function createRole(data: TeamData, input: NewRoleInput): { data: TeamData; role: Role } {
  const role: Role = {
    id: uniqueId(slugify(input.name).slice(0, 70).replace(/-+$/g, "") || "role", data.roles.map((item) => item.id)),
    name: input.name.trim(),
    description: input.description?.trim() || "Custom role.",
    kind: "custom",
    permissions: input.permissions,
  };
  return { data: { ...data, roles: [...data.roles, role] }, role };
}

/** Editing a role changes what its members inherit; the Owner role is protected. */
export function updateRole(data: TeamData, roleId: string, patch: Partial<Pick<Role, "name" | "description" | "permissions">>, actor: Actor): TeamData {
  const role = data.roles.find((item) => item.id === roleId);
  if (!role || role.protected) return data;

  const next: Role = {
    ...role,
    ...patch,
    name: patch.name?.trim() || role.name,
    description: patch.description?.trim() ?? role.description,
  };
  const roles = data.roles.map((item) => (item.id === roleId ? next : item));
  const changedPermissions = patch.permissions !== undefined;
  const members = data.members.map((member) => {
    if (member.roleId !== roleId) return member;
    const renamed = { ...member, role: member.role === role.name ? next.name : member.role };
    return changedPermissions && !member.permissionOverride
      ? withActivity(renamed, actor, { category: "access", title: "Permissions updated", detail: `Inheriting updated ${next.name} role defaults` })
      : renamed;
  });
  return { roles, members };
}
