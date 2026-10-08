"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { buildPermissions, getRoleById, type Permissions } from "@/data/team";
import { PermissionMatrix } from "./PermissionMatrix";
import { useTeam } from "./TeamProvider";

const BLANK = "blank";
/** The roles offered as a starting point, as on the approved screen. */
const TEMPLATE_IDS = ["office-scheduling", "technician", "administrator"];

/**
 * Create a reusable set of permissions. "Start with" only copies permission levels, never members.
 * `?from=<roleId>` (the Duplicate action) opens it with that role's permissions and a "copy" name.
 */
export function CreateRole() {
  const { data, createRole } = useTeam();
  const { toast } = useToast();
  const router = useRouter();
  const from = getRoleById(useSearchParams().get("from") ?? undefined, data);

  const [name, setName] = useState(from ? `${from.name} copy` : "");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState(from?.id ?? BLANK);
  const [permissions, setPermissions] = useState<Permissions>(from?.permissions ?? buildPermissions("none"));
  const [showError, setShowError] = useState(false);

  const templates = data.roles.filter((role) => TEMPLATE_IDS.includes(role.id) || role.id === from?.id);
  const nameError = !name.trim()
    ? "Enter a role name."
    : data.roles.some((role) => role.name.toLowerCase() === name.trim().toLowerCase())
      ? "A role with this name already exists."
      : undefined;

  function chooseTemplate(id: string) {
    setTemplate(id);
    setPermissions(getRoleById(id, data)?.permissions ?? buildPermissions("none"));
  }

  function create() {
    if (nameError) return setShowError(true);
    const role = createRole({ name, description, permissions });
    toast(`${role.name} role created.`);
    router.push("/team/roles");
  }

  return (
    <>
      <BackLink href="/team/roles">Back to Roles</BackLink>
      <PageHeader title="Create role" description="Create a reusable set of permissions for people in your workspace." />

      <section aria-labelledby="role-basics" className={cardClasses("lg", "space-y-5")}>
        <h2 id="role-basics" className="sr-only">
          Role details
        </h2>
        <Input
          label="Role name"
          required
          value={name}
          error={showError ? nameError : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          label="Description (optional)"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div>
          <OptionGroup legend="Start with" hint="This only copies permission settings. Members are not copied." className="sm:grid-cols-2 lg:grid-cols-4">
            <OptionCard
              type="radio"
              name="role-template"
              title="Blank permissions"
              checked={template === BLANK}
              onChange={() => chooseTemplate(BLANK)}
            />
            {templates.map((role) => (
              <OptionCard
                key={role.id}
                type="radio"
                name="role-template"
                title={role.name}
                checked={template === role.id}
                onChange={() => chooseTemplate(role.id)}
              />
            ))}
          </OptionGroup>
        </div>
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          Roles control access only. Job assignment eligibility, availability and Assigned services are configured separately for each team
          member.
        </p>
      </section>

      <section aria-labelledby="new-role-permissions" className="space-y-3">
        <div>
          <h2 id="new-role-permissions" className="text-base font-semibold text-ink">
            Permissions
          </h2>
          <p className="text-xs text-ink-muted">Choose what people with this role can view or manage.</p>
        </div>
        <PermissionMatrix idPrefix="new-role-permission" value={permissions} onChange={setPermissions} />
      </section>

      <div className="flex items-center justify-end gap-3 rounded-card border border-line bg-surface p-4">
        <Button variant="secondary" onClick={() => router.push("/team/roles")}>
          Cancel
        </Button>
        <Button onClick={create}>Create role</Button>
      </div>
    </>
  );
}
