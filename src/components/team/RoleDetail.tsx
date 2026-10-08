"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, SearchX, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { memberHref } from "@/config/routes";
import { MODULE_IDS, getMembersForRole, getRoleById, type Permissions, type Role } from "@/data/team";
import { PermissionMatrix } from "./PermissionMatrix";
import { useTeam } from "./TeamProvider";

export function RoleDetail({ roleId }: { roleId: string }) {
  const { data } = useTeam();
  const role = getRoleById(roleId, data);

  if (!role) {
    return (
      <EmptyState
        as="h1"
        icon={SearchX}
        title="Role not found"
        description="This role isn't in the list. Roles created in this session are cleared when the page reloads."
        action={<ButtonLink href="/team/roles">Back to Roles</ButtonLink>}
      />
    );
  }
  return <RoleEditor key={role.id} role={role} />;
}

const samePermissions = (a: Permissions, b: Permissions) => MODULE_IDS.every((id) => a[id] === b[id]);

function RoleEditor({ role }: { role: Role }) {
  const { data, updateRole } = useTeam();
  const { toast } = useToast();

  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [permissions, setPermissions] = useState<Permissions>(role.permissions);
  const [showError, setShowError] = useState(false);

  const members = getMembersForRole(role.id, data);
  const readOnly = Boolean(role.protected);
  const nameError =
    !name.trim() ? "Enter a role name."
    : data.roles.some((item) => item.id !== role.id && item.name.toLowerCase() === name.trim().toLowerCase()) ? "A role with this name already exists."
    : undefined;
  const dirty = name !== role.name || description !== role.description || !samePermissions(permissions, role.permissions);

  function save() {
    if (nameError) return setShowError(true);
    updateRole(role.id, { name, description, permissions });
    toast(`${name.trim()} role updated.`);
  }

  return (
    <>
      <BackLink href="/team/roles">Back to Roles</BackLink>

      <header className={cardClasses("lg", "flex flex-col justify-between gap-4 lg:flex-row lg:items-start")}>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{role.name}</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-low px-2.5 py-0.5 text-xs font-semibold text-ink-muted">
              {role.protected && <Lock aria-hidden className="size-3" />}
              {role.kind === "custom" ? "Custom role" : "System role"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {readOnly ? "The Owner role always has full access and can't be edited." : `Manage the permissions used by team members with the ${role.name} role.`}
          </p>
        </div>
        {!readOnly && (
          <ButtonLink href={`/team/roles/new?from=${role.id}`} variant="secondary">
            Duplicate role
          </ButtonLink>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <section aria-labelledby="role-basics" className={cardClasses("lg", "space-y-4")}>
            <h2 id="role-basics" className="text-base font-semibold text-ink">
              Role details
            </h2>
            <Input
              label="Role name"
              required
              value={name}
              readOnly={role.kind === "system"}
              hint={role.kind === "system" ? "System role names can't be changed." : undefined}
              error={showError ? nameError : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            <Textarea
              label="Role description"
              rows={2}
              value={description}
              readOnly={readOnly}
              hint="Visible to workspace administrators when assigning team members."
              onChange={(event) => setDescription(event.target.value)}
            />
          </section>

          <section aria-labelledby="role-permissions" className="space-y-3">
            <div>
              <h2 id="role-permissions" className="text-base font-semibold text-ink">
                Role permissions
              </h2>
              <p className="text-xs text-ink-muted">Role permissions control which parts of Climvia people with this role can access.</p>
            </div>
            <PermissionMatrix idPrefix="role-permission" value={permissions} onChange={readOnly ? undefined : setPermissions} />
          </section>
        </div>

        <aside aria-labelledby="role-members" className={cardClasses("lg", "h-fit space-y-3 lg:col-span-4")}>
          <h2 id="role-members" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Users aria-hidden className="size-4 text-primary" />
            Assigned members
          </h2>
          <p className="text-sm text-ink-muted">
            {members.length} team member{members.length === 1 ? "" : "s"} currently using the {role.name} role.
          </p>
          {members.length > 0 && (
            <ul className="space-y-2">
              {members.map((member) => (
                <li key={member.id} className="flex items-center gap-2 text-sm">
                  <Avatar name={member.name} />
                  <Link href={memberHref(member.id)} className="font-medium text-ink hover:underline">
                    {member.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-muted" aria-live="polite">
            Changes to this role apply immediately to {members.length} team member{members.length === 1 ? "" : "s"}.
            {dirty && <span className="ml-2 font-semibold text-ink">· Unsaved changes</span>}
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={!dirty}
              onClick={() => {
                setName(role.name);
                setDescription(role.description);
                setPermissions(role.permissions);
                setShowError(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
