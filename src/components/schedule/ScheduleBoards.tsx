"use client";

import { Check, Clock, Lock, UserX } from "lucide-react";
import { EventStatusBadge } from "@/components/operations/StatusBadges";
import { useSettings } from "@/components/settings/SettingsProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { PROTOTYPE_TODAY } from "@/data/fixtures";
import {
  EVENT_STATUS_LABEL,
  getPartyName,
  getServiceNameFor,
  type ScheduleEvent,
  type ScheduleEventStatus,
  type WorkEvent,
} from "@/data/operations";
import { getTeamMemberById, type TeamMember } from "@/data/team";
import {
  formatMonthDay,
  formatTime,
  formatTimeRange,
  formatWeekday,
  formatWeekdayDate,
  timeToMinutes,
  weekDates,
  weekdayIndex,
} from "@/lib/dates";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

/** Left accent colour per status, matching the StatusBadge tones. */
const STATUS_ACCENT: Record<ScheduleEventStatus, string> = {
  confirmed: "border-l-positive",
  scheduled: "border-l-warning",
  "in-progress": "border-l-primary",
  completed: "border-l-line-strong",
};

type BoardProps = {
  events: ScheduleEvent[];
  selectedId: string | null;
  onSelect: (event: ScheduleEvent) => void;
};

/* ───────────────────────── week ───────────────────────── */

export function WeekBoard({ date, events, selectedId, onSelect }: BoardProps & { date: string }) {
  // A day is closed when the saved business hours say so.
  const { hours } = useSettings().settings;
  return (
    <ol aria-label="Week schedule" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
      {weekDates(date).map((day) => {
        const dayEvents = events.filter((event) => event.date === day);
        const closed = hours[weekdayIndex(day)] === null;
        const today = day === PROTOTYPE_TODAY;

        return (
          <li
            key={day}
            aria-label={formatWeekdayDate(day)}
            className={cn(
              "flex min-h-40 flex-col gap-2 rounded-card border bg-surface p-2.5",
              today ? "border-primary shadow-card" : "border-line",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-1 px-1">
              <div>
                <p className="flex items-center gap-1.5 text-micro font-bold tracking-wider text-ink-muted uppercase">
                  {formatWeekday(day)}
                  {today && <span className="rounded bg-primary px-1.5 py-0.5 text-white">Today</span>}
                </p>
                <p className="text-base font-bold text-ink">{formatMonthDay(day)}</p>
              </div>
              <span className="rounded bg-surface-low px-1.5 py-0.5 text-mini font-medium whitespace-nowrap text-ink-muted">
                {closed && dayEvents.length === 0 ? "Closed" : `${dayEvents.length} ${dayEvents.length === 1 ? "item" : "items"}`}
              </span>
            </div>

            {dayEvents.map((event) => (
              <WeekCard key={event.id} event={event} selected={selectedId === event.id} onSelect={onSelect} />
            ))}
          </li>
        );
      })}
    </ol>
  );
}

function WeekCard({ event, selected, onSelect }: { event: ScheduleEvent; selected: boolean; onSelect: (event: ScheduleEvent) => void }) {
  const dir = useDirectory();
  if (event.kind === "block") {
    return (
      <button
        type="button"
        id={`event-${event.id}`}
        aria-pressed={selected}
        onClick={() => onSelect(event)}
        className={cn(
          "rounded-btn border border-dashed border-line-strong bg-surface-low p-2 text-left transition-colors hover:border-primary",
          selected && "border-primary",
        )}
      >
        <span className="flex items-center gap-1 text-xs font-semibold text-ink">
          <Lock aria-hidden className="size-3" />
          {event.title}
        </span>
        <span className="block text-mini text-ink-muted">{formatTimeRange(event.start, event.end)}</span>
        <span className="block text-mini text-ink-muted">Internal blocked time</span>
      </button>
    );
  }

  const assignee = getTeamMemberById(event.assigneeId, dir.team);
  return (
    <button
      type="button"
      id={`event-${event.id}`}
      aria-pressed={selected}
      onClick={() => onSelect(event)}
      className={cn(
        "rounded-btn border border-l-4 border-line bg-canvas p-2 text-left transition-colors hover:border-primary hover:bg-surface",
        STATUS_ACCENT[event.status],
        selected && "border-primary bg-surface ring-1 ring-primary",
      )}
    >
      <span className="block text-mini font-medium text-ink-muted">{formatTimeRange(event.start, event.end)}</span>
      <span className="mt-0.5 block">
        <EventStatusBadge status={event.status} />
      </span>
      <span className="mt-1 block text-sm leading-tight font-semibold text-ink">{getPartyName(event, dir)}</span>
      <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">{getServiceNameFor(event, dir)}</span>
      <span className="mt-1.5 flex items-center gap-1.5 text-mini text-ink-muted">
        {assignee ? (
          <>
            <Avatar name={assignee.name} />
            {assignee.name.split(" ")[0]}
          </>
        ) : (
          <>
            <UserX aria-hidden className="size-3.5" />
            Unassigned
          </>
        )}
        {event.status === "completed" && <Check aria-hidden className="ml-auto size-3.5 text-positive" />}
      </span>
    </button>
  );
}

/* ───────────────────────── day ───────────────────────── */

const DAY_START = 8 * 60;
const DAY_END = 18 * 60;
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, index) => DAY_START / 60 + index);

