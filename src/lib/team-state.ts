/**
 * Pure state transitions for the Team module's in-memory demo. Like lib/operations-state, nothing here
 * mutates its input, so the fixtures in data/team.ts stay untouched. None of this is authorization: roles
 * and permissions are configuration shown on screen, nothing enforces them.
 *
 * Deactivating a member changes only the member. Jobs and bookings that name them are never rewritten,
 * and nothing is reassigned automatically.
 */
import { PROTOTYPE_NOW } from "@/data/fixtures";
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

/** Every demo change is recorded as made by the signed-in user. */
const ACTOR_ID = "alex-morgan";

function mapMember(data: TeamData, id: string, change: (member: TeamMember) => TeamMember): TeamData {
  return { ...data, members: data.members.map((member) => (member.id === id ? change(member) : member)) };
}

function withActivity(member: TeamMember, entry: Pick<ActivityEntry, "category" | "title" | "detail">): TeamMember {
  const activity: ActivityEntry = {
    id: `act-${member.id}-${member.activity.length + 1}`,
    at: PROTOTYPE_NOW,
    byId: ACTOR_ID,
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

/** Adds a member whose invitation is pending. No email is sent; the invitation only exists in this session. */
export function addInvitedMember(data: TeamData, input: NewMemberInput): { data: TeamData; member: TeamMember } {
  const role = getRoleById(input.roleId, data);
  const member: TeamMember = {
    id: uniqueId(slugify(input.name), data.members.map((item) => item.id)),
    name: input.name.trim(),
    role: role?.name ?? "Team member",
    roleId: input.roleId,
    email: input.email.trim(),
    phone: input.phone?.trim() || undefined,
    status: "invited",
    fieldAssignable: input.fieldAssignable,
    availability: { mode: input.availabilityMode, weekly: weeklyFromBusinessHours(), unavailable: [] },
    serviceMode: "all",
    serviceIds: [],
    activity: [],
  };
  const invited = withActivity(member, {
    category: "access",
    title: "Invitation sent",
    detail: `Invited by Alex Morgan to Climvia Workspace as ${role?.name ?? "a team member"}`,
  });
  return { data: { ...data, members: [...data.members, invited] }, member: invited };
}

export function resendInvitation(data: TeamData, memberId: string): TeamData {
  return mapMember(data, memberId, (member) =>
    member.status === "invited" ? withActivity(member, { category: "access", title: "Invitation resent" }) : member,
  );
}

/** The owner stays active; anyone else becomes Inactive. History keeps showing their name. */
export function deactivateMember(data: TeamData, memberId: string): TeamData {
  return mapMember(data, memberId, (member) => {
    if (member.roleId === "owner" || member.status === "inactive") return member;
    return withActivity({ ...member, status: "inactive" }, {
      category: "access",
      title: "Account deactivated",
      detail: "Climvia access removed. Historical Jobs and activity are preserved.",
    });
  });
}

export function setFieldAssignable(data: TeamData, memberId: string, fieldAssignable: boolean): TeamData {
  return mapMember(data, memberId, (member) =>
    member.fieldAssignable === fieldAssignable
      ? member
      : withActivity({ ...member, fieldAssignable }, {
          category: "access",
          title: fieldAssignable ? "Assignable to Jobs enabled" : "Assignable to Jobs disabled",
        }),
  );
}

/** `override` undefined means "use the role's permissions". */
export function setPermissionOverride(data: TeamData, memberId: string, override: Permissions | undefined): TeamData {
  return mapMember(data, memberId, (member) => {
    const role = getRoleById(member.roleId, data);
    return withActivity({ ...member, permissionOverride: override }, {
      category: "access",
      title: "Permissions updated",
      detail: override ? "Member-specific permissions set" : `Inheriting ${role?.name ?? "role"} role defaults`,
    });
  });
}

export function setAvailability(data: TeamData, memberId: string, availability: Availability): TeamData {
  return mapMember(data, memberId, (member) => {
    const detail =
      availability.mode === "business-hours"
        ? "Uses business hours"
        : availability.mode === "custom"
          ? `Custom schedule: ${summarizeWeek(availability.weekly, formatTime)}`
          : "Availability not set";
    return withActivity({ ...member, availability }, { category: "availability", title: "Availability updated", detail });
  });
}

export function setServiceEligibility(
  data: TeamData,
  memberId: string,
  mode: TeamMember["serviceMode"],
  serviceIds: readonly string[],
): TeamData {
  return mapMember(data, memberId, (member) =>
    withActivity({ ...member, serviceMode: mode, serviceIds }, {
      category: "services",
      title: "Assigned services updated",
      detail: mode === "all" ? "Eligible for all active services" : `${serviceIds.length} services selected`,
    }),
  );
}

export type NewRoleInput = { name: string; description?: string; permissions: Permissions };

export function createRole(data: TeamData, input: NewRoleInput): { data: TeamData; role: Role } {
  const role: Role = {
    id: uniqueId(slugify(input.name), data.roles.map((item) => item.id)),
    name: input.name.trim(),
    description: input.description?.trim() || "Custom role.",
    kind: "custom",
    permissions: input.permissions,
  };
  return { data: { ...data, roles: [...data.roles, role] }, role };
}

/** Editing a role changes what its members inherit; the Owner role is protected. */
export function updateRole(data: TeamData, roleId: string, patch: Partial<Pick<Role, "name" | "description" | "permissions">>): TeamData {
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
      ? withActivity(renamed, { category: "access", title: "Permissions updated", detail: `Inheriting updated ${next.name} role defaults` })
      : renamed;
  });
  return { roles, members };
}
