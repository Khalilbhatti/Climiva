"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarOff, Coffee, Copy, Plus, Trash2, TriangleAlert } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { Button } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useCan, useClock } from "@/components/workspace/WorkspaceProvider";
import { jobHref } from "@/config/routes";
import { getScheduleEvents, type WorkEvent } from "@/data/operations";
import {
  WEEKDAY_NAMES,
  WEEK_ORDER,
  weeklyFromBusinessHours,
  type Availability,
  type AvailabilityMode,
  type DayHours,
  type UnavailablePeriod,
} from "@/data/team";
import { formatDate } from "@/lib/format";
import { formatTime, timeToMinutes } from "@/lib/dates";
import { useMember } from "./MemberWorkspace";
import { useTeam } from "./TeamProvider";

const TIME_OPTIONS = Array.from({ length: 29 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

const BREAK_PRESETS = [{ id: "none" }, { id: "12:00-12:30" }, { id: "12:00-13:00" }] as const;

/** "No break", or the break written in the workspace's time style: "12:00 PM – 12:30 PM". */
const breakLabel = (id: string) => {
  if (id === "none") return "No break";
  const [start, end] = id.split("-");
  return `${formatTime(start)} – ${formatTime(end)}`;
};

const MODES: { id: AvailabilityMode; title: string; description: string }[] = [
  {
    id: "business-hours",
    title: "Uses business hours",
    description: "Inherits the company operating hours from Settings and updates automatically when they change.",
  },
  {
    id: "custom",
    title: "Custom availability",
    description: "Configure day-by-day hours, shifts or part-time windows.",
  },
  {
    id: "not-set",
    title: "Set later",
    description: "Won't be shown as available for assignment until availability is configured.",
  },
];

const breakId = (day: DayHours) => (day.breakStart && day.breakEnd ? `${day.breakStart}-${day.breakEnd}` : "none");

/** Compared by value, whatever order the keys came in (what was stored comes back in its own order). */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item,
  );

const sameAvailability = (a: Availability, b: Availability) => canonical(a) === canonical(b);

const REASONS = ["Time off", "Training", "Other"] as const;

export function MemberAvailability() {
  const member = useMember();
  const { setAvailability } = useTeam();
  const { data: operations } = useOperations();
  const { toast } = useToast();
  const canManage = useCan("team:manage");
  const { hours: businessHours, preferences } = useSettings().settings;
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();

  const [draft, setDraft] = useState<Availability>(member.availability);
  const [adding, setAdding] = useState(false);
  const locked = member.status === "inactive" || !canManage;
  const dirty = !sameAvailability(draft, member.availability);

  const upcoming = getScheduleEvents(operations).filter(
    (event): event is WorkEvent => event.kind === "work" && event.assigneeId === member.id && event.status !== "completed",
  );

  const dayErrors: Record<number, string | undefined> = {};
  if (draft.mode === "custom") {
    for (const day of WEEK_ORDER) {
      const hours = draft.weekly[day];
      if (hours.enabled && timeToMinutes(hours.end) <= timeToMinutes(hours.start)) dayErrors[day] = "End time must be after the start time.";
    }
  }
  const invalid = Object.values(dayErrors).some(Boolean);

  function setDay(day: number, patch: Partial<DayHours>) {
    setDraft((current) => ({ ...current, weekly: { ...current.weekly, [day]: { ...current.weekly[day], ...patch } } }));
  }

  function setBreak(day: number, preset: string) {
    if (preset === "none") return setDay(day, { breakStart: undefined, breakEnd: undefined });
    const [breakStart, breakEnd] = preset.split("-");
    setDay(day, { breakStart, breakEnd });
  }

  function copyMondayToWeekdays() {
    const monday = draft.weekly[1];
    setDraft((current) => ({
      ...current,
      weekly: Object.fromEntries(
        Object.entries(current.weekly).map(([day, hours]) => [day, Number(day) >= 2 && Number(day) <= 5 ? { ...monday } : hours]),
      ),
    }));
  }

  function chooseMode(mode: AvailabilityMode) {
    // Switching to a custom schedule starts from the business hours when none was set up yet.
    setDraft((current) => ({
      ...current,
      mode,
      weekly: mode === "custom" && member.availability.mode !== "custom" ? weeklyFromBusinessHours(businessHours) : current.weekly,
    }));
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="availability-config" className={cardClasses("lg", "space-y-4")}>
        <div>
          <h2 id="availability-config" className="text-base font-semibold text-ink">
            Availability configuration
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Choose when {member.name.split(" ")[0]} can be given work. Times are {preferences.timeZone} (workspace default). This is a
            configuration, not a schedule: booked work is on the Schedule page.
          </p>
        </div>
        <OptionGroup legend="Availability preset" className="lg:grid-cols-3">
          {MODES.map((mode) => (
            <OptionCard
              key={mode.id}
              type="radio"
              name="availability-mode"
              title={mode.title}
              description={mode.description}
              checked={draft.mode === mode.id}
              disabled={locked}
              onChange={() => chooseMode(mode.id)}
            />
          ))}
        </OptionGroup>
      </section>

      {draft.mode !== "not-set" && (
        <section aria-labelledby="availability-hours" className={cardClasses("lg", "space-y-4")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="availability-hours" className="text-base font-semibold text-ink">
                Weekly working hours
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                {draft.mode === "custom" ? "Shift hours for each day of the week." : "These are the business hours. Choose Custom availability to change them."}
              </p>
            </div>
            {draft.mode === "custom" && !locked && (
              <Button variant="secondary" size="sm" onClick={copyMondayToWeekdays}>
                <Copy aria-hidden className="size-3.5" />
                Copy Monday to all weekdays
              </Button>
            )}
          </div>

          <ul className="divide-y divide-line rounded-card border border-line">
            {WEEK_ORDER.map((day) => {
              const hours = draft.mode === "custom" ? draft.weekly[day] : weeklyFromBusinessHours(businessHours)[day];
              const name = WEEKDAY_NAMES[day];
              const editable = draft.mode === "custom" && !locked;
              return (
                <li key={day} className="p-4">
                  <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-[9rem_1fr] sm:items-start">
                    <legend className="sr-only">{name} hours</legend>
                    <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={hours.enabled}
                        onChange={(event) => setDay(day, { enabled: event.target.checked })}
                        className="size-4 accent-primary"
                      />
                      {name}
                    </label>
                    {hours.enabled ? (
                      editable ? (
                        <div>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="w-36">
                              <Select label={`${name} start`} value={hours.start} onChange={(event) => setDay(day, { start: event.target.value })}>
                                {TIME_OPTIONS.map((time) => (
                                  <option key={time} value={time}>
                                    {formatTime(time)}
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <div className="w-36">
                              <Select
                                label={`${name} end`}
                                value={hours.end}
                                error={dayErrors[day]}
                                onChange={(event) => setDay(day, { end: event.target.value })}
                              >
                                {TIME_OPTIONS.map((time) => (
                                  <option key={time} value={time}>
                                    {formatTime(time)}
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <div className="w-56">
                              <Select label={`${name} break`} value={breakId(hours)} onChange={(event) => setBreak(day, event.target.value)}>
                                {BREAK_PRESETS.map((preset) => (
                                  <option key={preset.id} value={preset.id}>
                                    {breakLabel(preset.id)}
                                  </option>
                                ))}
                                {breakId(hours) !== "none" && !BREAK_PRESETS.some((preset) => preset.id === breakId(hours)) && (
                                  <option value={breakId(hours)}>
                                    {formatTime(hours.breakStart!)} – {formatTime(hours.breakEnd!)}
                                  </option>
                                )}
                              </Select>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink">
                          {formatTime(hours.start)} – {formatTime(hours.end)}
                          {hours.breakStart && hours.breakEnd && (
                            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                              <Coffee aria-hidden className="size-3.5" />
                              Break: {formatTime(hours.breakStart)} – {formatTime(hours.breakEnd)}
                            </span>
                          )}
                        </p>
                      )
                    ) : (
                      <p className="text-sm text-ink-muted">{day === 0 ? "Unavailable · closed" : "Not working"}</p>
                    )}
                  </fieldset>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {draft.mode === "not-set" && (
        <p className="rounded-card border border-line bg-surface-low p-4 text-sm text-ink-muted">
          {member.name} won&rsquo;t be shown as available for assignment until availability is configured.
        </p>
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="assignment-check" className="rounded-card border border-warning-line bg-warning-soft p-4">
          <h2 id="assignment-check" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <TriangleAlert aria-hidden className="size-4 text-warning" />
            Upcoming assignment check · {upcoming.length} active job{upcoming.length === 1 ? "" : "s"}
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Changing working hours or adding unavailable periods can affect these scheduled jobs. Existing assignments remain in place
            unless manually rescheduled.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
            {upcoming.map((event) =>
              event.jobId ? (
                <li key={event.id}>
                  <Link href={jobHref(event.jobId)} className="rounded-full bg-surface px-2.5 py-1 text-primary hover:underline">
                    View job #{event.jobId}
                  </Link>
                </li>
              ) : (
                <li key={event.id} className="rounded-full bg-surface px-2.5 py-1 text-ink">
                  Booking #{event.id}
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      <section aria-labelledby="unavailable-periods" className={cardClasses("lg", "space-y-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="unavailable-periods" className="text-base font-semibold text-ink">
              Unavailable periods
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">Time off, training or other time when this person can&rsquo;t be given work.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)} disabled={locked}>
            <Plus aria-hidden className="size-3.5" />
            Add unavailable time
          </Button>
        </div>
        {draft.unavailable.length === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No unavailable periods are scheduled.</p>
        ) : (
          <ul className="space-y-2">
            {draft.unavailable.map((period) => (
              <li key={period.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-low p-4">
                <div className="flex items-start gap-3">
                  <CalendarOff aria-hidden className="mt-0.5 size-4 text-ink-muted" />
                  <div>
                    <p className="text-sm font-semibold text-ink">{period.title}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDate(period.startDate)}
                      {period.endDate !== period.startDate && ` – ${formatDate(period.endDate)}`}
                      {period.startTime && period.endTime && ` (${formatTime(period.startTime)} – ${formatTime(period.endTime)})`} · Reason: {period.reason}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={locked}
                  aria-label={`Remove ${period.title}`}
                  onClick={() => setDraft((current) => ({ ...current, unavailable: current.unavailable.filter((item) => item.id !== period.id) }))}
                  className="inline-flex items-center gap-1 rounded-btn px-2 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-muted">
          Unavailable periods prevent new appointments from being assigned to this person during those windows.
        </p>
      </section>

      {problem && <FormAlert>{problem}</FormAlert>}
      {!canManage && <p className="text-sm text-ink-muted">Only an owner or admin can change availability.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {dirty ? <span className="font-semibold text-ink">Unsaved changes</span> : "All availability changes are saved."}
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(member.availability);
              setProblem(undefined);
            }}
            disabled={!dirty}
          >
            Discard changes
          </Button>
          <Button
            disabled={!dirty || invalid || locked || saving}
            onClick={async () => {
              setSaving(true);
              setProblem(undefined);
              const result = await setAvailability(member.id, draft);
              setSaving(false);
              if (!result.ok) return setProblem(result.error);
              toast(`Availability for ${member.name} saved.`);
            }}
          >
            Save availability
          </Button>
        </div>
      </div>

      {adding && (
        <AddUnavailableDialog
          onClose={() => setAdding(false)}
          onAdd={(period) => {
            setDraft((current) => ({ ...current, unavailable: [...current.unavailable, period] }));
            setAdding(false);
          }}
          nextId={`off-${member.id}-${draft.unavailable.length + 1}`}
        />
      )}
    </div>
  );
}

function AddUnavailableDialog({
  onClose,
  onAdd,
  nextId,
}: {
  onClose: () => void;
  onAdd: (period: UnavailablePeriod) => void;
  nextId: string;
}) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState<string>(REASONS[0]);
  const { today } = useClock();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [partDay, setPartDay] = useState(false);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("12:00");
  const [showErrors, setShowErrors] = useState(false);

  const errors: { title?: string; end?: string } = {};
  if (!title.trim()) errors.title = "Enter a name for this period, like “Vacation”.";
  if (endDate < startDate) errors.end = "The end date can't be before the start date.";
  else if (partDay && endDate === startDate && timeToMinutes(endTime) <= timeToMinutes(startTime)) errors.end = "The end time must be after the start time.";

  return (
    <Modal
      open
      onClose={onClose}
      title="Add unavailable time"
      description="This blocks the person from new assignments during these dates."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (errors.title || errors.end) return setShowErrors(true);
              onAdd({
                id: nextId,
                title: title.trim(),
                reason,
                startDate,
                endDate,
                ...(partDay ? { startTime, endTime } : {}),
              });
            }}
          >
            Add unavailable time
          </Button>
        </>
      }
    >
      <Input label="Name" required value={title} error={showErrors ? errors.title : undefined} onChange={(event) => setTitle(event.target.value)} />
      <Select label="Reason" value={reason} onChange={(event) => setReason(event.target.value)}>
        {REASONS.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Start date" type="date" value={startDate} onChange={(event) => event.target.value && setStartDate(event.target.value)} />
        <Input
          label="End date"
          type="date"
          value={endDate}
          min={startDate}
          error={showErrors ? errors.end : undefined}
          onChange={(event) => event.target.value && setEndDate(event.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={partDay} onChange={(event) => setPartDay(event.target.checked)} className="size-4 accent-primary" />
        Only part of the day
      </label>
      {partDay && (
        <div className="grid grid-cols-2 gap-3">
          <Select label="From" value={startTime} onChange={(event) => setStartTime(event.target.value)}>
            {TIME_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {formatTime(time)}
              </option>
            ))}
          </Select>
          <Select label="Until" value={endTime} onChange={(event) => setEndTime(event.target.value)}>
            {TIME_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {formatTime(time)}
              </option>
            ))}
          </Select>
        </div>
      )}
    </Modal>
  );
}
