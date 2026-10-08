"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Eye, Pencil, Plus, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Tabs } from "@/components/ui/Tabs";
import { roleHref } from "@/config/routes";
import { MODULE_IDS, getMembersForRole, type Role } from "@/data/team";
import { useTeam } from "./TeamProvider";

type TypeFilter = "all" | "system" | "custom";

function accessSummary(role: Role): string {
  const levels = MODULE_IDS.map((id) => role.permissions[id]);
  const count = (level: string) => levels.filter((item) => item === level).length;
  return `Manage ${count("manage")} · View ${count("view")} · No access ${count("none")}`;
}

export function RolesList() {
  const { data } = useTeam();
  const [type, setType] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");

  const counts = {
    all: data.roles.length,
    system: data.roles.filter((role) => role.kind === "system").length,
    custom: data.roles.filter((role) => role.kind === "custom").length,
  };
  const visible = data.roles.filter(
    (role) =>
      (type === "all" || role.kind === type) &&
      `${role.name} ${role.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <BackLink href="/team">Back to Team</BackLink>
      <PageHeader
        title="Roles & permissions"
        description="Control what different people can view and manage in Climvia."
        actions={
          <ButtonLink href="/team/roles/new" size="lg">
            <Plus aria-hidden className="size-[18px]" />
            Create role
          </ButtonLink>
        }
      />

      <p className="flex items-start gap-2 rounded-card border border-line bg-surface-low p-4 text-sm text-ink-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        Roles define which parts of Climvia a team member can access. Job assignment eligibility is configured separately on each team
        member.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Role types"
          idPrefix="roles"
          value={type}
          onChange={(id) => setType(id as TypeFilter)}
          tabs={[
            { id: "all", label: "All", count: counts.all },
            { id: "system", label: "System", count: counts.system },
            { id: "custom", label: "Custom", count: counts.custom },
          ]}
        />
        <SearchInput
          wrapperClassName="w-64"
          aria-label="Search roles"
          placeholder="Search roles..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div role="tabpanel" id={`roles-panel-${type}`} aria-labelledby={`roles-tab-${type}`}>
        {visible.length === 0 ? (
          <p className="rounded-card bg-surface-low p-6 text-center text-sm text-ink-muted">No roles match your search.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((role) => {
              const members = getMembersForRole(role.id, data);
              return (
                <li key={role.id} className={cardClasses("lg", "flex flex-col gap-4")}>
                  <article aria-labelledby={`role-${role.id}`} className="flex flex-1 flex-col gap-4">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 id={`role-${role.id}`} className="text-base font-semibold text-ink">
                          {role.name}
                        </h2>
                        <span className="rounded-full bg-surface-low px-2.5 py-0.5 text-xs font-semibold text-ink-muted">
                          {role.kind === "custom" ? "Custom role" : role.protected ? "System role · Protected" : "System role"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink-muted">{role.description}</p>
                      <p className="mt-2 text-xs font-medium text-ink-muted">{accessSummary(role)}</p>
                    </div>

                    <div className="flex-1">
                      <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Assigned members</p>
                      {members.length === 0 ? (
                        <p className="mt-1 text-sm text-ink-muted">0 members</p>
                      ) : (
                        <ul className="mt-1.5 space-y-1">
                          {members.map((member) => (
                            <li key={member.id} className="flex items-center gap-2 text-sm text-ink">
                              <Avatar name={member.name} />
                              {member.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm font-semibold">
                      {role.protected ? (
                        <Link
                          href={roleHref(role.id)}
                          aria-label={`View permissions for ${role.name}`}
                          className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-primary hover:bg-primary-subtle"
                        >
                          <Eye aria-hidden className="size-4" />
                          View permissions
                        </Link>
                      ) : (
                        <Link
                          href={roleHref(role.id)}
                          aria-label={`Edit ${role.name} role`}
                          className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-primary hover:bg-primary-subtle"
                        >
                          <Pencil aria-hidden className="size-4" />
                          Edit
                        </Link>
                      )}
                      {!role.protected && (
                        <Link
                          href={`/team/roles/new?from=${role.id}`}
                          aria-label={`Duplicate ${role.name} role`}
                          className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-primary hover:bg-primary-subtle"
                        >
                          <Copy aria-hidden className="size-4" />
                          Duplicate
                        </Link>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
