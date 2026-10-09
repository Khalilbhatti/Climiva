"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, Minus, Plus } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Select } from "@/components/ui/Select";
import { StepList } from "@/components/ui/StepList";
import { Textarea } from "@/components/ui/Textarea";
import {
  formatPropertyAddress,
  formatPropertyCityLine,
  getCustomerById,
  getPropertiesForCustomer,
  getPropertyById,
} from "@/data/customers";
import {
  COVERAGE,
  COVERAGE_IDS,
  PLAN_CADENCE_LABEL,
  PLAN_STATUS_LABEL,
  formatPlanPrice,
  getCurrentPlanForCustomer,
  type CoverageId,
  type MaintenancePlan,
  type PlanCadence,
} from "@/data/maintenance-plans";
import { formatDate } from "@/lib/format";
import { amountToCents, fromCents } from "@/lib/money";
import { useMaintenancePlans } from "./MaintenancePlansProvider";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useClock } from "@/components/workspace/WorkspaceProvider";

const STEPS = [
  { id: "customer", label: "Customer" },
  { id: "property", label: "Property" },
  { id: "coverage", label: "Coverage" },
  { id: "terms", label: "Plan terms" },
  { id: "review", label: "Review" },
] as const;

const MAX_VISITS = 4;

type Draft = {
  customerId?: string;
  propertyId?: string;
  coverage: Record<CoverageId, number>;
  name: string;
  status: "active" | "pending";
  startDate: string;
  endDate: string;
  price: string;
  cadence: PlanCadence;
  note: string;
};

type CreatePlanModalProps = {
  presetCustomerId?: string;
  onClose: () => void;
  /** Called with the new plan when the user chooses to schedule its first visit. */
  onScheduleFirstVisit: (plan: MaintenancePlan) => void;
};

/**
 * The one Create maintenance plan flow (the Maintenance Plans page and the Overview quick action both open it).
 * It stores a plan with its coverage and its visits and nothing else: no Booking, Job, Invoice or Payment. The price is
 * information about the agreement; nothing is billed.
 */