type Placed = { event: ScheduleEvent; lane: number };

/** Stack events that overlap in time into lanes so none is hidden. */
function placeInLanes(events: ScheduleEvent[]): { placed: Placed[]; lanes: number } {
  const laneEnds: number[] = [];
  const placed = [...events]
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
    .map((event) => {
      let lane = laneEnds.findIndex((end) => end <= timeToMinutes(event.start));
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = timeToMinutes(event.end);
      return { event, lane };
    });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

export function DayTimeline({ events, members, selectedId, onSelect }: BoardProps & { members: readonly TeamMember[] }) {
  const span = DAY_END - DAY_START;

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[10.5rem_1fr] border-b border-line bg-surface-low text-micro font-bold tracking-wider text-ink-muted uppercase">
          <div className="px-4 py-3">Technician</div>
          <div className="relative h-10" aria-hidden>
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="absolute top-3 -translate-x-1/2 text-mini font-semibold normal-case"
                style={{ left: `${((hour * 60 - DAY_START) / span) * 100}%` }}
              >
                {formatTime(`${String(hour).padStart(2, "0")}:00`).replace(":00", "")}
              </span>
            ))}
          </div>
        </div>

        <ul aria-label="Technician timelines">
          {members.map((member) => {
            const memberEvents = events.filter((event) =>
              event.kind === "block" ? event.memberIds.includes(member.id) : event.assigneeId === member.id,
            );
            const { placed, lanes } = placeInLanes(memberEvents);
            const laneHeight = 64;

            return (
              <li key={member.id} className="grid grid-cols-[10.5rem_1fr] border-b border-line last:border-b-0">
                <div className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={member.name} />
                  <div>
                    <p className="text-sm font-semibold text-ink">{member.name}</p>
                    <p className="text-xs text-ink-muted">{member.role}</p>
                  </div>
                </div>
                <div className="relative" style={{ height: lanes * laneHeight + 12 }}>
                  {HOURS.map((hour) => (
                    <span
                      key={hour}
                      aria-hidden
                      className="absolute inset-y-0 border-l border-line/70"
                      style={{ left: `${((hour * 60 - DAY_START) / span) * 100}%` }}
                    />
                  ))}
                  {placed.map(({ event, lane }) => {
                    const start = Math.max(timeToMinutes(event.start), DAY_START);
                    const end = Math.min(timeToMinutes(event.end), DAY_END);
                    return (
                      <TimelineBlock
                        key={event.id}
                        event={event}
                        selected={selectedId === event.id}
                        onSelect={onSelect}
                        style={{
                          left: `calc(${((start - DAY_START) / span) * 100}% + 2px)`,
                          width: `calc(${((end - start) / span) * 100}% - 4px)`,
                          top: lane * laneHeight + 6,
                          height: laneHeight - 6,
                        }}
                      />
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function TimelineBlock({
  event,
  selected,
  onSelect,
  style,
}: {
  event: ScheduleEvent;
  selected: boolean;
  onSelect: (event: ScheduleEvent) => void;
  style: React.CSSProperties;
}) {
  const dir = useDirectory();
  const common = "absolute overflow-hidden rounded-btn border px-2 py-1 text-left transition-colors";

  if (event.kind === "block") {
    return (
      <button
        type="button"
        id={`event-${event.id}`}
        aria-pressed={selected}
        title={`${event.title} · ${formatTimeRange(event.start, event.end)}`}
        onClick={() => onSelect(event)}
        style={style}
        className={cn(common, "border-dashed border-line-strong bg-surface-low text-ink-muted hover:border-primary", selected && "border-primary")}
      >
        <span className="flex items-center gap-1 text-xs font-semibold">
          <Lock aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{event.title}</span>
        </span>
        <span className="block truncate text-mini">{formatTimeRange(event.start, event.end)}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      id={`event-${event.id}`}
      aria-pressed={selected}
      title={`${getPartyName(event, dir)} · ${getServiceNameFor(event, dir)} · ${formatTimeRange(event.start, event.end)} · ${EVENT_STATUS_LABEL[event.status]}`}
      onClick={() => onSelect(event)}
      style={style}
      className={cn(
        common,
        "border-l-4 border-line bg-canvas hover:border-primary hover:bg-surface",
        STATUS_ACCENT[event.status],
        event.status === "in-progress" && "bg-primary-subtle",
        selected && "border-primary bg-surface ring-1 ring-primary",
      )}
    >
      <span className="block truncate text-xs font-semibold text-ink">{getPartyName(event, dir)}</span>
      <span className="block truncate text-mini text-ink-muted">{getServiceNameFor(event, dir)}</span>
      <span className="flex items-center gap-1 truncate text-mini text-ink-muted">
        <Clock aria-hidden className="size-3 shrink-0" />
        {formatTimeRange(event.start, event.end)}
      </span>
    </button>
  );
}

/* ───────────────────────── unassigned ───────────────────────── */

type UnassignedProps = { events: WorkEvent[]; onAssign: (event: WorkEvent) => void };

/** Confirmed work that still needs a technician. Assigning is a button, not a drag. */
export function UnassignedPanel({ events, onAssign }: UnassignedProps) {
  const dir = useDirectory();
  return (
    <section aria-labelledby="unassigned-heading" className="rounded-card border border-line bg-surface p-4">
      <h2 id="unassigned-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
        Unassigned
        <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">{events.length}</span>
      </h2>
      <p className="mt-1 text-xs text-ink-muted">Confirmed work that still needs a technician.</p>
      {events.length === 0 ? (
        <p className="mt-3 rounded-btn bg-surface-low p-3 text-sm text-ink-muted">All confirmed work has a technician.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-btn bg-surface-low p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">{getPartyName(event, dir)}</span>
                <span className="rounded bg-surface px-1.5 py-0.5 text-mini font-medium text-ink-muted">
                  {formatWeekdayDate(event.date)}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-primary">{getServiceNameFor(event, dir)}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
                <Clock aria-hidden className="size-3" />
                {formatTimeRange(event.start, event.end)}
              </p>
              <Button size="sm" className="mt-2" onClick={() => onAssign(event)} aria-label={`Assign technician to ${getPartyName(event, dir)}`}>
                Assign
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function UnassignedBanner({ events, onAssign }: UnassignedProps) {
  const dir = useDirectory();
  if (events.length === 0) return null;
  return (
    <section
      aria-label="Unassigned work"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-surface px-4 py-3"
    >
      <span className="rounded-full bg-danger-soft px-2.5 py-1 text-xs font-bold text-danger">Unassigned · {events.length}</span>
      <p className="text-sm text-ink">Confirmed work awaiting assignment:</p>
      <ul className="flex flex-wrap gap-2">
        {events.map((event) => (
          <li key={event.id} className="flex items-center gap-2 rounded-btn bg-surface-low py-1 pr-1 pl-3 text-sm">
            <span className="text-ink">
              {getPartyName(event, dir)} <span className="text-ink-muted">({formatMonthDay(event.date)})</span>
            </span>
            <Button size="sm" onClick={() => onAssign(event)} aria-label={`Assign technician to ${getPartyName(event, dir)}`}>
              Assign
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
