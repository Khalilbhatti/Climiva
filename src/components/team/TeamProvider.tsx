"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  TEAM_DATA,
  type Availability,
  type Permissions,
  type Role,
  type TeamData,
  type TeamMember,
} from "@/data/team";
import * as state from "@/lib/team-state";

type TeamContextValue = {
  /** The working data: canonical fixtures plus any demo changes made in this session. */
  data: TeamData;
  addMember: (input: state.NewMemberInput) => TeamMember;
  resendInvitation: (memberId: string) => void;
  deactivateMember: (memberId: string) => void;
  setFieldAssignable: (memberId: string, value: boolean) => void;
  setPermissionOverride: (memberId: string, override: Permissions | undefined) => void;
  setAvailability: (memberId: string, availability: Availability) => void;
  setServiceEligibility: (memberId: string, mode: TeamMember["serviceMode"], serviceIds: readonly string[]) => void;
  createRole: (input: state.NewRoleInput) => Role;
  updateRole: (roleId: string, patch: Partial<Pick<Role, "name" | "description" | "permissions">>) => void;
};

const TeamContext = createContext<TeamContextValue | null>(null);

/**
 * The demo copy of the team and its roles for the whole workspace. It starts as the canonical fixtures,
 * lives only in memory (a reload restores them) and never writes back to data/team.ts. It sits in the
 * workspace layout next to OperationsProvider so the assignment pickers on Bookings, Schedule and Jobs
 * see the same members, statuses and roles as the Team module.
 */
export function TeamProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TeamData>(TEAM_DATA);
  // The ref lets actions that return a value (addMember, createRole) read the latest data synchronously.
  const latest = useRef(data);

  const commit = useCallback((next: TeamData) => {
    latest.current = next;
    setData(next);
  }, []);

  const value = useMemo<TeamContextValue>(
    () => ({
      data,
      addMember: (input) => {
        const result = state.addInvitedMember(latest.current, input);
        commit(result.data);
        return result.member;
      },
      resendInvitation: (id) => commit(state.resendInvitation(latest.current, id)),
      deactivateMember: (id) => commit(state.deactivateMember(latest.current, id)),
      setFieldAssignable: (id, enabled) => commit(state.setFieldAssignable(latest.current, id, enabled)),
      setPermissionOverride: (id, override) => commit(state.setPermissionOverride(latest.current, id, override)),
      setAvailability: (id, availability) => commit(state.setAvailability(latest.current, id, availability)),
      setServiceEligibility: (id, mode, ids) => commit(state.setServiceEligibility(latest.current, id, mode, ids)),
      createRole: (input) => {
        const result = state.createRole(latest.current, input);
        commit(result.data);
        return result.role;
      },
      updateRole: (id, patch) => commit(state.updateRole(latest.current, id, patch)),
    }),
    [data, commit],
  );

  return <TeamContext value={value}>{children}</TeamContext>;
}

export function useTeam(): TeamContextValue {
  const context = useContext(TeamContext);
  if (!context) throw new Error("useTeam must be used inside <TeamProvider>.");
  return context;
}
