"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fieldClasses, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StepList } from "@/components/ui/StepList";
import { Switch } from "@/components/ui/Switch";
import {
  DEFAULT_OPEN_HOURS,
  HOUR_OPTIONS,
  TIME_ZONES,
  US_STATES,
  WEEK_ORDER,
  WEEKDAY_NAMES,
  type BusinessInfo,
  type DayHours,
  type TimeZoneId,
  type WeeklyHours,
} from "@/data/settings";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/dates";
import { hardNavigate } from "@/lib/hard-navigate";
import { summarizeHours, validateBusiness, validateHours, type BusinessErrors } from "@/lib/settings-state";
import { createOrganizationAction } from "@/server/actions/workspace";
import { FormAlert } from "./AuthShell";

const STEPS = [
  { id: "business", label: "Business" },
  { id: "contact", label: "Contact & location" },
  { id: "preferences", label: "Preferences" },
  { id: "hours", label: "Business hours" },
  { id: "review", label: "Review & create" },
] as const;

const WEEKDAYS: DayHours = { open: "09:00", close: "17:00" };
const DEFAULT_HOURS: WeeklyHours = { 0: null, 1: WEEKDAYS, 2: WEEKDAYS, 3: WEEKDAYS, 4: WEEKDAYS, 5: WEEKDAYS, 6: null };

/** Which fields each step is responsible for, so "Continue" only complains about the step you are on. */
const STEP_FIELDS: Record<number, (keyof BusinessErrors)[]> = {
  0: ["name"],
  1: ["phone", "email", "street", "city", "state", "postalCode"],
};

/**
 * First-run setup for a new business: five short steps, then one server call that creates the workspace in a single
 * transaction (the organization, the person as its owner, the weekly hours and a first site). It creates nothing else: no
 * customers, services, jobs, bookings or money. Everything here can be changed later in Settings.
 */
