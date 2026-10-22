"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { useTeam } from "@/components/team/TeamProvider";
import { Button } from "@/components/ui/Button";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { StepList } from "@/components/ui/StepList";
import { useGuardedClose } from "@/components/ui/useGuardedClose";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/cn";
import {
  formatPropertyAddress,
  formatPropertyCityLine,
  getCustomerById,
  getPropertiesForCustomer,
  getPropertyById,
} from "@/data/customers";
import { OFFLINE_BOOKING_SOURCES, type Booking, type BookingSource } from "@/data/operations";
import {
  BOOKING_METHOD_ARRIVAL,
  BOOKING_METHOD_LABEL,
  formatDuration,
  formatServicePrice,
  getServiceById,
} from "@/data/services";
import { getAssignableMembers, getTeamMemberById } from "@/data/team";
import { getSlotGroup } from "@/lib/booking-slots";
import { addDays, formatLongDate, formatTime, formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useClock } from "@/components/workspace/WorkspaceProvider";

const STEPS = [
  { id: "customer", label: "Customer" },
  { id: "service", label: "Service & property" },
  { id: "time", label: "Date & time" },
  { id: "assignment", label: "Assignment" },
  { id: "review", label: "Review" },
] as const;

const LATER = "later";

type Draft = {
  customerId?: string;
  propertyId?: string;
  serviceId?: string;
  source: BookingSource;
  date: string;
  slotId?: string;
  assignee: string;
  notes: string;
};

type Errors = Partial<Record<"customer" | "service" | "property" | "slot", string>>;

type CreateBookingModalProps = {
  /** Preselect a customer (e.g. when opened from a customer's page). */
  presetCustomerId?: string;
  onClose: () => void;
  /** Called once a booking has been created and the user is done with the confirmation. */
  onFinished: (booking: Booking) => void;
};

/**
 * The one Create booking flow. Overview's "New booking" and the Bookings page both open this
 * (via /bookings?new=1); there is no second implementation. Nothing is saved until the last step: then the server checks the
 * customer, property, service, technician and time against the active business's records, numbers the booking and stores it.
 */
