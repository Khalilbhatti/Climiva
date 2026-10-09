"use client";

import { Eye, Lock } from "lucide-react";
import { fieldClasses } from "@/components/ui/Input";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { DATE_FORMATS, TIME_FORMATS, TIME_ZONES, dateFormatExample, getTimeZone, type Preferences, type TimeZoneId } from "@/data/settings";
import { formatClockParts, type DateFormatId, type TimeFormatId } from "@/lib/display-preferences";
import { cn } from "@/lib/cn";
import { SettingsForm, useSettingsDraft } from "./SettingsForm";
import { useSettings } from "./SettingsProvider";

const samePreferences = (a: Preferences, b: Preferences) =>
  a.timeZone === b.timeZone && a.dateFormat === b.dateFormat && a.timeFormat === b.timeFormat;

/**
 * Settings → Workspace preferences. The time zone names the zone the workspace's business-local times are in; saving a
 * different one relabels them and never converts a stored time. The date and time style changes how every screen writes
 * them. Currency is fixed at USD.
 */
export function PreferencesForm() {
  const { settings, savePreferences } = useSettings();
  const { toast } = useToast();
  const { canEditSettings } = useWorkspace();
  const saved = settings.preferences;
  const { draft, setDraft, dirty, problem, setProblem, guard, discard } = useSettingsDraft<Preferences>(saved, samePreferences, "workspace preferences");

  async function save() {
    setProblem(undefined);
    const result = await savePreferences(draft);
    if (!result.ok) {
      setProblem(result.error);
      return true;
    }
    toast("Workspace preferences saved.");
    return true;
  }

  return (
    <SettingsForm
      title="Workspace preferences"
      description="Set basic formatting preferences for your Climvia workspace."
      what="workspace preferences"
      dirty={dirty}
      saveLabel="Save preferences"
      onSave={save}
      problem={problem}
      readOnly={!canEditSettings}
      onDiscard={() => discard()}
      guard={guard}
    >
      <div>
        <Select
          label="Time zone"
          required
          value={draft.timeZone}
          hint="Used for dates and scheduled times across your workspace. Existing bookings, jobs and records keep their recorded times."
          onChange={(event) => setDraft({ ...draft, timeZone: event.target.value as TimeZoneId })}
        >
          {TIME_ZONES.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-ink-muted">Shown as {getTimeZone(draft.timeZone).short}.</p>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2">
          <label htmlFor="workspace-currency" className="text-xs font-medium text-ink">
            Currency
          </label>
          <span className="inline-flex items-center gap-1 rounded bg-surface-low px-1.5 py-0.5 text-micro font-semibold text-ink-muted">
            <Lock aria-hidden className="size-3" />
            Read-only
          </span>
        </div>
        <input
          id="workspace-currency"
          readOnly
          aria-readonly
          aria-describedby="workspace-currency-hint"
          value="USD — US Dollar ($)"
          className={cn(fieldClasses, "cursor-not-allowed bg-surface-low")}
        />
        <p id="workspace-currency-hint" className="mt-1 text-xs text-ink-muted">
          Used for prices, Quotes, Invoices, and Payments.
        </p>
      </div>

      <div>
        <div className="relative">
          <Select
            label="Date format"
            value={draft.dateFormat}
            hint="Controls how dates are displayed across your workspace."
            onChange={(event) => setDraft({ ...draft, dateFormat: event.target.value as DateFormatId })}
          >
            {DATE_FORMATS.map((format) => (
              <option key={format.id} value={format.id}>
                {format.pattern} (e.g., {dateFormatExample(format.id)})
              </option>
            ))}
          </Select>
          <span className="absolute top-0 right-0 inline-flex items-center gap-1 rounded-full bg-primary-subtle px-2 py-0.5 text-micro font-semibold text-primary">
            <Eye aria-hidden className="size-3" />
            Preview: {dateFormatExample(draft.dateFormat)}
          </span>
        </div>
      </div>

      <OptionGroup legend="Time format" hint="Controls how times are displayed across your workspace." className="sm:grid-cols-2">
        {TIME_FORMATS.map((format) => (
          <OptionCard
            key={format.id}
            type="radio"
            name="time-format"
            title={format.title}
            description={
              <>
                {format.example} · Preview: {formatClockParts(10, 45, format.id as TimeFormatId)}
              </>
            }
            checked={draft.timeFormat === format.id}
            onChange={() => setDraft({ ...draft, timeFormat: format.id })}
          />
        ))}
      </OptionGroup>
    </SettingsForm>
  );
}
