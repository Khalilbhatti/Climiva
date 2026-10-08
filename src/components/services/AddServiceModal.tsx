"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { StepList } from "@/components/ui/StepList";
import {
  BOOKING_METHOD_LABEL,
  VISIBILITY_LABEL,
  formatAudience,
  formatDuration,
  formatServicePrice,
  type Service,
} from "@/data/services";
import { BasicsFields, BookingFields, PricingFields, ServicePreview, VisibilityFields } from "./ServiceFields";
import { useServices } from "./ServicesProvider";
import { createBlankService, createServiceId, validateService, type ServiceErrors } from "./service-state";

const STEPS = [
  { id: "basics", label: "Service basics", fields: ["name", "description", "audience"] },
  { id: "booking", label: "Booking", fields: ["duration"] },
  { id: "pricing", label: "Pricing", fields: ["amount", "priceLabel"] },
  { id: "availability", label: "Availability & visibility", fields: [] },
  { id: "review", label: "Review", fields: [] },
] as const satisfies readonly { id: string; label: string; fields: readonly (keyof ServiceErrors)[] }[];

type AddServiceModalProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (service: Service) => void;
};

/**
 * Add Service wizard. It mounts only while open, so every open starts from a blank draft and a closed
 * wizard leaves nothing in the DOM. Nothing is saved until the final step, and even then the service
 * only joins this session's in-memory catalog.
 */
export function AddServiceModal({ open, onClose, onAdd }: AddServiceModalProps) {
  return open ? <AddServiceWizard onClose={onClose} onAdd={onAdd} /> : null;
}

function AddServiceWizard({ onClose, onAdd }: Omit<AddServiceModalProps, "open">) {
  const { services } = useServices();
  const [draft, setDraft] = useState<Service>(() => createBlankService(services));
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const allErrors = validateService(draft, services);
  const stepErrors: ServiceErrors = Object.fromEntries(
    Object.entries(allErrors).filter(([key]) => (step.fields as readonly string[]).includes(key)),
  );
  const visibleErrors = showErrors ? stepErrors : {};

  // Move focus to the step heading when the step changes so screen reader users hear where they are.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  function goNext() {
    if (Object.keys(stepErrors).length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStepIndex((index) => index + 1);
  }

  function finish() {
    if (Object.keys(allErrors).length > 0) {
      // Defensive: step gating should make this unreachable. Send the user to the first failing step.
      const failing = STEPS.findIndex((candidate) => candidate.fields.some((field) => field in allErrors));
      setStepIndex(Math.max(0, failing));
      setShowErrors(true);
      return;
    }
    onAdd({
      ...draft,
      id: createServiceId(draft.name, services),
      name: draft.name.trim(),
      description: draft.description.trim(),
      internalDescription: draft.internalDescription?.trim() || undefined,
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Add new service"
      description="Configure catalog positioning, online booking rules, and pricing."
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
            <Button onClick={finish}>Add service</Button>
          ) : (
            <Button onClick={goNext}>Next: {STEPS[stepIndex + 1].label}</Button>
          )}
        </>
      }
    >
      <StepList steps={STEPS} current={stepIndex} label="Add service steps" />

      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
        {step.label}
        <span className="sr-only">
          , step {stepIndex + 1} of {STEPS.length}
        </span>
      </h3>

      {step.id === "review" ? (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
          <KeyValueList
            className="h-fit rounded-card border border-line p-4"
            items={[
              { label: "Name", value: draft.name.trim() },
              { label: "Category", value: draft.category },
              { label: "Audience", value: formatAudience(draft.audience) },
              { label: "Booking method", value: BOOKING_METHOD_LABEL[draft.bookingMethod] },
              { label: "Duration", value: formatDuration(draft.durationMinutes) },
              { label: "Pricing", value: formatServicePrice(draft.pricing) },
              { label: "Visibility", value: VISIBILITY_LABEL[draft.visibility] },
              { label: "Display order", value: draft.displayOrder },
            ]}
          />
          <ServicePreview service={draft} />
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
          <div>
            {step.id === "basics" && <BasicsFields service={draft} onChange={setDraft} errors={visibleErrors} />}
            {step.id === "booking" && <BookingFields service={draft} onChange={setDraft} errors={visibleErrors} />}
            {step.id === "pricing" && <PricingFields service={draft} onChange={setDraft} errors={visibleErrors} />}
            {step.id === "availability" && <VisibilityFields service={draft} onChange={setDraft} />}
          </div>
          <ServicePreview service={draft} />
        </div>
      )}
    </Modal>
  );
}
