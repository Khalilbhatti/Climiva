"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fieldClasses } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import {
  DEFAULT_OPEN_HOURS,
  HOUR_OPTIONS,
  WEEK_ORDER,
  WEEKDAY_NAMES,
  type DayHours,
  type WeeklyHours,
} from "@/data/settings";
import { formatTime } from "@/lib/dates";
import { copyMondayToWeekdays, isSameHours, summarizeHours, validateHours } from "@/lib/settings-state";
import { cn } from "@/lib/cn";
import { AsidePanel, InfoNote, SettingsForm, useSettingsDraft } from "./SettingsForm";
import { useSettings } from "./SettingsProvider";

/**
 * Settings → Business hours: the standard weekly hours, one row per day. These are the hours customers see and the
 * hours the booking times are offered within. Each team member's own availability stays on their Team record.
 */
export function BusinessHoursForm() {
  const { settings, saveHours } = useSettings();
  const { toast } = useToast();
  const { canEditSettings } = useWorkspace();
  const saved = settings.hours;
  const { draft, setDraft, dirty, showErrors, setShowErrors, problem, setProblem, guard, discard } = useSettingsDraft<WeeklyHours>(saved, isSameHours, "business hours");
  // The hours a day had before it was switched off, so switching it back on does not lose them.
  const [remembered, setRemembered] = useState<Record<number, DayHours>>({});

  const errors = validateHours(draft);
  const preview = summarizeHours(draft);

  function setDay(day: number, value: DayHours) {
    setDraft({ ...draft, [day]: value });
  }

  function toggleDay(day: number, open: boolean) {
    if (open) {
      setDay(day, remembered[day] ?? saved[day] ?? { ...DEFAULT_OPEN_HOURS });
    } else {
      setRemembered({ ...remembered, [day]: draft[day] });
      setDay(day, null);
    }
  }

  async function save() {
    setProblem(undefined);
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return false;
    }
    const result = await saveHours(draft);
    if (!result.ok) {
      setProblem(result.error);
      return true;
    }
    setShowErrors(false);
    toast("Business hours saved.");
    return true;
  }

  return (
    <SettingsForm
      title="Business hours"
      description="Set the standard hours customers may see across your public business experiences."
      what="business hours"
      dirty={dirty}
      saveLabel="Save hours"
      onSave={save}
      problem={problem}
      readOnly={!canEditSettings}
      onDiscard={() => discard(() => setRemembered({}))}
      guard={guard}
      aside={
        <AsidePanel title="Hours preview">
          <div className="rounded-card bg-surface-low p-4">
            <p className="text-sm font-bold text-ink">{settings.business.name}</p>
            <p className="text-xs text-ink-muted">Standard schedule</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              {preview.map((row) => (
                <div key={row.days} className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-muted">{row.days}</dt>
                  <dd className={cn("font-medium", row.hours === "Closed" ? "text-ink-muted" : "text-ink")}>{row.hours}</dd>
                </div>
              ))}
            </dl>
          </div>
        </AsidePanel>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InfoNote>
          These are your standard business hours. Supported customer-facing Climvia experiences may display these hours. Each team member&apos;s own availability is
          set on their Team record.
        </InfoNote>
        <Button variant="secondary" onClick={() => setDraft(copyMondayToWeekdays(draft))}>
          <Copy aria-hidden className="size-4" />
          Copy Monday to weekdays
        </Button>
      </div>

      <ul className="space-y-2">
        {WEEK_ORDER.map((day) => {
          const name = WEEKDAY_NAMES[day];
          const value = draft[day];
          const error = showErrors ? errors[day] : undefined;
          const errorId = `hours-error-${day}`;
          return (
            <li key={day} className="rounded-card bg-surface-low p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Switch checked={Boolean(value)} onChange={(open) => toggleDay(day, open)} label={`${name} open`} />
                <div className="w-24">
                  <p className="text-sm font-semibold text-ink">{name}</p>
                  <p className={cn("text-xs", value ? "text-positive" : "text-ink-muted")}>{value ? "Open" : "Closed"}</p>
                </div>
                {value ? (
                  <div className="flex items-center gap-2">
                    <HourSelect
                      label={`${name} opening time`}
                      value={value.open}
                      invalid={Boolean(error)}
                      describedBy={error ? errorId : undefined}
                      onChange={(open) => setDay(day, { ...value, open })}
                    />
                    <span className="text-xs text-ink-muted">to</span>
                    <HourSelect
                      label={`${name} closing time`}
                      value={value.close}
                      invalid={Boolean(error)}
                      describedBy={error ? errorId : undefined}
                      onChange={(close) => setDay(day, { ...value, close })}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted italic">Closed all day</p>
                )}
              </div>
              {error && (
                <p id={errorId} className="mt-2 text-xs text-danger">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </SettingsForm>
  );
}

function HourSelect({
  label,
  value,
  invalid,
  describedBy,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(fieldClasses, "w-auto pr-8", invalid && "border-danger")}
    >
      {HOUR_OPTIONS.map((option) => (
        <option key={option} value={option}>
          {formatTime(option)}
        </option>
      ))}
    </select>
  );
}