export function CreateBookingModal({ presetCustomerId, onClose, onFinished }: CreateBookingModalProps) {
  const dir = useDirectory();
  const { createBooking } = useOperations();
  const { data: team } = useTeam();
  const { hours } = useSettings().settings;
  const router = useRouter();
  const { today } = useClock();

  const preset = presetCustomerId ? getCustomerById(presetCustomerId, dir) : undefined;
  const [draft, setDraft] = useState<Draft>({
    customerId: preset?.id,
    propertyId: preset?.propertyIds[0],
    source: "Phone / Front desk",
    date: today,
    assignee: LATER,
    notes: "",
  });
  const [blank] = useState(() => JSON.stringify(draft));
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [created, setCreated] = useState<Booking | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Anything chosen or written since it opened (a customer opened from their own page counts as the starting point).
  const { close, guard } = useGuardedClose(created === null && !saving && (stepIndex > 0 || JSON.stringify(draft) !== blank), onClose, "this booking");

  const step = STEPS[stepIndex];
  const customer = draft.customerId ? getCustomerById(draft.customerId, dir) : undefined;
  const properties = customer ? getPropertiesForCustomer(customer.id, dir) : [];
  const service = draft.serviceId ? getServiceById(draft.serviceId, dir.services) : undefined;
  const slotGroup = service ? getSlotGroup(service.bookingMethod, draft.date, service.durationMinutes, hours, today) : undefined;
  const slot = slotGroup?.slots.find((candidate) => candidate.id === draft.slotId && candidate.available);

  const errors: Errors = {};
  if (!customer) errors.customer = "Select a customer.";
  if (!service) errors.service = "Select a service.";
  if (customer && properties.length > 0 && !draft.propertyId) errors.property = "Select the property for this booking.";
  if (!slot) errors.slot = "Select an available time.";

  const STEP_ERRORS: Record<(typeof STEPS)[number]["id"], (keyof Errors)[]> = {
    customer: ["customer"],
    service: ["service", "property"],
    time: ["slot"],
    assignment: [],
    review: [],
  };
  const stepHasErrors = STEP_ERRORS[step.id].some((key) => errors[key]);
  const visible = (key: keyof Errors) => (showErrors ? errors[key] : undefined);

  // Move focus to the step heading when the step changes so screen reader users hear where they are.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex, created]);

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function next() {
    if (stepHasErrors) return setShowErrors(true);
    setShowErrors(false);
    setStepIndex((index) => index + 1);
  }

  async function create() {
    if (!customer || !service || !slot || saving) return;
    setSaving(true);
    setProblem(undefined);
    const result = await createBooking({
      customerId: customer.id,
      propertyId: draft.propertyId,
      serviceId: service.id,
      source: draft.source,
      date: draft.date,
      start: slot.start,
      end: slot.end,
      assigneeId: draft.assignee === LATER ? undefined : draft.assignee,
      internalNotes: draft.notes,
    });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    setCreated(result.data.booking);
  }

  /* ───────── success ───────── */
  if (created) {
    const createdService = getServiceById(created.serviceId, dir.services);
    const createdCustomer = created.customerId ? getCustomerById(created.customerId, dir) : undefined;
    const technician = getTeamMemberById(created.assigneeId, dir.team);
    const finish = () => onFinished(created);

    return (
      <Modal
        open
        onClose={finish}
        title="Booking created"
        description="The booking is confirmed and has been added to your bookings and schedule."
        footer={
          <ModalActions onCancel={finish} cancelLabel="Close">
            <Button
              variant="secondary"
              onClick={() => {
                onFinished(created);
                router.push(`/schedule?view=day&date=${created.date}&event=${created.id}`);
              }}
            >
              View in schedule
            </Button>
            <Button onClick={finish}>View booking</Button>
          </ModalActions>
        }
      >
        <div role="status" className="space-y-4">
          <p className="flex items-center gap-2 text-base font-semibold text-positive">
            <CircleCheck aria-hidden className="size-5" />
            Appointment scheduled
          </p>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Booking ID", value: `#${created.id}` },
              { label: "Customer", value: createdCustomer?.name ?? "" },
              { label: "Service", value: createdService?.name ?? "" },
              { label: "Date & time", value: `${formatWeekdayDate(created.date)} · ${formatTimeRange(created.start, created.end)}` },
              { label: "Technician", value: technician?.name ?? "Unassigned" },
            ]}
          />
        </div>
      </Modal>
    );
  }

  /* ───────── wizard ───────── */
  const isLast = stepIndex === STEPS.length - 1;
  const dateOptions = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "In 2 days", date: addDays(today, 2) },
  ];

  return (
    <>
      <Modal
        open
        onClose={close}
        size="xl"
        title="Create booking"
        description="Add a booking received by phone, email or another offline channel."
        footer={
          <ModalActions
            onCancel={close}
            back={
              stepIndex > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowErrors(false);
                    setStepIndex((index) => index - 1);
                  }}
                >
                  Back
                </Button>
              )
            }
          >
            {isLast ? (
              <Button onClick={create} disabled={saving}>
                {saving ? "Creating…" : "Create booking"}
              </Button>
            ) : (
              <Button onClick={next}>Next: {STEPS[stepIndex + 1].label}</Button>
            )}
          </ModalActions>
        }
      >
        <StepList steps={STEPS} current={stepIndex} label="Create booking steps" />

        <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
          {step.id === "customer" && "Who is this booking for?"}
          {step.id === "service" && "What service do they need, and where?"}
          {step.id === "time" && "When should the appointment happen?"}
          {step.id === "assignment" && "Who should handle it?"}
          {step.id === "review" && "Review booking"}
          <span className="sr-only">
            , step {stepIndex + 1} of {STEPS.length}
          </span>
        </h3>

        {step.id === "customer" && (
          <div>
            <OptionGroup legend="Existing customer" hint="Select a customer from your Customers list.">
              {dir.customers.map((item) => {
                const property = getPropertyById(item.propertyIds[0], dir);
                return (
                  <OptionCard
                    key={item.id}
                    type="radio"
                    name="booking-customer"
                    title={item.name}
                    description={
                      <>
                        {item.phone} · {item.email}
                        {property && <span className="block">{formatPropertyAddress(property)}</span>}
                      </>
                    }
                    checked={draft.customerId === item.id}
                    onChange={() => update({ customerId: item.id, propertyId: item.propertyIds[0] })}
                  />
                );
              })}
            </OptionGroup>
            {visible("customer") && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {visible("customer")}
              </p>
            )}
          </div>
        )}

        {step.id === "service" && (
          <div className="space-y-6">
            <div>
              <OptionGroup legend="Service" hint="Select a service from your configured catalog.">
                {dir.services.filter((item) => item.active).map((item) => (
                  <OptionCard
                    key={item.id}
                    type="radio"
                    name="booking-service"
                    title={item.name}
                    description={
                      <>
                        {formatServicePrice(item.pricing)} · {formatDuration(item.durationMinutes)}
                        <span className="block">
                          {BOOKING_METHOD_LABEL[item.bookingMethod]} · {BOOKING_METHOD_ARRIVAL[item.bookingMethod]}
                        </span>
                      </>
                    }
                    checked={draft.serviceId === item.id}
                    onChange={() => update({ serviceId: item.id, slotId: undefined })}
                  />
                ))}
              </OptionGroup>
              {visible("service") && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {visible("service")}
                </p>
              )}
            </div>

            <div>
              <OptionGroup legend="Property" hint={`Where the service is needed for ${customer?.name ?? "this customer"}.`}>
                {properties.map((property) => (
                  <OptionCard
                    key={property.id}
                    type="radio"
                    name="booking-property"
                    title={property.street}
                    description={`${property.label} · ${formatPropertyCityLine(property)}`}
                    checked={draft.propertyId === property.id}
                    onChange={() => update({ propertyId: property.id })}
                  />
                ))}
              </OptionGroup>
              {visible("property") && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {visible("property")}
                </p>
              )}
            </div>

            <OptionGroup legend="Booking source" hint="Where this booking came from." className="sm:grid-cols-2">
              {OFFLINE_BOOKING_SOURCES.map((source) => (
                <OptionCard
                  key={source}
                  type="radio"
                  name="booking-source"
                  title={source}
                  checked={draft.source === source}
                  onChange={() => update({ source })}
                />
              ))}
            </OptionGroup>
          </div>
        )}

        {step.id === "time" && (
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-medium text-ink">Appointment date</legend>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                {dateOptions.map((option) => (
                  <Button
                    key={option.label}
                    variant={draft.date === option.date ? "primary" : "secondary"}
                    aria-pressed={draft.date === option.date}
                    onClick={() => update({ date: option.date, slotId: undefined })}
                  >
                    {option.label} · {formatWeekdayDate(option.date)}
                  </Button>
                ))}
                <div>
                  <label htmlFor="booking-date" className="mb-1 block text-xs font-medium text-ink">
                    Select date
                  </label>
                  <input
                    id="booking-date"
                    type="date"
                    min={today}
                    value={draft.date}
                    onChange={(event) => event.target.value && update({ date: event.target.value, slotId: undefined })}
                    className="rounded-btn border border-line bg-canvas px-3 py-2 text-sm text-ink focus:bg-surface focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-muted">{formatLongDate(draft.date)}</p>
            </fieldset>

            {service && slotGroup && (
              <div>
                <OptionGroup
                  legend={`${slotGroup.heading} · ${BOOKING_METHOD_LABEL[service.bookingMethod]}`}
                  hint="Appointment time is confirmed with the customer."
                  className="sm:grid-cols-2"
                >
                  {slotGroup.slots.map((item) => (
                    <OptionCard
                      key={item.id}
                      type="radio"
                      name="booking-slot"
                      title={service.bookingMethod === "instant" ? formatTime(item.start) : item.label}
                      description={item.available ? formatTimeRange(item.start, item.end) : "Unavailable"}
                      disabled={!item.available}
                      checked={draft.slotId === item.id}
                      onChange={() => update({ slotId: item.id })}
                    />
                  ))}
                </OptionGroup>
                {slotGroup.unavailableReason && (
                  <p className="mt-2 rounded-btn bg-surface-low px-3 py-2 text-sm text-ink-muted">{slotGroup.unavailableReason}</p>
                )}
                {visible("slot") && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {visible("slot")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step.id === "assignment" && (
          <div className="space-y-5">
            <OptionGroup legend="Technician" hint="Assign a team member now, or leave it for the Schedule.">
              {getAssignableMembers(team).map((member) => (
                <OptionCard
                  key={member.id}
                  type="radio"
                  name="booking-assignee"
                  title={member.name}
                  description={member.role}
                  checked={draft.assignee === member.id}
                  onChange={() => update({ assignee: member.id })}
                />
              ))}
              <OptionCard
                type="radio"
                name="booking-assignee"
                title="Assign later"
                description="You can assign a technician from the Schedule."
                checked={draft.assignee === LATER}
                onChange={() => update({ assignee: LATER })}
              />
            </OptionGroup>
            <Textarea
              label="Internal booking notes"
              rows={3}
              value={draft.notes}
              hint="Visible only to your team."
              onChange={(event) => update({ notes: event.target.value })}
            />
          </div>
        )}

        {step.id === "review" && customer && service && slot && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Verify the appointment before creating the booking.</p>
            <ReviewRow label="Customer" onEdit={() => setStepIndex(0)}>
              {customer.name}
              <span className="block text-xs font-normal text-ink-muted">
                {customer.phone} · {customer.email}
              </span>
            </ReviewRow>
            <ReviewRow label="Service & property" onEdit={() => setStepIndex(1)}>
              {service.name}
              {draft.propertyId && getPropertyById(draft.propertyId, dir) && (
                <span className="block text-xs font-normal text-ink-muted">{formatPropertyAddress(getPropertyById(draft.propertyId, dir)!)}</span>
              )}
              <span className="block text-xs font-normal text-ink-muted">Source: {draft.source}</span>
            </ReviewRow>
            <ReviewRow label="Date & time" onEdit={() => setStepIndex(2)}>
              {formatWeekdayDate(draft.date)} · {formatTimeRange(slot.start, slot.end)}
              <span className="block text-xs font-normal text-ink-muted">{BOOKING_METHOD_LABEL[service.bookingMethod]}</span>
            </ReviewRow>
            <ReviewRow label="Assignment & notes" onEdit={() => setStepIndex(3)}>
              {draft.assignee === LATER ? "Assign later" : getTeamMemberById(draft.assignee, dir.team)?.name}
              {draft.notes.trim() && <span className="block text-xs font-normal text-ink-muted">“{draft.notes.trim()}”</span>}
            </ReviewRow>
            <p className="text-xs text-ink-muted">This booking will be added directly to your schedule and booking records.</p>
            {problem && <FormAlert>{problem}</FormAlert>}
          </div>
        )}
      </Modal>
      {guard}
    </>
  );
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-card border border-line bg-surface-low p-4")}>
      <div className="text-sm font-semibold text-ink">
        <p className="mb-1 text-micro font-bold tracking-wider text-ink-muted uppercase">{label}</p>
        {children}
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${label.toLowerCase()}`}
        className="shrink-0 rounded-btn px-2 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary-subtle"
      >
        Edit
      </button>
    </div>
  );
}
