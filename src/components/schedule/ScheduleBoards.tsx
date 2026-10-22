"use client";

import type { CSSProperties } from "react";
import { Check, Clock, Lock, UserX } from "lucide-react";
import { EventStatusBadge } from "@/components/operations/StatusBadges";
import { useSettings } from "@/components/settings/SettingsProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  EVENT_STATUS_LABEL,
  getPartyName,
  getServiceNameFor,
  type ScheduleEvent,
  type ScheduleEventStatus,
  type WorkEvent,
} from "@/data/operations";
import { getServiceById, type Service } from "@/data/services";
import type { DayHours } from "@/data/settings";
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
import { useClock } from "@/components/workspace/WorkspaceProvider";

/** Left accent colour per status, matching the StatusBadge tones. */
const STATUS_ACCENT: Record<ScheduleEventStatus, string> = {
  confirmed: "border-l-positive",
  scheduled: "border-l-warning",
  "in-progress": "border-l-primary",
  completed: "border-l-line-strong",
};

/** The same colours as a dot, so a status is never told by the edge colour alone: the word comes with it. */
const STATUS_DOT: Record<ScheduleEventStatus, string> = {
  confirmed: "bg-positive",
  scheduled: "bg-warning",
  "in-progress": "bg-primary",
  completed: "bg-ink-muted",
};

/** A hatching laid over an arrival window: the customer was given a stretch of time to expect the technician in, not a minute. */
const WINDOW_HATCH =
  "[background-image:repeating-linear-gradient(135deg,transparent_0,transparent_6px,rgb(13_92_99/0.08)_6px,rgb(13_92_99/0.08)_12px)]";

type BoardProps = {
  events: ScheduleEvent[];
  selectedId: string | null;
  onSelect: (event: ScheduleEvent) => void;
};

/**
 * What the time on a card means. A request for an appointment is booked into an arrival window (the Service's own "2-hour arrival window") and a quote
 * request is an in-home assessment; only an instant booking is a time to the minute. Once the visit is under way or done the time is simply the time.
 * The times themselves are the records' own: this only says what kind of time they are.
 */
function timeKind(event: WorkEvent, services: readonly Service[]): "window" | "assessment" | "exact" {
  if (event.status === "in-progress" || event.status === "completed") return "exact";
  const method = getServiceById(event.serviceId, services)?.bookingMethod;
  return method === "request-appointment" ? "window" : method === "request-quote" ? "assessment" : "exact";
}

const KIND_LABEL = { window: "Arrival window", assessment: "Assessment visit", exact: "" } as const;

/* ───────────────────────── legend ───────────────────────── */

/** How to read the boards: what the colours, the hatching and the dashes mean. Plain words, so nobody has to guess. */
export function ScheduleLegend({ showHours }: { showHours: boolean }) {
  const dot = (tone: string) => <span aria-hidden className={cn("size-2 rounded-full", tone)} />;
  return (
    <ul aria-label="How to read the schedule" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-muted">
      <li className="flex items-center gap-1.5">
        {dot(STATUS_DOT.confirmed)}
        Confirmed
      </li>
      <li className="flex items-center gap-1.5">
        {dot(STATUS_DOT.scheduled)}
        Scheduled
      </li>
      <li className="flex items-center gap-1.5">
        {dot(STATUS_DOT["in-progress"])}
        In progress
      </li>
      <li className="flex items-center gap-1.5">
        {dot(STATUS_DOT.completed)}
        Completed
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className={cn("h-3 w-5 rounded-sm border border-line bg-canvas", WINDOW_HATCH)} />
        Hatched: an arrival window, not an exact time
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-5 rounded-sm border border-dashed border-line-strong bg-surface-low" />
        Dashed: blocked time
      </li>
      {showHours && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-5 rounded-sm bg-surface-low" />
          Shaded: outside business hours
        </li>
      )}
    </ul>
  );
}

/* ───────────────────────── day strip ───────────────────────── */

