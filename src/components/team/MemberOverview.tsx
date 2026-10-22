"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardList, IdCard, ShieldCheck, Zap } from "lucide-react";
import { useOperations } from "@/components/operations/OperationsProvider";
import { EventStatusBadge } from "@/components/operations/StatusBadges";
import { useHoursRows, useSettings } from "@/components/settings/SettingsProvider";
import { cardClasses } from "@/components/ui/Card";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { jobHref, memberTabHref } from "@/config/routes";
import { getPartyName, getScheduleEvents, getServiceNameFor, type WorkEvent } from "@/data/operations";
import {
  MODULE_INFO,
  PERMISSION_LEVELS,
  WEEKDAY_NAMES,
  describeAvailability,
  getEffectivePermissions,
  getRoleById,
  type ModuleId,
} from "@/data/team";
import { cn } from "@/lib/cn";
import { formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { useMember } from "./MemberWorkspace";
import { useTeam } from "./TeamProvider";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan, useClock } from "@/components/workspace/WorkspaceProvider";

const ACCESS_SUMMARY: ModuleId[] = ["jobs", "schedule", "customers", "quotes-invoices", "payments", "team", "settings"];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const LEVEL_LABEL = Object.fromEntries(PERMISSION_LEVELS.map((level) => [level.id, level.label]));

