"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, Info } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { useSettings } from "@/components/settings/SettingsProvider";
import { useTeam } from "@/components/team/TeamProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Select } from "@/components/ui/Select";
import { StepList } from "@/components/ui/StepList";
import { Textarea } from "@/components/ui/Textarea";
import { COVERAGE, PLAN_STATUS_LABEL, type MaintenancePlan, type PlanVisit } from "@/data/maintenance-plans";
import { getServiceById } from "@/data/services";
import { getAssignableMembers, getAssignedServiceIds, getTeamMemberById } from "@/data/team";
import { getSlotGroup } from "@/lib/booking-slots";
import { formatLongDate, formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { formatDate, formatMonthYear } from "@/lib/format";
import { useMaintenancePlans } from "./MaintenancePlansProvider";
import { planCustomerName, planFullAddress, visitTitle } from "./plan-ui";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useClock } from "@/components/workspace/WorkspaceProvider";

const STEPS = [
  { id: "service", label: "Service" },
  { id: "time", label: "Date & time" },
  { id: "assignment", label: "Assignment" },
  { id: "review", label: "Review" },
] as const;

const LATER = "later";
/** Visits that name no coverage can be booked as either maintenance service (the business's own, where it has them). */
const MAINTENANCE_SERVICE_IDS = ["annual-cooling-tune-up", "furnace-safety-inspection"];

type ScheduleVisitModalProps = {
  plan: MaintenancePlan;
  visit: PlanVisit;
  onClose: () => void;
};

/**
 * Schedule an included visit. It creates one real Booking (stored in PostgreSQL like any other, which Bookings and the
 * Schedule already read) and links the visit to it, in one step on the server: the Booking is made and the visit is scheduled,
 * or neither happens. The plan reads its visit's state from that Booking, so the plan never holds a second copy that could
 * disagree. It creates no Job, Quote, Invoice or Payment: the visit is included in the plan.
 */