export function OnboardingFlow({ cancelHref }: { cancelHref?: "/" }) {
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState<BusinessInfo>({ name: "", phone: "", email: "", address: { street: "", city: "", state: "", postalCode: "" } });
  const [timeZone, setTimeZone] = useState<TimeZoneId>("America/Chicago");
  const [hours, setHours] = useState<WeeklyHours>(DEFAULT_HOURS);
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // A new step starts at its heading, so keyboard and screen-reader users land where the content begins.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const businessErrors = validateBusiness(business);
  const hoursErrors = validateHours(hours);
  const stepErrors = (STEP_FIELDS[step] ?? []).filter((field) => businessErrors[field]);
  const error = (field: keyof BusinessErrors) => (shown ? businessErrors[field] : undefined);
  const setAddress = (patch: Partial<BusinessInfo["address"]>) => setBusiness({ ...business, address: { ...business.address, ...patch } });

  function next() {
    if (stepErrors.length > 0 || (step === 3 && Object.keys(hoursErrors).length > 0)) {
      setShown(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus());
      return;
    }
    setShown(false);
    setStep(step + 1);
  }

  function back() {
    setShown(false);
    setProblem(undefined);
    setStep(Math.max(0, step - 1));
  }

  async function create() {
    if (pending) return;
    setPending(true);
    setProblem(undefined);
    let result: Awaited<ReturnType<typeof createOrganizationAction>>;
    try {
      result = await createOrganizationAction({
        business,
        preferences: { timeZone, currency: "USD", dateFormat: "mdy-short", timeFormat: "12h" },
        hours,
      });
    } catch {
      result = { ok: false, error: "We couldn't reach the server, so nothing was changed. Check your connection and try again." };
    }
    if (!result.ok) {
      setProblem(result.error);
      setPending(false);
      return;
    }
    // A full page load into the new workspace: no state from any earlier workspace can carry over.
    hardNavigate("/");
  }

  return (
    <div className="space-y-6">
      <StepList steps={STEPS} current={step} label="Setup steps" />

      <section aria-labelledby="step-heading" className="space-y-5">
        <h2 id="step-heading" ref={heading} tabIndex={-1} className="text-lg font-bold text-ink focus:outline-none">
          {step === 0 && "What's your business called?"}
          {step === 1 && "How can customers reach you?"}
          {step === 2 && "Workspace preferences"}
          {step === 3 && "When are you open?"}
          {step === 4 && "Review and create your workspace"}
        </h2>

        {step === 0 && (
          <Input
            label="Business name"
            required
            autoComplete="organization"
            maxLength={80}
            hint="Customers will see this. You can change it later in Settings."
            value={business.name}
            error={error("name")}
            onChange={(event) => setBusiness({ ...business, name: event.target.value })}
          />
        )}

        {step === 1 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Phone" required type="tel" autoComplete="tel" value={business.phone} error={error("phone")} onChange={(event) => setBusiness({ ...business, phone: event.target.value })} />
              <Input label="Email" required type="email" autoComplete="email" value={business.email} error={error("email")} onChange={(event) => setBusiness({ ...business, email: event.target.value })} />
            </div>
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-ink">Business address</legend>
              <Input label="Street address" required autoComplete="address-line1" value={business.address.street} error={error("street")} onChange={(event) => setAddress({ street: event.target.value })} />
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]">
                <Input label="City" required autoComplete="address-level2" value={business.address.city} error={error("city")} onChange={(event) => setAddress({ city: event.target.value })} />
                <Select label="State" required autoComplete="address-level1" value={business.address.state} error={error("state")} onChange={(event) => setAddress({ state: event.target.value })}>
                  <option value="">Select</option>
                  {US_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </Select>
                <Input label="ZIP code" required inputMode="numeric" autoComplete="postal-code" maxLength={5} value={business.address.postalCode} error={error("postalCode")} onChange={(event) => setAddress({ postalCode: event.target.value })} />
              </div>
            </fieldset>
          </>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Time zone" required hint="Your opening hours and appointment times are in this zone." value={timeZone} onChange={(event) => setTimeZone(event.target.value as TimeZoneId)}>
              {TIME_ZONES.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.label}
                </option>
              ))}
            </Select>
            <Select label="Currency" required hint="Climvia currently supports US dollars." value="USD" onChange={() => undefined}>
              <option value="USD">USD — US dollar</option>
            </Select>
          </div>
        )}

        {step === 3 && <HoursEditor hours={hours} onChange={setHours} errors={shown ? hoursErrors : {}} />}

        {step === 4 && (
          <>
            <dl className="divide-y divide-line rounded-card border border-line text-sm">
              <ReviewRow label="Business" value={business.name} />
              <ReviewRow label="Phone" value={business.phone} />
              <ReviewRow label="Email" value={business.email} />
              <ReviewRow label="Address" value={`${business.address.street}, ${business.address.city}, ${business.address.state} ${business.address.postalCode}`} />
              <ReviewRow label="Time zone" value={TIME_ZONES.find((zone) => zone.id === timeZone)?.short ?? timeZone} />
              <ReviewRow label="Currency" value="USD" />
              <ReviewRow
                label="Hours"
                value={
                  <ul>
                    {summarizeHours(hours).map((row) => (
                      <li key={row.days}>
                        {row.days}: {row.hours}
                      </li>
                    ))}
                  </ul>
                }
              />
            </dl>
            <p className="text-sm text-ink-muted">You&apos;ll be the owner of this workspace. You can change any of this later in Settings.</p>
            {problem && <FormAlert>{problem}</FormAlert>}
          </>
        )}
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <div>
          {step > 0 ? (
            <Button variant="secondary" onClick={back} disabled={pending}>
              <ArrowLeft aria-hidden className="size-4" />
              Back
            </Button>
          ) : cancelHref ? (
            <Link href={cancelHref} className="text-sm font-medium text-ink-muted hover:text-primary">
              Cancel
            </Link>
          ) : null}
        </div>
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>
            Continue
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button onClick={create} disabled={pending}>
            <Check aria-hidden className="size-4" />
            {pending ? "Creating your workspace…" : "Create workspace"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

/** One row per day: an open/closed switch and, when open, the opening and closing times. */
function HoursEditor({ hours, onChange, errors }: { hours: WeeklyHours; onChange: (hours: WeeklyHours) => void; errors: Record<number, string> }) {
  // The hours a day had before it was switched off, so switching it back on restores them.
  const [remembered, setRemembered] = useState<Record<number, DayHours>>({});

  function toggle(day: number, open: boolean) {
    if (open) onChange({ ...hours, [day]: remembered[day] ?? { ...DEFAULT_OPEN_HOURS } });
    else {
      setRemembered({ ...remembered, [day]: hours[day] });
      onChange({ ...hours, [day]: null });
    }
  }

  return (
    <ul className="space-y-2">
      {WEEK_ORDER.map((day) => {
        const name = WEEKDAY_NAMES[day];
        const value = hours[day];
        const error = errors[day];
        const errorId = `onboarding-hours-error-${day}`;
        return (
          <li key={day} className="rounded-card bg-surface-low p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Switch checked={Boolean(value)} onChange={(open) => toggle(day, open)} label={`${name} open`} />
              <div className="w-24">
                <p className="text-sm font-semibold text-ink">{name}</p>
                <p className={cn("text-xs", value ? "text-positive" : "text-ink-muted")}>{value ? "Open" : "Closed"}</p>
              </div>
              {value ? (
                <div className="flex items-center gap-2">
                  <HourSelect label={`${name} opening time`} value={value.open} invalid={Boolean(error)} describedBy={error ? errorId : undefined} onChange={(open) => onChange({ ...hours, [day]: { ...value, open } })} />
                  <span className="text-xs text-ink-muted">to</span>
                  <HourSelect label={`${name} closing time`} value={value.close} invalid={Boolean(error)} describedBy={error ? errorId : undefined} onChange={(close) => onChange({ ...hours, [day]: { ...value, close } })} />
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
  );
}

function HourSelect({ label, value, invalid, describedBy, onChange }: { label: string; value: string; invalid: boolean; describedBy?: string; onChange: (value: string) => void }) {
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