/** The seven days of the week being looked at, each with how many things are on it, so another day is one press away. */
export function DayStrip({ date, events, onPick }: { date: string; events: ScheduleEvent[]; onPick: (day: string) => void }) {
  const clock = useClock();
  return (
    <div role="group" aria-label="Days of this week" className="grid grid-cols-7 gap-1.5">
      {weekDates(date).map((day) => {
        const count = events.filter((event) => event.date === day).length;
        const selected = day === date;
        const today = day === clock.today;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={selected}
            aria-label={`${formatWeekdayDate(day)}, ${count} ${count === 1 ? "item" : "items"}${today ? ", today" : ""}`}
            onClick={() => onPick(day)}
            className={cn(
              "flex min-w-0 flex-col items-center rounded-btn border px-1 py-1.5 text-center transition-colors",
              selected ? "border-primary bg-primary text-white" : "border-line bg-surface text-ink hover:border-primary hover:bg-surface-low",
            )}
          >
            <span className={cn("text-micro font-bold tracking-wider uppercase", selected ? "text-white" : "text-ink-muted")}>
              {formatWeekday(day)}
              {today && " · Today"}
            </span>
            <span className="text-sm font-bold">{formatMonthDay(day)}</span>
            <span className={cn("text-mini", selected ? "text-white" : "text-ink-muted")}>{count === 0 ? "Nothing" : `${count} ${count === 1 ? "item" : "items"}`}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── week ───────────────────────── */

export function WeekBoard({ date, events, selectedId, onSelect, onOpenDay }: BoardProps & { date: string; onOpenDay: (day: string) => void }) {
  // A day is closed when the saved business hours say so.
  const { hours } = useSettings().settings;
  const clock = useClock();
  return (
    <ol aria-label="Week schedule" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
      {weekDates(date).map((day) => {
        const dayEvents = events.filter((event) => event.date === day);
        const closed = hours[weekdayIndex(day)] === null;
        const today = day === clock.today;
        const waiting = dayEvents.filter((event) => event.kind === "work" && !event.assigneeId && event.status !== "completed").length;

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
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  aria-label={`Open ${formatWeekdayDate(day)} in day view`}
                  className="rounded text-base font-bold text-ink hover:text-primary hover:underline"
                >
                  {formatMonthDay(day)}
                </button>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="rounded bg-surface-low px-1.5 py-0.5 text-mini font-medium whitespace-nowrap text-ink-muted">
                  {closed && dayEvents.length === 0 ? "Closed" : `${dayEvents.length} ${dayEvents.length === 1 ? "item" : "items"}`}
                </span>
                {waiting > 0 && <span className="rounded bg-danger-soft px-1.5 py-0.5 text-mini font-semibold whitespace-nowrap text-danger">{waiting} unassigned</span>}
              </div>
            </div>

            {dayEvents.length === 0 && !closed && <p className="px-1 py-2 text-xs text-ink-muted">Nothing scheduled</p>}
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
  const kind = timeKind(event, dir.services);
  return (
    <button
      type="button"
      id={`event-${event.id}`}
      aria-pressed={selected}
      onClick={() => onSelect(event)}
      className={cn(
        "rounded-btn border border-l-4 border-line bg-canvas p-2 text-left transition-colors hover:border-primary hover:bg-surface",
        STATUS_ACCENT[event.status],
        kind !== "exact" && WINDOW_HATCH,
        selected && "border-primary bg-surface ring-1 ring-primary",
      )}
    >
      <span className="block text-mini font-medium text-ink-muted">
        {kind !== "exact" && <span className="font-semibold text-ink">{KIND_LABEL[kind]} · </span>}
        {formatTimeRange(event.start, event.end)}
      </span>
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
const LABEL_COLUMN = "10.5rem";

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

const pct = (minutes: number) => `${((minutes - DAY_START) / (DAY_END - DAY_START)) * 100}%`;

/** The stretches of the timeline that are outside the business's hours for this day (all of it, on a closed day). */
function outsideHours(hours: DayHours): { from: number; to: number }[] {
  if (hours === null) return [{ from: DAY_START, to: DAY_END }];
  const open = timeToMinutes(hours.open);
  const close = timeToMinutes(hours.close);
  const spans: { from: number; to: number }[] = [];
  if (open > DAY_START) spans.push({ from: DAY_START, to: Math.min(open, DAY_END) });
  if (close < DAY_END) spans.push({ from: Math.max(close, DAY_START), to: DAY_END });
  return spans;
}

/** One line under a technician's name that answers "what does their day look like?" without reading the row. */
function daySummary(workCount: number, blockCount: number, closed: boolean): string {
  if (workCount > 0) return `${workCount} ${workCount === 1 ? "visit" : "visits"}`;
  if (blockCount > 0) return "Blocked time only";
  return closed ? "Closed" : "Free all day";
}

export function DayTimeline({
  date,
  hours,
  now,
  events,
  members,
  selectedId,
  onSelect,
}: BoardProps & { date: string; hours: DayHours; /** "10:45" on the day that is today, otherwise nothing. */ now?: string; members: readonly TeamMember[] }) {
  const closedSpans = outsideHours(hours);
  const nowMinutes = now ? timeToMinutes(now) : null;
  const showNow = nowMinutes !== null && nowMinutes >= DAY_START && nowMinutes <= DAY_END;

  return (
    <div role="region" aria-label={`Day timeline for ${formatWeekdayDate(date)}, scrolls sideways when narrow`} tabIndex={0} className="overflow-x-auto rounded-card border border-line bg-surface">
      <div className="relative min-w-[960px]">
        {showNow && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-primary"
            style={{ left: `calc(${LABEL_COLUMN} + (100% - ${LABEL_COLUMN}) * ${(nowMinutes - DAY_START) / (DAY_END - DAY_START)})` }}
          />
        )}
        <div className="grid grid-cols-[10.5rem_1fr] border-b border-line bg-surface-low text-micro font-bold tracking-wider text-ink-muted uppercase">
          <div className="px-4 py-3">Technician</div>
          <div className="relative h-12" aria-hidden>
            {showNow && (
              <span className="absolute top-1 z-20 -translate-x-1/2 rounded bg-primary px-1.5 py-0.5 text-micro font-bold whitespace-nowrap text-white normal-case" style={{ left: pct(nowMinutes) }}>
                Now {formatTime(now!)}
              </span>
            )}
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="absolute top-7 -translate-x-1/2 text-mini font-semibold normal-case"
                style={{ left: pct(hour * 60) }}
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
            const laneHeight = 76;
            const workCount = memberEvents.filter((event) => event.kind === "work").length;

            return (
              <li key={member.id} className="grid grid-cols-[10.5rem_1fr] border-b border-line last:border-b-0">
                <div className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={member.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{member.name}</p>
                    <p className="truncate text-xs text-ink-muted">{member.role}</p>
                    <p className={cn("text-mini font-semibold", workCount > 0 ? "text-primary" : "text-ink-muted")}>{daySummary(workCount, memberEvents.length - workCount, hours === null)}</p>
                  </div>
                </div>
                <div className="relative" style={{ height: lanes * laneHeight + 12 }}>
                  {closedSpans.map((span) => (
                    <span key={span.from} aria-hidden className="absolute inset-y-0 bg-surface-low/80" style={{ left: pct(span.from), width: `${((span.to - span.from) / (DAY_END - DAY_START)) * 100}%` }} />
                  ))}
                  {HOURS.map((hour) => (
                    <span
                      key={hour}
                      aria-hidden
                      className="absolute inset-y-0 border-l border-line/70"
                      style={{ left: pct(hour * 60) }}
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
                          left: `calc(${((start - DAY_START) / (DAY_END - DAY_START)) * 100}% + 2px)`,
                          width: `calc(${((end - start) / (DAY_END - DAY_START)) * 100}% - 4px)`,
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
  style: CSSProperties;
}) {
  const dir = useDirectory();
  const common = "@container absolute overflow-hidden rounded-btn border px-2 py-1 text-left transition-colors";

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

  const kind = timeKind(event, dir.services);
  const range = formatTimeRange(event.start, event.end);
  return (
    <button
      type="button"
      id={`event-${event.id}`}
      aria-pressed={selected}
      title={`${getPartyName(event, dir)} · ${getServiceNameFor(event, dir)} · ${kind === "exact" ? "" : `${KIND_LABEL[kind]} `}${range} · ${EVENT_STATUS_LABEL[event.status]}`}
      onClick={() => onSelect(event)}
      style={style}
      className={cn(
        common,
        "border-l-4 border-line bg-canvas hover:border-primary hover:bg-surface",
        STATUS_ACCENT[event.status],
        kind !== "exact" && WINDOW_HATCH,
        event.status === "in-progress" && "bg-primary-subtle",
        selected && "border-primary bg-surface ring-1 ring-primary",
      )}
    >
      <span className="line-clamp-2 block text-xs leading-tight font-semibold break-words text-ink">{getPartyName(event, dir)}</span>
      <span className="block truncate text-mini text-ink-muted">{getServiceNameFor(event, dir)}</span>
      <span className="sr-only">
        {EVENT_STATUS_LABEL[event.status]}, {kind === "exact" ? "" : `${KIND_LABEL[kind]} `}
        {range}
      </span>
      {/* The status leads (the axis already says when); the time and what kind of time it is follow once the block is wide enough to hold them. */}
      <span aria-hidden className="flex items-center gap-1 truncate text-mini text-ink-muted">
        <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[event.status])} />
        <span className="truncate">
          {EVENT_STATUS_LABEL[event.status]}
          <span className="hidden @min-[12rem]:inline">
            {" · "}
            {kind === "exact" ? "" : `${KIND_LABEL[kind]} `}
            {range}
          </span>
        </span>
      </span>
    </button>
  );
}

/* ───────────────────────── unassigned ───────────────────────── */

/** `onAssign` is left out for someone who may not assign (a member): the list is then information only. */
type UnassignedProps = { events: WorkEvent[]; onAssign?: (event: WorkEvent) => void };

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
              {onAssign && (
                <Button size="sm" className="mt-2" onClick={() => onAssign(event)} aria-label={`Assign technician to ${getPartyName(event, dir)}`}>
                  Assign
                </Button>
              )}
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
            {onAssign && (
              <Button size="sm" onClick={() => onAssign(event)} aria-label={`Assign technician to ${getPartyName(event, dir)}`}>
                Assign
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
