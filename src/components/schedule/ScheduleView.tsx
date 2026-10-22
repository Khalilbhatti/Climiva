"use client";

import { useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { AssignDialog } from "@/components/operations/AssignDialog";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useSettings, useTimeZoneLabel } from "@/components/settings/SettingsProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import {
  getPartyName,
  getScheduleEvents,
  getServiceNameFor,
  type ScheduleEvent,
  type WorkEvent,
} from "@/data/operations";
import { useTeam } from "@/components/team/TeamProvider";
import { WEEKDAY_NAMES } from "@/data/settings";
import { getAssignableMembers } from "@/data/team";
import { addDays, formatLongDate, formatTime, formatTimeRange, formatWeekdayDate, formatWeekRange, isValidDate, startOfWeek, weekDates, weekdayIndex } from "@/lib/dates";
import { EventDetails } from "./EventDetails";
import { DayStrip, DayTimeline, ScheduleLegend, UnassignedBanner, UnassignedPanel, WeekBoard } from "./ScheduleBoards";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan, useClock } from "@/components/workspace/WorkspaceProvider";

type View = "day" | "week";

export function ScheduleView() {
  const dir = useDirectory();
  const { data, assign } = useOperations();
  const { data: team } = useTeam();
  const { toast } = useToast();
  const timeZone = useTimeZoneLabel();
  const { today, now } = useClock();
  const { hours } = useSettings().settings;
  const canManage = useCan("operations:manage");
  const router = useRouter();
  const params = useSearchParams();

  // View, date and selected event live in the URL so a schedule position can be linked to.
  const view: View = params.get("view") === "day" ? "day" : "week";
  const dateParam = params.get("date");
  const date = isValidDate(dateParam) ? dateParam : today;
  const selectedId = params.get("event");

  const [technician, setTechnician] = useState("all");
  const [service, setService] = useState("all");
  const [assigning, setAssigning] = useState<WorkEvent | null>(null);

  function setParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.replace((qs ? `/schedule?${qs}` : "/schedule") as Route, { scroll: false });
  }

  const allEvents = getScheduleEvents(data);
  const matches = (event: ScheduleEvent) =>
    (service === "all" || event.kind === "block" || event.serviceId === service) &&
    (technician === "all" ||
      (event.kind === "block" ? event.memberIds.includes(technician) : event.assigneeId === technician));

  const shown = allEvents.filter(matches);
  const visibleEvents = view === "day" ? shown.filter((event) => event.date === date) : shown;
  const unassigned = allEvents.filter(
    (event): event is WorkEvent =>
      event.kind === "work" && !event.assigneeId && event.status !== "completed" && (service === "all" || event.serviceId === service),
  );

  // Creating a job swaps a booking's event id for the job's id, so also match on the booking id.
  const selectedEvent = selectedId
    ? allEvents.find((event) => event.id === selectedId || (event.kind === "work" && event.bookingId === selectedId))
    : undefined;
  const step = view === "day" ? 1 : 7;
  const weekStart = startOfWeek(date);
  const isCurrent = view === "day" ? date === today : startOfWeek(today) === weekStart;
  // Timeline rows: everyone who can take work, plus anyone no longer assignable (deactivated) who still has
  // work on the days shown, so history is never hidden.
  const worksInView = (id: string) =>
    visibleEvents.some((event) => (event.kind === "block" ? event.memberIds.includes(id) : event.assigneeId === id));
  const rosterMembers = team.members.filter((member) => member.status !== "invited");
  const assignableCount = getAssignableMembers(team).length;
  const timelineMembers = rosterMembers.filter(
    (member) => (member.status === "active" && member.fieldAssignable) || worksInView(member.id),
  );
  const members = technician === "all" ? timelineMembers : timelineMembers.filter((member) => member.id === technician);
  const filtering = technician !== "all" || service !== "all";

  function closeDetails() {
    const id = selectedId;
    setParams({ event: null });
    requestAnimationFrame(() => document.getElementById(`event-${id}`)?.focus());
  }

  const select = (event: ScheduleEvent) => setParams({ event: event.id });
  const goTo = (target: string) => setParams({ date: target === today ? null : target, event: null });

  const heading = view === "day" ? `${date === today ? "Today, " : ""}${formatLongDate(date)}` : formatWeekRange(weekStart);
  // What the period shown holds, in a line: how much work, what is under way, and what still needs a technician.
  const periodDays = view === "day" ? [date] : weekDates(date);
  const periodWork = shown.filter((event): event is WorkEvent => event.kind === "work" && periodDays.includes(event.date));
  const inProgress = periodWork.filter((event) => event.status === "in-progress").length;
  const waiting = unassigned.filter((event) => periodDays.includes(event.date)).length;
  const dayHours = hours[weekdayIndex(date)];
  const dayItems = shown.filter((event) => event.date === date).length;
  const details = selectedEvent ? <EventDetails event={selectedEvent} onClose={closeDetails} /> : null;

  return (
    <>
      <PageHeader title="Schedule" description="See upcoming work, assign technicians and manage appointment times." />

      <Card padding="md" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-btn border border-line p-1">
              <Button variant="tertiary" size="sm" onClick={() => goTo(today)} disabled={isCurrent && !dateParam}>
                Today
              </Button>
              <button
                type="button"
                aria-label={view === "day" ? "Previous day" : "Previous week"}
                onClick={() => goTo(addDays(date, -step))}
                className="rounded-btn p-1.5 text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
              >
                <ChevronLeft aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label={view === "day" ? "Next day" : "Next week"}
                onClick={() => goTo(addDays(date, step))}
                className="rounded-btn p-1.5 text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
              >
                <ChevronRight aria-hidden className="size-4" />
              </button>
            </div>
            <h2 aria-live="polite" className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">
              {heading}
              {view === "week" && isCurrent && (
                <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs font-medium text-ink-muted">Current</span>
              )}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="w-48">
              <Select label="Technician" hideLabel value={technician} onChange={(event) => setTechnician(event.target.value)}>
                <option value="all">All technicians ({assignableCount})</option>
                {rosterMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-52">
              <Select label="Service" hideLabel value={service} onChange={(event) => setService(event.target.value)}>
                <option value="all">All services</option>
                {dir.services.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </div>
            {filtering && (
              <Button
                variant="tertiary"
                onClick={() => {
                  setTechnician("all");
                  setService("all");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Tabs
            variant="segmented"
            label="Schedule view"
            idPrefix="schedule"
            value={view}
            onChange={(id) => setParams({ view: id, event: null })}
            tabs={[
              { id: "day", label: "Day" },
              { id: "week", label: "Week" },
            ]}
          />
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            {timeZone}
          </p>
          <p aria-live="polite" className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            <span>
              <span className="font-semibold text-ink">{periodWork.length}</span> {periodWork.length === 1 ? "visit" : "visits"} {view === "day" ? "this day" : "this week"}
            </span>
            {inProgress > 0 && (
              <span>
                <span className="font-semibold text-primary">{inProgress}</span> in progress
              </span>
            )}
            {waiting > 0 && (
              <span>
                <span className="font-semibold text-danger">{waiting}</span> still {waiting === 1 ? "needs" : "need"} a technician
              </span>
            )}
            {view === "day" && date === today && <span>It is {formatTime(now.split("T")[1].slice(0, 5))} now.</span>}
          </p>
        </div>
      </Card>

      {allEvents.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="Nothing is scheduled yet"
          description="Confirmed bookings and jobs appear here as soon as they exist."
          action={
            canManage ? (
              <ButtonLink href="/bookings?new=1" size="lg">
                Create a booking
              </ButtonLink>
            ) : undefined
          }
        />
      )}

      <div role="tabpanel" id={`schedule-panel-${view}`} aria-labelledby={`schedule-tab-${view}`} className="space-y-4">
        {view === "week" ? (
          <>
            <UnassignedBanner events={unassigned} onAssign={canManage ? setAssigning : undefined} />
            <WeekBoard date={date} events={visibleEvents} selectedId={selectedEvent?.id ?? null} onSelect={select} onOpenDay={(day) => setParams({ view: "day", date: day === today ? null : day, event: null })} />
            <ScheduleLegend showHours={false} />
            {details}
          </>
        ) : (
          <div
            className={
              details
                ? "grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[14rem_minmax(0,1fr)_23rem]"
                : "grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[14rem_minmax(0,1fr)]"
            }
          >
            <UnassignedPanel events={unassigned} onAssign={canManage ? setAssigning : undefined} />
            <div className="min-w-0 space-y-3">
              <DayStrip date={date} events={shown} onPick={goTo} />
              {dayHours === null && (
                <p className="rounded-btn bg-surface-low px-4 py-2.5 text-sm text-ink-muted">
                  Your business hours say you are closed on {WEEKDAY_NAMES[weekdayIndex(date)]}s.{dayItems > 0 ? " Work already scheduled for this day is still shown." : ""}
                </p>
              )}
              {dayHours !== null && dayItems === 0 && <p className="rounded-btn bg-surface-low px-4 py-2.5 text-sm text-ink-muted">Nothing is scheduled for this day.</p>}
              <DayTimeline
                date={date}
                hours={dayHours}
                now={date === today ? now.split("T")[1].slice(0, 5) : undefined}
                events={visibleEvents}
                members={members}
                selectedId={selectedEvent?.id ?? null}
                onSelect={select}
              />
              <ScheduleLegend showHours />
              <p className="text-xs text-ink-muted">Select any block to see its details.</p>
            </div>
            {details}
          </div>
        )}
      </div>

      {assigning && (
        <AssignDialog
          description={`${getServiceNameFor(assigning, dir)} for ${getPartyName(assigning, dir)} · ${formatWeekdayDate(assigning.date)}, ${formatTimeRange(assigning.start, assigning.end)}`}
          currentAssigneeId={assigning.assigneeId}
          onClose={() => setAssigning(null)}
          onAssign={async (memberId) => {
            const result = await assign({ bookingId: assigning.bookingId, jobId: assigning.jobId }, memberId);
            if (!result.ok) return result.error;
            setAssigning(null);
            toast(memberId ? `${getPartyName(assigning, dir)} assigned.` : `${getPartyName(assigning, dir)} is unassigned.`);
          }}
        />
      )}
    </>
  );
}
