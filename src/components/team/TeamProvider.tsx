"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Availability, Permissions, Role, TeamData, TeamMember } from "@/data/team";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import type { NewMember } from "@/lib/team-rules";
import {
  addMemberAction,
  createRoleAction,
  deactivateMemberAction,
  setAvailabilityAction,
  setFieldAssignableAction,
  setPermissionOverrideAction,
  setServiceEligibilityAction,
  updateRoleAction,
} from "@/server/actions/team";

/** What every change resolves with: the Team as stored, or why it was refused. */
type Done = Promise<ActionResult<{ team: TeamData }>>;

type TeamContextValue = {
  /** The business's team and roles, as stored. */
  data: TeamData;
  /** Adds a team member whose invitation is pending. Records the person only: no email is sent and no sign-in is created. */
  addMember: (input: NewMember) => Promise<ActionResult<{ team: TeamData; member: TeamMember }>>;
  /** Takes someone off the list of people who can be given work. Their sign-in, if they have one, is not touched. */
  deactivateMember: (memberId: string) => Done;
  setFieldAssignable: (memberId: string, value: boolean) => Done;
  setPermissionOverride: (memberId: string, override: Permissions | undefined) => Done;
  setAvailability: (memberId: string, availability: Availability) => Done;
  setServiceEligibility: (memberId: string, mode: TeamMember["serviceMode"], serviceIds: readonly string[]) => Done;
  createRole: (input: { name: string; description?: string; permissions: Permissions }) => Promise<ActionResult<{ team: TeamData; role: Role }>>;
  updateRole: (roleId: string, patch: Partial<Pick<Role, "name" | "description" | "permissions">>) => Done;
};

const TeamContext = createContext<TeamContextValue | null>(null);

/**
 * The business's team and its roles for the whole workspace. `initial` is what the server read from PostgreSQL for this page
 * load. Every change goes to the server, which authorizes it (owner or admin), validates it, stores it and answers with the
 * Team as stored; only then does the working copy change, so the screen is never ahead of the database. It sits in the
 * workspace layout so the assignment pickers on Bookings, Schedule and Jobs see the same members, statuses and roles as the
 * Team module.
 *
 * Nothing here is authorization over the workspace and nothing here creates or removes a sign-in.
 */
export function TeamProvider({ initial, children }: { initial: TeamData; children: ReactNode }) {
  const [data, setData] = useState<TeamData>(initial);

  /** Adopt the stored Team a successful change answered with. */
  const adopt = useCallback(<T extends { team: TeamData }>(result: ActionResult<T>): ActionResult<T> => {
    if (result.ok) setData(result.data.team);
    return result;
  }, []);

  const value = useMemo<TeamContextValue>(
    () => ({
      data,
      addMember: async (input) => adopt(await send(() => addMemberAction(input))),
      deactivateMember: async (id) => adopt(await send(() => deactivateMemberAction(id))),
      setFieldAssignable: async (id, enabled) => adopt(await send(() => setFieldAssignableAction(id, enabled))),
      setPermissionOverride: async (id, override) => adopt(await send(() => setPermissionOverrideAction(id, override ?? null))),
      setAvailability: async (id, availability) => adopt(await send(() => setAvailabilityAction(id, availability))),
      setServiceEligibility: async (id, mode, ids) => adopt(await send(() => setServiceEligibilityAction(id, mode, ids))),
      createRole: async (input) => adopt(await send(() => createRoleAction(input))),
      updateRole: async (id, patch) => adopt(await send(() => updateRoleAction(id, patch))),
    }),
    [data, adopt],
  );

  return <TeamContext value={value}>{children}</TeamContext>;
}

export function useTeam(): TeamContextValue {
  const context = useContext(TeamContext);
  if (!context) throw new Error("useTeam must be used inside <TeamProvider>.");
  return context;
}
