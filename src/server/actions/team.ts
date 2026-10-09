"use server";

import type { Service } from "@/data/services";
import type { Role, TeamData, TeamMember } from "@/data/team";
import { findMemberSlugForUser, loadServices, loadTeamData, persistTeamData } from "@/db/core-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_TEAM, failure, ok, type ActionResult } from "@/lib/action-result";
import { EMAIL_PATTERN, parseAvailability, parseNewMember, parseNewRole, parsePermissions, parseRolePatch, parseServiceEligibility } from "@/lib/team-rules";
import * as state from "@/lib/team-state";
import { authorize } from "../authorize";
import { isIntegrityViolation, uniqueViolationOf } from "../db-errors";

/**
 * Team writes. Each action authorizes (the "team:manage" capability: owner or admin of the ACTIVE organization), parses its
 * input, loads the Team as it is NOW from PostgreSQL, applies the same pure transition the screens use (lib/team-state),
 * writes only the difference, and hands back the Team as stored, so the screen shows exactly what is in the database.
 *
 * A team member is a worker of the business, not a login: nothing here creates an account, sends an email or changes an
 * organization membership. Deactivating a member changes the Team record only.
 */

type Change<T> = { team: TeamData } & T;

const UNKNOWN_MEMBER = "That team member no longer exists. Reload the page and try again.";

function translate(error: unknown): ReturnType<typeof failure> {
  const constraint = uniqueViolationOf(error);
  if (constraint?.startsWith("team_roles_org_name")) return failure("A role with this name already exists.", { name: "A role with this name already exists." });
  if (constraint) return failure("Someone changed the team at the same moment. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("The change breaks a rule. Check it and try again.");
  console.error("[team] could not save:", error instanceof Error ? error.message : error);
  return failure("The change could not be saved. Try again.");
}

type Plan<T> = { after: TeamData; extra: T } | ReturnType<typeof failure>;
type Inputs = { before: TeamData; services: readonly Service[]; actor: state.Actor; businessHours: state.BusinessHours };

/** Authorize, load, plan the change with the pure transitions, persist the difference, and return the stored Team. */
async function change<T extends object>(plan: (inputs: Inputs) => Plan<T>): Promise<ActionResult<Change<T>>> {
  const auth = await authorize("team:manage", NOT_ALLOWED_TEAM);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, snapshot } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const before = await loadTeamData(tx, organizationId);
      const services = await loadServices(tx, organizationId);
      const actorSlug = await findMemberSlugForUser(tx, organizationId, userId);
      const actor: state.Actor = { id: actorSlug, name: snapshot.user.name };
      const planned = plan({ before, services, actor, businessHours: snapshot.settings.hours });
      if ("ok" in planned) return planned;
      await persistTeamData(tx, organizationId, before, planned.after);
      const team = await loadTeamData(tx, organizationId);
      return ok({ team, ...planned.extra } as Change<T>);
    });
  } catch (error) {
    return translate(error);
  }
}

const memberOf = (data: TeamData, id: unknown) => (typeof id === "string" ? data.members.find((member) => member.id === id) : undefined);

export async function addMemberAction(input: unknown): Promise<ActionResult<Change<{ member: TeamMember }>>> {
  const parsed = parseNewMember(input);
  if (!parsed.ok) return parsed;
  return change(({ before, actor, businessHours }) => {
    const role = before.roles.find((item) => item.id === parsed.value.roleId);
    if (!role || role.id === "owner") return failure("Choose a role for this person.", { roleId: "Choose a role for this person." });
    if (!EMAIL_PATTERN.test(parsed.value.email)) return failure("Enter a valid email address, like name@example.com.", { email: "Enter a valid email address, like name@example.com." });
    if (before.members.some((member) => member.email?.toLowerCase() === parsed.value.email.toLowerCase())) {
      return failure("A team member with this email address already exists.", { email: "A team member with this email address already exists." });
    }
    const added = state.addInvitedMember(before, parsed.value, actor, businessHours);
    return { after: added.data, extra: { member: added.member } };
  });
}

