"use client";

import { useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AssignDialog } from "@/components/operations/AssignDialog";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useTimeZoneLabel } from "@/components/settings/SettingsProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { PROTOTYPE_TODAY } from "@/data/fixtures";
import {
  getPartyName,
  getScheduleEvents,
  getServiceNameFor,
  type ScheduleEvent,
  type WorkEvent,
} from "@/data/operations";
import { SERVICES } from "@/data/services";
import { useTeam } from "@/components/team/TeamProvider";
import { getAssignableMembers } from "@/data/team";
import { addDays, formatLongDate, formatTimeRange, formatWeekdayDate, formatWeekRange, isValidDate, startOfWeek } from "@/lib/dates";
import { EventDetails } from "./EventDetails";
import { DayTimeline, UnassignedBanner, UnassignedPanel, WeekBoard } from "./ScheduleBoards";

type View = "day" | "week";

export function ScheduleView() {
  const { data, assign } = useOperations();
  const { data: team } = useTeam();
  const { toast } = useToast();
  const timeZone = useTimeZoneLabel();
  const router = useRouter();
  const params = useSearchParams();

  // View, date and selected event live in the URL so a schedule position can be linked to.
  const view: View = params.get("view") === "day" ? "day" : "week";
  const dateParam = params.get("date");
  const date = isValidDate(dateParam) ? dateParam : PROTOTYPE_TODAY;
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
  const isCurrent = view === "day" ? date === PROTOTYPE_TODAY : startOfWeek(PROTOTYPE_TODAY) === weekStart;
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
  const goTo = (target: string) => setParams({ date: target === PROTOTYPE_TODAY ? null : target, event: null });

  const heading = view === "day" ? `${date === PROTOTYPE_TODAY ? "Today, " : ""}${formatLongDate(date)}` : formatWeekRange(weekStart);
  const details = selectedEvent ? <EventDetails event={selectedEvent} onClose={closeDetails} /> : null;

  return (
    <>
      <PageHeader title="Schedule" description="See upcoming work, assign technicians and manage appointment times." />

      <Card padding="md" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-btn border border-line p-1">
              <Button variant="tertiary" size="sm" onClick={() => goTo(PROTOTYPE_TODAY)} disabled={isCurrent && !dateParam}>
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
                {SERVICES.map((item) => (
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
        </div>
      </Card>

      <div role="tabpanel" id={`schedule-panel-${view}`} aria-labelledby={`schedule-tab-${view}`} className="space-y-4">
        {view === "week" ? (
          <>
            <UnassignedBanner events={unassigned} onAssign={setAssigning} />
            <WeekBoard date={date} events={visibleEvents} selectedId={selectedEvent?.id ?? null} onSelect={select} />
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
            <UnassignedPanel events={unassigned} onAssign={setAssigning} />
            <div className="space-y-3">
              <DayTimeline events={visibleEvents} members={members} selectedId={selectedEvent?.id ?? null} onSelect={select} />
              <p className="text-xs text-ink-muted">Select any block to see its details.</p>
            </div>
            {details}
          </div>
        )}
      </div>

      {assigning && (
        <AssignDialog
          description={`${getServiceNameFor(assigning)} for ${getPartyName(assigning)} · ${formatWeekdayDate(assigning.date)}, ${formatTimeRange(assigning.start, assigning.end)}`}
          currentAssigneeId={assigning.assigneeId}
          onClose={() => setAssigning(null)}
          onAssign={(memberId) => {
            assign({ bookingId: assigning.bookingId, jobId: assigning.jobId }, memberId);
            setAssigning(null);
            toast(memberId ? `${getPartyName(assigning)} assigned.` : `${getPartyName(assigning)} is unassigned.`);
          }}
        />
      )}
    </>
  );
}