export function CreatePlanModal({ presetCustomerId, onClose, onScheduleFirstVisit }: CreatePlanModalProps) {
  const dir = useDirectory();
  const { data, createPlan } = useMaintenancePlans();
  const { today } = useClock();

  const preset = presetCustomerId ? getCustomerById(presetCustomerId, dir) : undefined;
  const [draft, setDraft] = useState<Draft>({
    customerId: preset?.id,
    propertyId: preset?.propertyIds[0],
    coverage: { cooling: 1, heating: 1 },
    name: "",
    status: "active",
    startDate: today,
    endDate: "",
    price: "",
    cadence: "year",
    note: "",
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [created, setCreated] = useState<MaintenancePlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const step = STEPS[stepIndex];
  const customer = draft.customerId ? getCustomerById(draft.customerId, dir) : undefined;
  const properties = customer ? getPropertiesForCustomer(customer.id, dir) : [];
  const property = draft.propertyId ? getPropertyById(draft.propertyId, dir) : undefined;
  const existing = customer ? getCurrentPlanForCustomer(customer.id, data) : undefined;
  const visits = COVERAGE_IDS.reduce((sum, id) => sum + draft.coverage[id], 0);
  // What was typed is read as exact cents, never as a float.
  const priceCents = amountToCents(draft.price);
  const price = priceCents === undefined ? 0 : fromCents(priceCents);

  const errors: { customer?: string; property?: string; coverage?: string; name?: string; start?: string; end?: string; price?: string } = {};
  if (!customer) errors.customer = "Select a customer.";
  if (customer && !property) errors.property = "Select the property this plan covers.";
  if (visits < 1) errors.coverage = "Include at least one maintenance visit.";
  if (!draft.name.trim()) errors.name = "Enter a plan name.";
  if (!draft.startDate) errors.start = "Enter the start date.";
  if (draft.endDate && draft.startDate && draft.endDate <= draft.startDate) errors.end = "The renewal / end date must be after the start date.";
  if (!draft.price.trim() || priceCents === undefined || priceCents <= 0) errors.price = "Enter the agreement price as an amount above $0.";
  const stepHasErrors: Record<(typeof STEPS)[number]["id"], boolean> = {
    customer: Boolean(errors.customer),
    property: Boolean(errors.property),
    coverage: Boolean(errors.coverage),
    terms: Boolean(errors.name || errors.start || errors.end || errors.price),
    review: false,
  };

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex, created]);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setVisits = (id: CoverageId, value: number) =>
    setDraft((current) => ({ ...current, coverage: { ...current.coverage, [id]: Math.min(MAX_VISITS, Math.max(0, value)) } }));

  function next() {
    if (stepHasErrors[step.id]) return setShowErrors(true);
    setShowErrors(false);
    setStepIndex((index) => index + 1);
  }

  async function create() {
    if (!customer || !property || saving) return;
    setSaving(true);
    setProblem(undefined);
    const result = await createPlan({
      customerId: customer.id,
      propertyId: property.id,
      name: draft.name,
      status: draft.status,
      coverage: draft.coverage,
      price: draft.price,
      cadence: draft.cadence,
      startDate: draft.startDate,
      endDate: draft.endDate || undefined,
      note: draft.note,
    });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    setCreated(result.data.plan);
  }

  /* ───────── created ───────── */
  if (created) {
    const createdCustomer = created.customerId ? getCustomerById(created.customerId, dir) : undefined;
    const createdProperty = created.propertyId ? getPropertyById(created.propertyId, dir) : undefined;
    return (
      <Modal
        open
        onClose={onClose}
        title="Maintenance plan created"
        description={`${created.name} has been created for ${createdCustomer?.name} at ${createdProperty?.street}.`}
        footer={
          <>
            <Button variant="tertiary" onClick={onClose} className="mr-auto">
              Close
            </Button>
            <Button variant="secondary" onClick={() => onScheduleFirstVisit(created)} disabled={created.visits.length === 0}>
              Schedule first visit
            </Button>
            <ButtonLink href={`/maintenance-plans/${created.id}`} onClick={onClose}>
              View plan
            </ButtonLink>
          </>
        }
      >
        <div role="status" className="space-y-4">
          <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-positive focus:outline-none">
            <CircleCheck aria-hidden className="size-5" />
            {created.name} is ready
          </h3>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Customer", value: createdCustomer?.name ?? "" },
              { label: "Property", value: createdProperty?.street ?? "" },
              { label: "Plan name", value: created.name },
              { label: "Status", value: PLAN_STATUS_LABEL[created.status] },
              { label: "Coverage", value: `${created.visitsPerYear} included visits / year` },
              { label: "Agreement price", value: formatPlanPrice(created) },
              { label: "Agreement term", value: `${formatDate(created.startDate!)}${created.endDate ? ` – ${formatDate(created.endDate)}` : " · open-ended"}` },
            ]}
          />
          <p className="text-xs text-ink-muted">Creating this plan does not create a Booking, Job, Invoice or Payment. Schedule the first visit when you are ready.</p>
        </div>
      </Modal>
    );
  }

  /* ───────── wizard ───────── */
  const isLast = stepIndex === STEPS.length - 1;
  const show = (message?: string) => (showErrors ? message : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Create maintenance plan"
      description="Set up recurring HVAC service coverage for a customer and property."
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
              {saving ? "Creating…" : "Create plan"}
            </Button>
          ) : (
            <Button onClick={next}>Next: {STEPS[stepIndex + 1].label}</Button>
          )}
        </>
      }
    >
      <StepList steps={STEPS} current={stepIndex} label="Create maintenance plan steps" />

      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
        {step.id === "customer" && "Who is this plan for?"}
        {step.id === "property" && "Which property is covered?"}
        {step.id === "coverage" && "What maintenance does this plan include?"}
        {step.id === "terms" && "Set the plan terms"}
        {step.id === "review" && "Review maintenance plan"}
        <span className="sr-only">
          , step {stepIndex + 1} of {STEPS.length}
        </span>
      </h3>

      {step.id === "customer" && (
        <div>
          <OptionGroup legend="Existing customer" hint="Select an existing customer from your directory.">
            {dir.customers.map((item) => {
              const home = getPropertyById(item.propertyIds[0], dir);
              return (
                <OptionCard
                  key={item.id}
                  type="radio"
                  name="plan-customer"
                  title={item.name}
                  description={
                    <>
                      {item.phone} · {item.email}
                      {home && <span className="block">{formatPropertyAddress(home)}</span>}
                    </>
                  }
                  checked={draft.customerId === item.id}
                  onChange={() => update({ customerId: item.id, propertyId: item.propertyIds[0] })}
                />
              );
            })}
          </OptionGroup>
          {show(errors.customer) && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {errors.customer}
            </p>
          )}
        </div>
      )}

      {step.id === "property" && (
        <div className="space-y-3">
          <OptionGroup legend="Property" hint={`Select one of ${customer?.name ?? "the customer"}'s service properties.`}>
            {properties.map((item) => (
              <OptionCard
                key={item.id}
                type="radio"
                name="plan-property"
                title={item.street}
                description={`${item.label} · ${formatPropertyCityLine(item)}`}
                checked={draft.propertyId === item.id}
                onChange={() => update({ propertyId: item.id })}
              />
            ))}
          </OptionGroup>
          {show(errors.property) && (
            <p role="alert" className="text-xs text-danger">
              {errors.property}
            </p>
          )}
          {existing && (
            <p role="status" className="rounded-btn bg-surface-low px-3 py-2 text-sm text-ink-muted">
              {customer?.name} already has an {PLAN_STATUS_LABEL[existing.status].toLowerCase()} plan ({existing.name}). You can still create another.
            </p>
          )}
        </div>
      )}

      {step.id === "coverage" && (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Choose the recurring maintenance visits included in this agreement.</p>
          <ul className="space-y-3">
            {COVERAGE_IDS.map((id) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-canvas p-4">
                <div>
                  <p className="text-sm font-semibold text-ink">{COVERAGE[id].name}</p>
                  <p className="text-xs text-ink-muted">{COVERAGE[id].description}</p>
                </div>
                <div role="group" aria-label={`${COVERAGE[id].name} visits per year`} className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" aria-label={`Fewer ${COVERAGE[id].name.toLowerCase()} visits`} onClick={() => setVisits(id, draft.coverage[id] - 1)} disabled={draft.coverage[id] <= 0}>
                    <Minus aria-hidden className="size-3.5" />
                  </Button>
                  <output aria-label={`${COVERAGE[id].name} visits`} className="min-w-6 text-center text-sm font-semibold text-ink">
                    {draft.coverage[id]}
                  </output>
                  <Button variant="secondary" size="sm" aria-label={`More ${COVERAGE[id].name.toLowerCase()} visits`} onClick={() => setVisits(id, draft.coverage[id] + 1)} disabled={draft.coverage[id] >= MAX_VISITS}>
                    <Plus aria-hidden className="size-3.5" />
                  </Button>
                  <span className="text-xs text-ink-muted">visits / year</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="rounded-card bg-surface-low p-3 text-sm text-ink" aria-live="polite">
            <strong>Coverage summary:</strong> {visits} included visit{visits === 1 ? "" : "s"} per year · Service period: 12 months
          </p>
          {show(errors.coverage) && (
            <p role="alert" className="text-xs text-danger">
              {errors.coverage}
            </p>
          )}
        </div>
      )}

      {step.id === "terms" && (
        <div className="space-y-4">
          <Input
            label="Plan name"
            required
            value={draft.name}
            hint="The name shown on the agreement and service records."
            error={show(errors.name)}
            onChange={(event) => update({ name: event.target.value })}
          />
          <OptionGroup legend="Initial status" hint="Paused or Ended states are managed after activation." className="sm:grid-cols-2">
            <OptionCard type="radio" name="plan-status" title="Active" checked={draft.status === "active"} onChange={() => update({ status: "active" })} />
            <OptionCard type="radio" name="plan-status" title="Pending (awaiting start)" checked={draft.status === "pending"} onChange={() => update({ status: "pending" })} />
          </OptionGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Start date" type="date" required value={draft.startDate} error={show(errors.start)} onChange={(event) => update({ startDate: event.target.value })} />
            <Input
              label="Renewal / end date"
              type="date"
              value={draft.endDate}
              hint="Leave blank for open-ended coverage."
              error={show(errors.end)}
              onChange={(event) => update({ endDate: event.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Agreement price (USD)"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              required
              value={draft.price}
              error={show(errors.price)}
              onChange={(event) => update({ price: event.target.value })}
            />
            <Select label="Price frequency" value={draft.cadence} onChange={(event) => update({ cadence: event.target.value as PlanCadence })}>
              {(Object.keys(PLAN_CADENCE_LABEL) as PlanCadence[]).map((id) => (
                <option key={id} value={id}>
                  {PLAN_CADENCE_LABEL[id]}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-ink-muted">Plan pricing describes the service agreement. Invoices and Payments are created separately.</p>
          <Textarea label="Internal note (optional)" rows={2} value={draft.note} hint="Visible only to your team." onChange={(event) => update({ note: event.target.value })} />
        </div>
      )}

      {step.id === "review" && customer && property && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">Confirm the customer, property, coverage and plan terms before creating the record.</p>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Customer", value: `${customer.name} · ${customer.phone}` },
              { label: "Covered property", value: `${formatPropertyAddress(property)} · ${property.label}` },
              {
                label: "Included coverage",
                value: `${visits} included visits / year · ${COVERAGE_IDS.filter((id) => draft.coverage[id] > 0)
                  .map((id) => `${COVERAGE[id].name}: ${draft.coverage[id]} visit${draft.coverage[id] === 1 ? "" : "s"}`)
                  .join(", ")}`,
              },
              { label: "Plan", value: `${draft.name.trim()} · ${draft.status === "active" ? "Active" : "Pending"}` },
              {
                label: "Terms",
                value: `${formatDate(draft.startDate)}${draft.endDate ? ` – ${formatDate(draft.endDate)}` : " · open-ended"} · ${formatPlanPrice({ price, cadence: draft.cadence })}`,
              },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((index) => (
              <Button key={index} variant="tertiary" size="sm" onClick={() => setStepIndex(index)} aria-label={`Edit ${STEPS[index].label.toLowerCase()}`}>
                Edit {STEPS[index].label.toLowerCase()}
              </Button>
            ))}
          </div>
          <p className="text-xs text-ink-muted">Creating this Maintenance Plan does not automatically create a Booking, Job, Invoice or Payment.</p>
          {problem && <FormAlert>{problem}</FormAlert>}
        </div>
      )}
    </Modal>
  );
}
