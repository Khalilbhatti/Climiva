"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { useToast } from "@/components/ui/Toast";
import { MODULE_IDS, buildPermissions, countAccessibleModules, getRoleById, type Permissions } from "@/data/team";
import { PermissionMatrix } from "./PermissionMatrix";
import { useMember } from "./MemberWorkspace";
import { useTeam } from "./TeamProvider";

const samePermissions = (a: Permissions, b: Permissions) => MODULE_IDS.every((id) => a[id] === b[id]);

/**
 * A member either inherits their role's permissions or has their own. This edits demo configuration only:
 * there is no sign-in or enforcement behind it.
 */
export function MemberPermissions() {
  const member = useMember();
  const { data, setPermissionOverride } = useTeam();
  const { toast } = useToast();

  const role = getRoleById(member.roleId, data);
  const roleName = role?.name ?? member.role;
  const rolePermissions = role?.permissions ?? buildPermissions("none");
  const locked = member.roleId === "owner" || member.status === "inactive";

  const [custom, setCustom] = useState(Boolean(member.permissionOverride));
  const [draft, setDraft] = useState<Permissions>(member.permissionOverride ?? rolePermissions);

  const savedCustom = Boolean(member.permissionOverride);
  const dirty = custom !== savedCustom || (custom && !samePermissions(draft, member.permissionOverride ?? rolePermissions));
  const effective = custom ? draft : rolePermissions;

  function save() {
    setPermissionOverride(member.id, custom ? draft : undefined);
    toast(`Permissions for ${member.name} updated successfully.`);
  }

  function reset() {
    setCustom(false);
    setDraft(rolePermissions);
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="permissions-source" className={cardClasses("lg", "space-y-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h2 id="permissions-source" className="text-base font-semibold text-ink">
                Role: {roleName}
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Role permissions control which parts of Climvia this person can access.
                {locked && member.roleId === "owner" && " The Owner role has full access and can't be changed."}
              </p>
            </div>
          </div>
          <Link href="/team/roles" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Manage role templates
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>

        <OptionGroup legend="Permission source" className="sm:grid-cols-2">
          <OptionCard
            type="radio"
            name="permission-source"
            title={`Use role permissions (Inherited from ${roleName})`}
            description="Changes to the role apply to this person automatically."
            checked={!custom}
            disabled={locked}
            onChange={() => setCustom(false)}
          />
          <OptionCard
            type="radio"
            name="permission-source"
            title={`Customize permissions for ${member.name}`}
            description="A member-specific override that no longer follows the role."
            checked={custom}
            disabled={locked}
            onChange={() => {
              setCustom(true);
              setDraft((current) => (savedCustom ? current : rolePermissions));
            }}
          />
        </OptionGroup>
      </section>

      <PermissionMatrix idPrefix="member-permission" value={effective} onChange={custom && !locked ? setDraft : undefined} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {custom ? "Using custom permissions" : `Inheriting permissions from the ${roleName} role`} · access to{" "}
          {countAccessibleModules(effective)} of {MODULE_IDS.length} modules
          {dirty && <span className="ml-2 font-semibold text-ink">· Unsaved changes</span>}
        </p>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={reset} disabled={locked || (!custom && !dirty)}>
            Reset to {roleName} default
          </Button>
          <Button onClick={save} disabled={locked || !dirty}>
            Save permissions
          </Button>
        </div>
      </div>
    </div>
  );
}