export function ScheduleVisitModal({ plan, visit, onClose }: ScheduleVisitModalProps) {
  const dir = useDirectory();
  const { scheduleVisit } = useMaintenancePlans();
  const { data: team } = useTeam();
  const { hours } = useSettings().settings;
  const { today } = useClock();

  // A coverage names the Service its visit is booked as, when this business has that Service; otherwise the visit is booked as
  // one of the business's own (the maintenance ones first).
  const coverageServiceId = visit.coverageId ? COVERAGE[visit.coverageId].bookingServiceId : undefined;
  const mappedServiceId = coverageServiceId && dir.services.some((item) => item.id === coverageServiceId && item.active) ? coverageServiceId : undefined;
  const active = dir.services.filter((item) => item.active);
  const maintenance = active.filter((item) => MAINTENANCE_SERVICE_IDS.includes(item.id));
  const offered = maintenance.length > 0 ? maintenance : active;
  const [serviceId, setServiceId] = useState(mappedServiceId ?? "");
  const [date, setDate] = useState("");
  const [slotId, setSlotId] = useState<string>();
  const [assignee, setAssignee] = useState(LATER);
  const [notes, setNotes] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [bookingId, setBookingId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const step = STEPS[stepIndex];
  const service = serviceId ? getServiceById(serviceId, dir.services) : undefined;
  const earliest = visit.windowStart && visit.windowStart > today ? visit.windowStart : today;
  const slotGroup = date && service ? getSlotGroup("request-appointment", date, service.durationMinutes, hours, today) : undefined;
  const slot = slotGroup?.slots.find((candidate) => candidate.id === slotId && candidate.available);
  const members = getAssignableMembers(team).filter((member) => !serviceId || getAssignedServiceIds(member, dir.services.map((item) => item.id)).includes(serviceId));

  const errors: { service?: string; date?: string; slot?: string } = {};
  if (!service) errors.service = "Select the service this visit is booked as.";
  if (!date) errors.date = "Select a service date.";
  else if (date < earliest || (visit.windowEnd && date > visit.windowEnd)) {
    errors.date = visit.windowEnd
      ? `Select a date between ${formatDate(earliest)} and ${formatDate(visit.windowEnd)}, the target window for this visit.`
      : `Select a date on or after ${formatDate(earliest)}.`;
  }
  if (!errors.date && !slot) errors.slot = "Select an available arrival window.";
  const stepErrors: Record<(typeof STEPS)[number]["id"], boolean> = {
    service: Boolean(errors.service),
    time: Boolean(errors.date || errors.slot),
    assignment: false,
    review: false,
  };

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex, bookingId]);

  function next() {
    if (stepErrors[step.id]) return setShowErrors(true);
    setShowErrors(false);
    setStepIndex((index) => index + 1);
  }

  async function create() {
    if (!service || !slot || saving) return;
    setSaving(true);
    setProblem(undefined);
    const result = await scheduleVisit(plan.id, visit.id, {
      serviceId: service.id,
      date,
      start: slot.start,
      end: slot.end,
      assigneeId: assignee === LATER ? undefined : assignee,
      internalNotes: notes,
    });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    setBookingId(result.data.booking.id);
  }

  const title = visitTitle(plan, visit);
  const technician = getTeamMemberById(assignee === LATER ? undefined : assignee, dir.team);

  /* ───────── scheduled ───────── */
  if (bookingId && slot) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Maintenance visit scheduled"
        description={`${visit.label} has been scheduled for ${planCustomerName(plan, dir)} under the ${plan.name} plan.`}
        footer={
          <>
            <Button variant="tertiary" onClick={onClose} className="mr-auto">
              Close
            </Button>
            <ButtonLink href={`/bookings?tab=upcoming&booking=${bookingId}`} onClick={onClose}>
              View booking
            </ButtonLink>
          </>
        }
      >
        <div role="status" className="space-y-4">
          <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-positive focus:outline-none">
            <CircleCheck aria-hidden className="size-5" />
            Booking #{bookingId} confirmed
          </h3>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Customer", value: planCustomerName(plan, dir) },
              { label: "Property", value: planFullAddress(plan, dir) },
              { label: "Maintenance plan", value: plan.name },
              { label: "Service", value: visit.label },
              { label: "Visit", value: `${visit.sequence} of ${plan.visitsPerYear}` },
              { label: "Scheduled arrival", value: `${formatWeekdayDate(date)}, ${formatDate(date)} · ${formatTimeRange(slot.start, slot.end)}` },
              { label: "Technician", value: technician ? `${technician.name} (${technician.role})` : "Unassigned" },
            ]}
          />
          <p className="text-xs text-ink-muted">No Job, Invoice or Payment is created by scheduling an included visit.</p>
        </div>
      </Modal>
    );
  }

  /* ───────── wizard ───────── */
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Schedule included visit"
      description={`Create a Booking for this included ${plan.name} maintenance visit.`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} className="mr-auto">
            Cancel
          </Button>
          {stepIndex > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                setShowErrors(false);
                setStepIndex((index) => index - 1);
              }}
            >
              Back
            </Button>
          )}
          {isLast ? (
            <Button onClick={create} disabled={saving}>
              {saving ? "Creating…" : "Create booking"}
            </Button>
          ) : (
            <Button onClick={next}>Next: {STEPS[stepIndex + 1].label}</Button>
          )}
        </>
      }
    >
      <StepList steps={STEPS} current={stepIndex} label="Schedule visit steps" />

      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
        {step.id === "service" && "Confirm the included service"}
        {step.id === "time" && "When should the maintenance visit happen?"}
        {step.id === "assignment" && "Who should handle it?"}
        {step.id === "review" && "Review included visit Booking"}
        <span className="sr-only">
          , step {stepIndex + 1} of {STEPS.length}
        </span>
      </h3>

      {step.id === "service" && (
        <div className="space-y-4">
          <div className="rounded-card border border-line bg-surface-low p-4">
            <p className="text-base font-semibold text-ink">
              {visit.label} · {title}
            </p>
            <KeyValueList
              className="mt-3"
              items={[
                { label: "Maintenance plan", value: `${plan.name} (${PLAN_STATUS_LABEL[plan.status]})` },
                { label: "Customer", value: planCustomerName(plan, dir) },
                { label: "Service property", value: planFullAddress(plan, dir) },
                {
                  label: "Target window",
                  value: visit.windowStart ? `Due ${formatMonthYear(visit.windowStart.slice(0, 7))}` : "No target window",
                },
                {
                  label: "Current service period",
                  value: plan.startDate && plan.endDate ? `${formatDate(plan.startDate)} – ${formatDate(plan.endDate)}` : plan.endDate ? `Until ${formatDate(plan.endDate)}` : "—",
                },
              ]}
            />
          </div>
          {!mappedServiceId && (
            <Select
              label="Service for this visit"
              required
              value={serviceId}
              hint={maintenance.length > 0 ? "Included visits are booked as one of the maintenance services." : "Included visits are booked as one of your services."}
              error={showErrors ? errors.service : undefined}
              onChange={(event) => setServiceId(event.target.value)}
            >
              <option value="">Select a service...</option>
              {offered.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
          <p className="flex items-start gap-2 rounded-card bg-primary-subtle p-3 text-sm text-ink">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            This visit is included in the Maintenance Plan. No new Invoice or Payment is created by scheduling it.
          </p>
        </div>
      )}

      {step.id === "time" && (
        <div className="space-y-5">
          <Input
            label="Service date"
            type="date"
            required
            min={earliest}
            max={visit.windowEnd}
            value={date}
            hint={visit.windowStart && visit.windowEnd ? `Target window: ${formatDate(visit.windowStart)} – ${formatDate(visit.windowEnd)}` : undefined}
            error={showErrors ? errors.date : undefined}
            onChange={(event) => {
              setDate(event.target.value);
              setSlotId(undefined);
            }}
          />
          {date && !errors.date && slotGroup && (
            <div>
              <OptionGroup legend="2-hour arrival window" hint={`${formatLongDate(date)} · technician arrives within the window you choose.`} className="sm:grid-cols-2">
                {slotGroup.slots.map((item) => (
                  <OptionCard
                    key={item.id}
                    type="radio"
                    name="visit-slot"
                    title={item.label}
                    description={item.available ? formatTimeRange(item.start, item.end) : "Unavailable"}
                    disabled={!item.available}
                    checked={slotId === item.id}
                    onChange={() => setSlotId(item.id)}
                  />
                ))}
              </OptionGroup>
              {slotGroup.unavailableReason && (
                <p className="mt-2 rounded-btn bg-surface-low px-3 py-2 text-sm text-ink-muted">{slotGroup.unavailableReason}</p>
              )}
              {showErrors && errors.slot && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {errors.slot}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {step.id === "assignment" && (
        <div className="space-y-5">
          <OptionGroup legend="Technician" hint="Assign a technician now or leave it for the Schedule.">
            {members.map((member) => (
              <OptionCard
                key={member.id}
                type="radio"
                name="visit-assignee"
                title={member.name}
                description={member.role}
                checked={assignee === member.id}
                onChange={() => setAssignee(member.id)}
              />
            ))}
            <OptionCard
              type="radio"
              name="visit-assignee"
              title="Assign later"
              description="You can assign a technician from the Schedule."
              checked={assignee === LATER}
              onChange={() => setAssignee(LATER)}
            />
          </OptionGroup>
          <Textarea label="Internal booking notes (optional)" rows={3} value={notes} hint="Visible only to your team." onChange={(event) => setNotes(event.target.value)} />
        </div>
      )}

      {step.id === "review" && service && slot && (
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-card bg-primary-subtle p-3 text-sm text-ink">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            Creating this Booking schedules the included visit. A Job is created separately when the work is prepared.
          </p>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Maintenance plan", value: `${plan.name} · ${title}` },
              { label: "Service", value: `${visit.label} (booked as ${service.name})` },
              { label: "Customer", value: planCustomerName(plan, dir) },
              { label: "Property", value: planFullAddress(plan, dir) },
              { label: "Date & arrival window", value: `${formatWeekdayDate(date)}, ${formatDate(date)} · ${formatTimeRange(slot.start, slot.end)}` },
              { label: "Technician", value: technician ? `${technician.name} (${technician.role})` : "Assign later" },
              ...(notes.trim() ? [{ label: "Internal notes", value: notes.trim() }] : []),
            ]}
          />
          {problem && <FormAlert>{problem}</FormAlert>}
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2].map((index) => (
              <Button key={index} variant="tertiary" size="sm" onClick={() => setStepIndex(index)} aria-label={`Edit ${STEPS[index].label.toLowerCase()}`}>
                Edit {STEPS[index].label.toLowerCase()}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

