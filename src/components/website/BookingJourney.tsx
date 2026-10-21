"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarCheck, CircleCheck, Clock, Info, MapPin } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Select } from "@/components/ui/Select";
import { StepList } from "@/components/ui/StepList";
import { Textarea } from "@/components/ui/Textarea";
import type { AppHref } from "@/config/routes";
import type { WeeklyHours } from "@/data/settings";
import {
  BOOKING_METHOD_LABEL,
  formatDuration,
  formatServicePrice,
  type BookingMethod,
  type Service,
} from "@/data/services";
import { addDays, formatLongDate, formatTime, formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { getSlotGroup, type Slot } from "@/lib/booking-slots";
import { toTelHref } from "@/lib/format";

const STEP_LABELS: Record<BookingMethod, readonly string[]> = {
  instant: ["Service", "Date & time", "Your details", "Confirmation"],
  "request-appointment": ["Service", "Arrival window", "Issue & address", "Confirmation"],
  "request-quote": ["Service", "Consultation slot", "Details & address", "Confirmation"],
};

const SUBMIT_LABEL: Record<BookingMethod, string> = {
  instant: "Confirm booking",
  "request-appointment": "Submit appointment request",
  "request-quote": "Submit quote request",
};

/** The first day offered is a few days out, so the picker opens on a business day with slots. */
const FIRST_DATE_OFFSET = 3;

const slotText = (method: BookingMethod, slot: Slot) =>
  method === "instant" ? formatTimeRange(slot.start, slot.end) : `${slot.label} · ${formatTimeRange(slot.start, slot.end)}`;

type Errors = Partial<Record<"slot" | "name" | "email" | "phone" | "address" | `intake-${string}`, string>>;

/** What the journey sends when the visitor confirms: the Service, the chosen slot, their details and answers. */
export type JourneySubmission = {
  service: Service;
  date: string;
  start: string;
  end: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  answers: Record<string, string>;
};

/** What a submission comes back with: the reference to show, or why it was refused. */
export type JourneyResult = { ok: true; reference: string } | { ok: false; error: string; fields?: Record<string, string> };

type JourneyProps = {
  /** The Service being booked, or undefined when the address names one the site does not offer. */
  service: Service | undefined;
  /** Only the business is used: the name, and its phone when the page may show one (a Marketplace listing can keep its phone private). */
  view: { business: { name: string; phone: string } };
  /** The business's weekly hours and its today: the same slot rules apply on every page that books. */
  hours: WeeklyHours;
  today: string;
  submit: (submission: JourneySubmission) => Promise<JourneyResult>;
  /** The Booking page, where "Change service" and "Back to booking" lead. */
  bookingHref: AppHref;
  homeHref: AppHref;
};

function NotAvailable({ view, service, bookingHref }: { view: { business: { name: string; phone: string } }; service?: Service; bookingHref: AppHref }) {
  const { business } = view;
  return (
    <section className="px-6 py-14 text-center">
      <h1 className="text-xl font-bold text-ink">{service ? `${service.name} can't be booked online` : "Service not found"}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        This service isn&apos;t available to book online right now.
        {business.phone ? (
          <>
            {" "}
            You can call {business.name} at{" "}
            <a href={toTelHref(business.phone)} className="font-semibold text-primary hover:underline">
              {business.phone}
            </a>
            .
          </>
        ) : null}
      </p>
      <ButtonLink href={bookingHref} variant="secondary" className="mt-5">
        Back to booking
      </ButtonLink>
    </section>
  );
}

/**
 * The customer's booking journey for one Service. What it asks for follows the Service's booking method (the three
 * approved behaviours). It makes a single Booking: confirmed for instant booking, pending for a request (the server decides which, from
 * the Service). It never creates a job, quote, invoice or payment, and it takes no payment.
 *
 * It does not know WHO is booking. The signed-in preview passes a `submit` that uses the workspace's authorized action; the published
 * site passes one that uses the public booking action, which finds the business from the SITE and trusts nothing from the page.
 */
export function BookingJourney({ service, view, hours, today, submit, bookingHref, homeHref }: JourneyProps) {
  const { business } = view;
  const [stage, setStage] = useState<"time" | "details" | "done">("time");
  const [date, setDate] = useState(() => addDays(today, FIRST_DATE_OFFSET));
  const [slotId, setSlotId] = useState<string>();
  const [details, setDetails] = useState({ name: "", email: "", phone: "", address: "", notes: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [created, setCreated] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [stage]);

  if (!service || service.visibility !== "public-booking") return <NotAvailable view={view} service={service} bookingHref={bookingHref} />;

  const method = service.bookingMethod;
  const questions = service.intake.filter((question) => question.type === "single-select");
  const slotGroup = getSlotGroup(method, date, service.durationMinutes, hours, today);
  const slot = slotGroup.slots.find((candidate) => candidate.id === slotId && candidate.available);

  const errors: Errors = {};
  if (!slot) errors.slot = "Select an available time.";
  if (!details.name.trim()) errors.name = "Enter your full name.";
  if (!/^\S+@\S+\.\S+$/.test(details.email.trim())) errors.email = "Enter a valid email address.";
  if (details.phone.replace(/\D/g, "").length < 7) errors.phone = "Enter a phone number we can reach you on.";
  if (!details.address.trim()) errors.address = "Enter the service address.";
  for (const question of questions) {
    if (question.required && !answers[question.id]) errors[`intake-${question.id}`] = "Select an option.";
  }
  const shown = (key: keyof Errors) => (showErrors ? errors[key] : undefined);

  const current = stage === "time" ? 1 : stage === "details" ? 2 : 3;
  const setField = (key: keyof typeof details) => ({
    value: details[key],
    onChange: (event: { target: { value: string } }) => setDetails((value) => ({ ...value, [key]: event.target.value })),
  });

  function toDetails() {
    if (errors.slot) return setShowErrors(true);
    setShowErrors(false);
    setStage("details");
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!slot || Object.keys(errors).length > 0) return setShowErrors(true);
    setSaving(true);
    setProblem(undefined);
    const result = await submit({
      service: service!,
      date,
      start: slot.start,
      end: slot.end,
      name: details.name.trim(),
      phone: details.phone.trim(),
      email: details.email.trim(),
      address: details.address.trim(),
      notes: details.notes.trim(),
      answers,
    });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    setCreated(result.reference);
    setShowErrors(false);
    setStage("done");
  }

  const when = slot ? `${formatLongDate(date)} · ${method === "instant" ? formatTime(slot.start) : formatTimeRange(slot.start, slot.end)}` : undefined;

  return (
    <div>
      <section className="bg-primary px-5 py-7 text-white @xl:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-wider text-white/80 uppercase">
              {BOOKING_METHOD_LABEL[method]} · {formatDuration(service.durationMinutes)}
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight @xl:text-2xl">{service.name}</h1>
            <p className="mt-1 text-sm text-white/85">{service.description}</p>
          </div>
          <p className="rounded-btn bg-white/10 px-3 py-2 text-sm font-semibold">{formatServicePrice(service.pricing)}</p>
        </div>
      </section>

      <div className="space-y-6 px-5 py-6 @xl:px-8">
        <StepList label="Booking steps" steps={STEP_LABELS[method].map((label) => ({ id: label, label }))} current={current} />

        {stage === "time" && (
          <section aria-labelledby="time-heading" className="max-w-2xl space-y-5">
            <h2 id="time-heading" ref={heading} tabIndex={-1} className="text-lg font-bold text-ink focus:outline-none">
              {method === "instant" ? "Choose a date and time" : method === "request-appointment" ? "Choose an arrival window" : "Choose a consultation slot"}
            </h2>
            <Input
              label="Date"
              type="date"
              min={today}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setSlotId(undefined);
              }}
            />
            {slotGroup.unavailableReason ? (
              <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">{slotGroup.unavailableReason} Choose another date.</p>
            ) : (
              <OptionGroup legend={slotGroup.heading} className="@xl:grid-cols-2">
                {slotGroup.slots.map((candidate) => (
                  <OptionCard
                    key={candidate.id}
                    type="radio"
                    name="slot"
                    title={slotText(method, candidate)}
                    description={candidate.available ? undefined : "Unavailable"}
                    disabled={!candidate.available}
                    checked={slotId === candidate.id}
                    onChange={() => setSlotId(candidate.id)}
                  />
                ))}
              </OptionGroup>
            )}
            {shown("slot") && <p className="text-xs text-danger">{shown("slot")}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={bookingHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-primary">
                <ArrowLeft aria-hidden className="size-4" />
                Change service
              </Link>
              <Button onClick={toDetails}>Continue</Button>
            </div>
          </section>
        )}

        {stage === "details" && (
          <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
            <form onSubmit={confirm} noValidate className="space-y-5">
              <div>
                <h2 id="details-heading" ref={heading} tabIndex={-1} className="text-lg font-bold text-ink focus:outline-none">
                  {method === "instant" ? "Your details & service address" : "Contact details & service address"}
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {method === "instant"
                    ? "Tell us who will meet the technician and where the equipment is."
                    : "Tell us how to reach you and where the work would take place."}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
                <Input label="Full name" required autoComplete="name" error={shown("name")} {...setField("name")} />
                <Input label="Phone number" type="tel" required autoComplete="tel" error={shown("phone")} {...setField("phone")} />
              </div>
              <Input label="Email address" type="email" required autoComplete="email" error={shown("email")} {...setField("email")} />
              <Input label="Service address" required autoComplete="street-address" error={shown("address")} {...setField("address")} />
              {questions.map((question) => (
                <Select
                  key={question.id}
                  label={question.prompt}
                  required={question.required}
                  error={shown(`intake-${question.id}`)}
                  value={answers[question.id] ?? ""}
                  onChange={(event) => setAnswers((value) => ({ ...value, [question.id]: event.target.value }))}
                >
                  <option value="">Select…</option>
                  {question.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ))}
              <Textarea label="Access notes (optional)" hint="Unit, apartment, or gate access notes." {...setField("notes")} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStage("time")}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-primary"
                >
                  <ArrowLeft aria-hidden className="size-4" />
                  {method === "instant" ? "Change date & time" : "Change time"}
                </button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Sending…" : SUBMIT_LABEL[method]}
                </Button>
              </div>
              {problem && <FormAlert>{problem}</FormAlert>}
            </form>

            <aside aria-label="Booking summary" className="space-y-3 self-start rounded-card bg-surface-low p-5">
              <h2 className="text-xs font-bold tracking-wider text-ink-muted uppercase">
                {method === "instant" ? "Appointment summary" : "Request summary"}
              </h2>
              <p className="text-sm font-semibold text-ink">{service.name}</p>
              <p className="flex items-start gap-2 text-sm text-ink">
                <CalendarCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                {when}
              </p>
              {details.address.trim() && (
                <p className="flex items-start gap-2 text-sm text-ink">
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  {details.address.trim()}
                </p>
              )}
              <p className="flex items-center gap-2 border-t border-line pt-3 text-sm font-semibold text-ink">
                <Clock aria-hidden className="size-4 text-primary" />
                {formatServicePrice(service.pricing)}
              </p>
              <p className="flex items-start gap-2 rounded-btn bg-surface p-3 text-xs text-ink-muted">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {method === "instant"
                  ? "No payment is taken today. Invoicing is handled separately after service."
                  : "This is a request, not a confirmed visit. No payment is taken today."}
              </p>
            </aside>
          </div>
        )}

        {stage === "done" && created && slot && (
          <section aria-labelledby="done-heading" className="max-w-2xl space-y-5">
            {/* A confirmed booking is green with a check. A request is not confirmed yet, so it is the neutral colour with a clock: it must never read as a booking. */}
            <div role="status" className={method === "instant" ? "rounded-card border border-positive-line bg-positive-soft p-5" : "rounded-card border border-line bg-surface-low p-5"}>
              <p className={`flex items-center gap-2 ${method === "instant" ? "text-positive" : "text-primary"}`}>
                {method === "instant" ? <CircleCheck aria-hidden className="size-5" /> : <Clock aria-hidden className="size-5" />}
                <span className="text-xs font-bold tracking-wider uppercase">
                  {method === "instant" ? "Booking confirmed" : "Request received"}
                </span>
              </p>
              <h2 id="done-heading" ref={heading} tabIndex={-1} className="mt-1 text-lg font-bold text-ink focus:outline-none">
                {method === "instant"
                  ? "Instant booking confirmed"
                  : method === "request-appointment"
                    ? "Appointment request submitted"
                    : "Quote request submitted"}
              </h2>
              <p className="mt-1 text-sm text-ink">
                {method === "instant"
                  ? `Thanks, ${details.name.trim().split(/\s+/)[0]}. Your appointment for ${service.name} is booked.`
                  : `Thanks, ${details.name.trim().split(/\s+/)[0]}. We've received your request, and ${business.name} will confirm it with you.`}
              </p>
            </div>
            <dl className="space-y-3 rounded-card border border-line p-5 text-sm">
              {[
                { label: method === "instant" ? "Booking reference" : "Request reference", value: created },
                { label: "Service", value: service.name },
                { label: method === "instant" ? "Appointment" : "Requested time", value: `${formatWeekdayDate(date)} · ${formatTimeRange(slot.start, slot.end)}` },
                { label: "Service address", value: details.address.trim() },
                { label: "Price", value: formatServicePrice(service.pricing) },
              ].map((row) => (
                <div key={row.label} className="flex flex-wrap justify-between gap-x-6 gap-y-0.5">
                  <dt className="text-ink-muted">{row.label}</dt>
                  <dd className="font-medium text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="rounded-card bg-surface-low p-5 text-sm">
              <h3 className="font-semibold text-ink">What happens next</h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-ink-muted">
                <li>
                  {method === "instant"
                    ? `Your time is held on the ${business.name} schedule.`
                    : "The team reviews availability and confirms the time with you by email or phone."}
                </li>
                <li>No payment is collected online. Any invoice is handled separately after service.</li>
                {method !== "instant" && <li>Any repairs are quoted for your approval before work begins.</li>}
              </ul>
            </div>
            <Link href={homeHref} className={buttonClasses({ variant: "secondary" })}>
              Return to homepage
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