export function MemberOverview() {
  const dir = useDirectory();
  const member = useMember();
  const { data: team, setFieldAssignable } = useTeam();
  const { data: operations } = useOperations();
  const { toast } = useToast();
  const canManage = useCan("team:manage");
  const { today } = useClock();
  const { settings } = useSettings();
  const hoursRows = useHoursRows();

  const upcoming = getScheduleEvents(operations)
    .filter((event): event is WorkEvent => event.kind === "work" && event.assigneeId === member.id && event.status !== "completed")
    .slice(0, 5);

  const availability = describeAvailability(member.availability, hoursRows);
  const workingDay = (day: number) =>
    member.availability.mode === "business-hours"
      ? Boolean(settings.hours[day])
      : member.availability.mode === "custom" && member.availability.weekly[day]?.enabled;
  const workingNames = WEEKDAY_NAMES.filter((_, day) => workingDay(day));

  const role = getRoleById(member.roleId, team);
  const permissions = getEffectivePermissions(member, team);
  const inactive = member.status === "inactive";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-8">
        <SectionCard title="Profile & access" icon={IdCard}>
          <KeyValueList
            layout="tiles"
            items={[
              { label: "Name", value: member.name },
              { label: "Job title", value: member.title ?? member.role },
              { label: "Primary email", value: member.email ?? "Not provided" },
              { label: "Direct phone", value: member.phone ?? "Not provided" },
            ]}
          />
          <div className="mt-4 flex items-start justify-between gap-4 rounded-card bg-surface-low p-4">
            <div>
              <p id="assignable-label" className="text-sm font-semibold text-ink">
                Assignable to jobs
              </p>
              <p id="assignable-hint" className="mt-0.5 text-xs text-ink-muted">
                When enabled, this person can be assigned to Jobs and can appear in Schedule assignment.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={member.fieldAssignable}
              aria-labelledby="assignable-label"
              aria-describedby="assignable-hint"
              disabled={inactive || !canManage}
              onClick={async () => {
                const turningOn = !member.fieldAssignable;
                const result = await setFieldAssignable(member.id, turningOn);
                toast(result.ok ? (turningOn ? `${member.name} is now assignable to Jobs.` : `${member.name} is no longer assignable to Jobs.`) : result.error);
              }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full px-1 py-1 pr-3 text-xs font-bold transition-colors disabled:opacity-50",
                member.fieldAssignable ? "bg-primary text-white" : "bg-line text-ink-muted",
              )}
            >
              <span aria-hidden className={cn("size-4 rounded-full", member.fieldAssignable ? "bg-white" : "bg-surface")} />
              {member.fieldAssignable ? "ENABLED" : "DISABLED"}
            </button>
          </div>
          <div className="mt-4">
            <h3 className="text-micro font-bold tracking-wider text-ink-muted uppercase">Skills & internal notes</h3>
            <p className="mt-1 text-sm text-ink">{member.notes ?? "No notes have been added."}</p>
          </div>
        </SectionCard>

        <SectionCard
          title="Current & upcoming jobs"
          description="Active assignments from Schedule and Jobs"
          icon={ClipboardList}
          action={
            <Link href="/schedule" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              Open in Schedule
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          }
        >
          {upcoming.length === 0 ? (
            <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No current or upcoming jobs are assigned to {member.name}.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-low p-4">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      #{event.id}
                      <EventStatusBadge status={event.status} />
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {getServiceNameFor(event, dir)} · {getPartyName(event, dir)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {event.date === today ? "Today" : formatWeekdayDate(event.date)}, {formatTimeRange(event.start, event.end)}
                    </p>
                  </div>
                  {event.jobId && (
                    <Link
                      href={jobHref(event.jobId)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      View job #{event.jobId}
                      <ArrowRight aria-hidden className="size-3.5" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="space-y-6 lg:col-span-4">
        <section aria-labelledby="quick-actions" className={cardClasses("md")}>
          <h2 id="quick-actions" className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
            <Zap aria-hidden className="size-4 text-primary" />
            Quick actions
          </h2>
          <ul className="space-y-1 text-sm font-medium">
            {[
              // Assigning a Job and blocking time are for whoever manages the team; everyone may look at the schedule.
              ...(canManage
                ? [
                    { href: "/jobs" as const, label: "Assign to job" },
                    { href: memberTabHref(member.id, "availability"), label: "Add unavailable time" },
                  ]
                : []),
              { href: "/schedule" as const, label: "View schedule" },
            ].map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="flex items-center justify-between rounded-btn px-2 py-2 text-ink transition-colors hover:bg-surface-low">
                  {item.label}
                  <ArrowRight aria-hidden className="size-4 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <SectionCard title="Weekly availability" icon={CalendarClock}>
          <KeyValueList
            items={[
              { label: "Working hours", value: availability.title },
              { label: "Days & times", value: availability.detail },
              { label: "Timezone", value: `${settings.preferences.timeZone} (Workspace default)` },
              {
                label: "Unavailable periods",
                value: member.availability.unavailable.length === 0 ? "None scheduled" : `${member.availability.unavailable.length} scheduled`,
              },
            ]}
          />
          <div className="mt-3">
            <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Active days</p>
            <ul aria-label={workingNames.length ? `Working days: ${workingNames.join(", ")}` : "No working days set"} className="mt-1.5 flex gap-1.5">
              {DAY_LETTERS.map((letter, day) => (
                <li
                  key={WEEKDAY_NAMES[day]}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-xs font-bold",
                    workingDay(day) ? "bg-primary text-white" : "bg-surface-low text-ink-muted",
                  )}
                >
                  <span aria-hidden>{letter}</span>
                  <span className="sr-only">
                    {WEEKDAY_NAMES[day]}: {workingDay(day) ? "working" : "off"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <Link
            href={memberTabHref(member.id, "availability")}
            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            {canManage ? "Manage availability & hours" : "View availability & hours"}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </SectionCard>

        <SectionCard title="Role & access" icon={ShieldCheck}>
          <p className="text-sm font-semibold text-ink">Role: {role?.name ?? member.role}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{role?.description}</p>
          <KeyValueList
            className="mt-3"
            items={ACCESS_SUMMARY.map((id) => ({ label: MODULE_INFO[id].label, value: LEVEL_LABEL[permissions[id]] }))}
          />
          <Link
            href={memberTabHref(member.id, "permissions")}
            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            {canManage ? "View or customize permissions" : "View permissions"}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </SectionCard>
      </div>
    </div>
  );
}