/** The owner stays active. Anyone else becomes Inactive: the Team record only, never their sign-in. */
export async function deactivateMemberAction(memberId: unknown): Promise<ActionResult<Change<object>>> {
  return change(({ before, actor }) => {
    const member = memberOf(before, memberId);
    if (!member) return failure(UNKNOWN_MEMBER);
    if (member.roleId === "owner") return failure("The owner can't be deactivated.");
    return { after: state.deactivateMember(before, member.id, actor), extra: {} };
  });
}

export async function setFieldAssignableAction(memberId: unknown, value: unknown): Promise<ActionResult<Change<object>>> {
  if (typeof value !== "boolean") return failure("The change was not understood.");
  return change(({ before, actor }) => {
    const member = memberOf(before, memberId);
    if (!member) return failure(UNKNOWN_MEMBER);
    return { after: state.setFieldAssignable(before, member.id, value, actor), extra: {} };
  });
}

/** `null` means "use the role's permissions". */
export async function setPermissionOverrideAction(memberId: unknown, permissions: unknown): Promise<ActionResult<Change<object>>> {
  let override: ReturnType<typeof parsePermissions> | null = null;
  if (permissions !== null) {
    override = parsePermissions(permissions);
    if (!override.ok) return override;
  }
  return change(({ before, actor }) => {
    const member = memberOf(before, memberId);
    if (!member) return failure(UNKNOWN_MEMBER);
    return { after: state.setPermissionOverride(before, member.id, override && override.ok ? override.value : undefined, actor), extra: {} };
  });
}

export async function setAvailabilityAction(memberId: unknown, availability: unknown): Promise<ActionResult<Change<object>>> {
  const parsed = parseAvailability(availability);
  if (!parsed.ok) return parsed;
  return change(({ before, actor }) => {
    const member = memberOf(before, memberId);
    if (!member) return failure(UNKNOWN_MEMBER);
    return { after: state.setAvailability(before, member.id, parsed.value, actor), extra: {} };
  });
}

export async function setServiceEligibilityAction(memberId: unknown, mode: unknown, serviceIds: unknown): Promise<ActionResult<Change<object>>> {
  const parsed = parseServiceEligibility(mode, serviceIds);
  if (!parsed.ok) return parsed;
  return change(({ before, services, actor }) => {
    const member = memberOf(before, memberId);
    if (!member) return failure(UNKNOWN_MEMBER);
    // Every Service named must be one of THIS business's Services: an id from anywhere else is simply unknown.
    const known = new Set(services.map((service) => service.id));
    if (!parsed.value.serviceIds.every((id) => known.has(id))) return failure("One of the selected services no longer exists. Reload the page and try again.");
    return { after: state.setServiceEligibility(before, member.id, parsed.value.mode, parsed.value.serviceIds, actor), extra: {} };
  });
}

export async function createRoleAction(input: unknown): Promise<ActionResult<Change<{ role: Role }>>> {
  const parsed = parseNewRole(input);
  if (!parsed.ok) return parsed;
  return change(({ before }) => {
    if (before.roles.some((role) => role.name.toLowerCase() === parsed.value.name.toLowerCase())) {
      return failure("A role with this name already exists.", { name: "A role with this name already exists." });
    }
    const created = state.createRole(before, parsed.value);
    return { after: created.data, extra: { role: created.role } };
  });
}

export async function updateRoleAction(roleId: unknown, patch: unknown): Promise<ActionResult<Change<object>>> {
  const parsed = parseRolePatch(patch);
  if (!parsed.ok) return parsed;
  return change(({ before, actor }) => {
    const role = typeof roleId === "string" ? before.roles.find((item) => item.id === roleId) : undefined;
    if (!role) return failure("That role no longer exists. Reload the page and try again.");
    if (role.protected) return failure("The Owner role can't be changed.");
    if (parsed.value.name && before.roles.some((item) => item.id !== role.id && item.name.toLowerCase() === parsed.value.name!.toLowerCase())) {
      return failure("A role with this name already exists.", { name: "A role with this name already exists." });
    }
    return { after: state.updateRole(before, role.id, parsed.value, actor), extra: {} };
  });
}

