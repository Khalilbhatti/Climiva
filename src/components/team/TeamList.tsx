"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronRight, Info, Plus, Send, ShieldCheck, Users, Wrench } from "lucide-react";
import { useHoursRows } from "@/components/settings/SettingsProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { memberHref } from "@/config/routes";
import {
  CLASSIFICATION_LABEL,
  describeAvailability,
  getClassification,
  getRoleById,
  type AvailabilityMode,
  type Classification,
  type MemberStatus,
} from "@/data/team";
import { AddMemberModal } from "./AddMemberModal";
import { MemberStatusBadge } from "./MemberBadges";
import { useTeam } from "./TeamProvider";

const AVAILABILITY_FILTERS: { id: AvailabilityMode; label: string }[] = [
  { id: "business-hours", label: "Business hours" },
  { id: "custom", label: "Custom schedule" },
  { id: "not-set", label: "Not set" },
];

export function TeamList() {
  const { data } = useTeam();
  const hoursRows = useHoursRows();
  const router = useRouter();
  const params = useSearchParams();
  const adding = params.get("add") === "1";
  // "?state=solo" previews the approved single-owner state without having to remove everyone.
  const solo = params.get("state") === "solo";

  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [classification, setClassification] = useState<"all" | Classification>("all");
  const [status, setStatus] = useState<"all" | MemberStatus>("all");
  const [availability, setAvailability] = useState<"all" | AvailabilityMode>("all");

  const members = solo ? data.members.filter((member) => member.roleId === "owner") : data.members;
  const visible = members.filter((member) => {
    const haystack = `${member.name} ${member.email ?? ""} ${member.phone ?? ""} ${member.title ?? member.role}`.toLowerCase();
    return (
      haystack.includes(query.trim().toLowerCase()) &&
      (role === "all" || member.roleId === role) &&
      (classification === "all" || getClassification(member) === classification) &&
      (status === "all" || member.status === status) &&
      (availability === "all" || member.availability.mode === availability)
    );
  });
  const filtering = query.trim() !== "" || role !== "all" || classification !== "all" || status !== "all" || availability !== "all";

  const active = members.filter((member) => member.status === "active");
  const invited = members.filter((member) => member.status === "invited");
  const fieldAssignable = members.filter((member) => member.status === "active" && member.fieldAssignable);
  const office = active.filter((member) => getClassification(member) !== "field");
  const alone = members.length === 1;
  // Who may add a person or change a role is the owner or an admin; a member reads the team and is offered nothing to change.
  const canManage = useCan("team:manage");

  function setAdding(open: boolean) {
    const next = new URLSearchParams(params.toString());
    if (open) next.set("add", "1");
    else next.delete("add");
    const qs = next.toString();
    router.replace((qs ? `/team?${qs}` : "/team") as Route, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage the people who work in Climvia and control what they can access."
        actions={
          <>
            <ButtonLink href="/team/roles" variant="secondary" size="lg">
              <ShieldCheck aria-hidden className="size-[18px]" />
              {canManage ? "Manage roles" : "View roles"}
            </ButtonLink>
            {canManage && (
              <Button size="lg" onClick={() => setAdding(true)}>
                <Plus aria-hidden className="size-[18px]" />
                Add team member
              </Button>
            )}
          </>
        }
      />

      <section aria-label="Team summary" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total team members"
          value={members.length}
          icon={Users}
          hint={`${active.length} Active · ${invited.length} Pending invite${invited.length === 1 ? "" : "s"}`}
        />
        <KpiCard label="Field assignable" value={fieldAssignable.length} icon={Wrench} hint="Eligible for Job & Schedule assignment" />
        <KpiCard label="Office & admin" value={office.length} icon={Building2} hint="Owner, administrators and scheduling staff" />
        <KpiCard
          label="Pending invites"
          value={invited.length}
          icon={Send}
          hint={invited.length === 0 ? "None pending" : invited.map((member) => member.name).join(", ")}
        />
      </section>

      {alone && canManage && (
        <Card className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">You&rsquo;re currently the only person in this workspace.</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              You can run Climvia on your own or invite technicians and office staff when you&rsquo;re ready.
            </p>
          </div>
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            Add team member
          </Button>
        </Card>
      )}

      <Card padding="md" className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <SearchInput
            wrapperClassName="min-w-60 flex-1"
            aria-label="Search team members"
            placeholder="Search by name, email or phone..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="w-44">
            <Select label="Role" hideLabel value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="all">Role: All roles</option>
              {data.roles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-52">
            <Select
              label="Classification"
              hideLabel
              value={classification}
              onChange={(event) => setClassification(event.target.value as "all" | Classification)}
            >
              <option value="all">Classification: All</option>
              {Object.entries(CLASSIFICATION_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select label="Status" hideLabel value={status} onChange={(event) => setStatus(event.target.value as "all" | MemberStatus)}>
              <option value="all">Status: All statuses</option>
              <option value="active">Active</option>
              <option value="invited">Invitation pending</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div className="w-52">
            <Select
              label="Availability"
              hideLabel
              value={availability}
              onChange={(event) => setAvailability(event.target.value as "all" | AvailabilityMode)}
            >
              <option value="all">Availability: All</option>
              {AVAILABILITY_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>
          {filtering && (
            <Button
              variant="tertiary"
              onClick={() => {
                setQuery("");
                setRole("all");
                setClassification("all");
                setStatus("all");
                setAvailability("all");
              }}
            >
              Reset filters
            </Button>
          )}
        </div>

        <Table aria-label="Team members">
          <TableHead>
            <tr>
              <TableHeaderCell>Team member</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Field access</TableHeaderCell>
              <TableHeaderCell>Contact</TableHeaderCell>
              <TableHeaderCell>Availability</TableHeaderCell>
              <TableHeaderCell>Account status</TableHeaderCell>
              <TableHeaderCell>
                <span className="sr-only">Action</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                  No team members match your filters.
                </td>
              </tr>
            ) : (
              visible.map((member) => {
                const summary = describeAvailability(member.availability, hoursRows);
                const roleName = getRoleById(member.roleId, data)?.name ?? member.role;
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={member.name} size="lg" />
                        <div>
                          <Link href={memberHref(member.id)} className="font-semibold whitespace-nowrap text-ink hover:underline">
                            {member.name}
                          </Link>
                          <div className="text-xs text-ink-muted">{member.title ?? member.role}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{roleName}</TableCell>
                    <TableCell className="whitespace-nowrap">{CLASSIFICATION_LABEL[getClassification(member)]}</TableCell>
                    <TableCell>
                      {member.email || member.phone ? (
                        <>
                          {member.email && <div className="text-sm">{member.email}</div>}
                          {member.phone && <div className="text-xs text-ink-muted">{member.phone}</div>}
                        </>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56">
                      <div className="font-medium">{summary.title}</div>
                      <div className="text-xs text-ink-muted">{summary.detail}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <MemberStatusBadge status={member.status} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={memberHref(member.id)}
                        aria-label={`View member ${member.name}`}
                        className="inline-flex items-center gap-1 rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary-subtle"
                      >
                        View member
                        <ChevronRight aria-hidden className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <p aria-live="polite" className="text-xs text-ink-muted">
          Showing {visible.length} team member{visible.length === 1 ? "" : "s"}
        </p>
      </Card>

      <aside className="flex items-start gap-3 rounded-card border border-line bg-surface-low p-4 text-sm text-ink-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          <span className="font-semibold text-ink">Field assignment. </span>
          Team members marked as field-eligible can be assigned to Jobs and appear in Schedule. Permissions determine which parts of
          Climvia they can access.
        </p>
      </aside>

      {adding && canManage && <AddMemberModal onClose={() => setAdding(false)} />}
    </>
  );
}
