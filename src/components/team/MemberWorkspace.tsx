"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { SearchX, UserX } from "lucide-react";
import { useServices } from "@/components/services/ServicesProvider";
import { Avatar } from "@/components/ui/Avatar";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TabNav } from "@/components/ui/TabNav";
import { useToast } from "@/components/ui/Toast";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { memberTabHref } from "@/config/routes";
import {
  CLASSIFICATION_LABEL,
  getAssignedServiceIds,
  getClassification,
  getMemberById,
  getRoleById,
  type TeamMember,
} from "@/data/team";
import { DeactivateMemberModal } from "./DeactivateMemberModal";
import { MemberStatusBadge } from "./MemberBadges";
import { useTeam } from "./TeamProvider";

const MemberContext = createContext<TeamMember | null>(null);

/** The team member shown by the current /team/[memberId]/* page, read from the business's team (as stored, and as changed here). */
export function useMember(): TeamMember {
  const member = useContext(MemberContext);
  if (!member) throw new Error("useMember must be used inside <MemberWorkspace>.");
  return member;
}

/** Layout for /team/[memberId]/*: resolves the member, then hosts the header, the tabs and Deactivate. */
export function MemberWorkspace({ memberId, children }: { memberId: string; children: ReactNode }) {
  const { data } = useTeam();
  const member = getMemberById(memberId, data);

  if (!member) {
    return (
      <EmptyState
        as="h1"
        icon={SearchX}
        title="Team member not found"
        description="This person isn't on your team."
        action={<ButtonLink href="/team">Back to Team</ButtonLink>}
      />
    );
  }
  return (
    <MemberContext value={member}>
      <MemberFrame member={member}>{children}</MemberFrame>
    </MemberContext>
  );
}

function MemberFrame({ member, children }: { member: TeamMember; children: ReactNode }) {
  const { data, deactivateMember } = useTeam();
  const { toast } = useToast();
  const { services } = useServices();
  const canManage = useCan("team:manage");
  const [deactivating, setDeactivating] = useState(false);

  const role = getRoleById(member.roleId, data);
  const isOwner = member.roleId === "owner";
  const serviceCount = getAssignedServiceIds(
    member,
    services.filter((service) => service.active).map((service) => service.id),
  ).length;

  return (
    <>
      <BackLink href="/team">Back to Team</BackLink>

      <header className={`${cardClasses("lg")} flex flex-col justify-between gap-5 lg:flex-row lg:items-center`}>
        <div className="flex items-center gap-4">
          <Avatar name={member.name} size="xl" />
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink">{member.name}</h1>
              <span className="rounded-full bg-primary-subtle px-2.5 py-0.5 text-xs font-semibold text-primary">{role?.name ?? member.role}</span>
              <span className="rounded-full bg-surface-low px-2.5 py-0.5 text-xs font-semibold text-ink-muted">
                {CLASSIFICATION_LABEL[getClassification(member)]}
              </span>
              <MemberStatusBadge status={member.status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
              {member.email && <span>{member.email}</span>}
              {member.phone && <span>{member.phone}</span>}
              {member.memberSince && <span>Member since {member.memberSince}</span>}
              {!member.email && !member.phone && !member.memberSince && <span>{member.title ?? member.role}</span>}
            </p>
          </div>
        </div>
        {member.status !== "inactive" && !isOwner && canManage && (
          <Button variant="destructive" onClick={() => setDeactivating(true)}>
            <UserX aria-hidden className="size-4" />
            Deactivate member
          </Button>
        )}
      </header>

      <TabNav
        label={`${member.name} sections`}
        items={[
          { label: "Overview", href: memberTabHref(member.id, "overview") },
          { label: "Schedule & availability", href: memberTabHref(member.id, "availability") },
          { label: "Permissions", href: memberTabHref(member.id, "permissions") },
          { label: "Assigned services", href: memberTabHref(member.id, "services"), count: serviceCount },
          { label: "Activity", href: memberTabHref(member.id, "activity") },
        ]}
      />

      <div>{children}</div>

      {deactivating && (
        <DeactivateMemberModal
          member={member}
          onClose={() => setDeactivating(false)}
          onConfirm={async () => {
            const result = await deactivateMember(member.id);
            if (!result.ok) return result.error;
            setDeactivating(false);
            toast(`${member.name} was deactivated.`);
          }}
        />
      )}
    </>
  );
}
