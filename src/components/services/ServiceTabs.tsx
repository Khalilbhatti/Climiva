"use client";

import { Camera, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { IntakeQuestion } from "@/data/services";
import { BasicsFields, BookingFields, PricingFields, ServicePreview, VisibilityFields } from "./ServiceFields";
import { useServiceDraft } from "./ServiceWorkspace";

/** The five Service tabs. Each edits the shared draft from useServiceDraft(); none keeps its own copy. */

function TwoColumn({ main, aside }: { main: React.ReactNode; aside: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-8">{main}</div>
      <div className="space-y-6 lg:col-span-4">{aside}</div>
    </div>
  );
}

export function OverviewTab() {
  const { draft, update, errors } = useServiceDraft();
  return (
    <TwoColumn
      main={
        <SectionCard title="Core definitions" description="General classification and public identifiers.">
          <BasicsFields service={draft} onChange={update} errors={errors} />
        </SectionCard>
      }
      aside={
        <>
          <ServicePreview service={draft} />
          {draft.checklist && draft.checklist.length > 0 && (
            <SectionCard title="Service checklist" description="Configured per service." icon={ListChecks}>
              <ul className="space-y-2 text-sm text-ink">
                {draft.checklist.map((item) => (
                  <li key={item} className="rounded-btn bg-surface-low px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </>
      }
    />
  );
}

export function PricingTab() {
  const { draft, update, errors } = useServiceDraft();
  return (
    <TwoColumn
      main={
        <>
          <p className="rounded-card border-l-4 border-primary bg-surface p-4 text-sm text-ink-muted shadow-card">
            Pricing set here controls what customers see during online booking and on your website. Parts and repair
            labor are itemized separately on quotes and invoices.
          </p>
          <SectionCard title="Customer-facing pricing" description="How the fee is presented to the customer.">
            <PricingFields service={draft} onChange={update} errors={errors} />
          </SectionCard>
        </>
      }
      aside={<ServicePreview service={draft} />}
    />
  );
}

export function BookingSettingsTab() {
  const { draft, update, errors } = useServiceDraft();
  return (
    <TwoColumn
      main={
        <SectionCard title="Booking method & duration" description="How customers book this service and how long it takes.">
          <BookingFields service={draft} onChange={update} errors={errors} />
        </SectionCard>
      }
      aside={<ServicePreview service={draft} />}
    />
  );
}

const QUESTION_TYPE_LABEL: Record<IntakeQuestion["type"], string> = {
  "single-select": "Single select",
  "photo-upload": "Photo upload",
};

export function CustomerIntakeTab() {
  const { draft, update } = useServiceDraft();

  function setRequired(id: string, required: boolean) {
    update({ ...draft, intake: draft.intake.map((question) => (question.id === id ? { ...question, required } : question)) });
  }

  return (
    <div className="space-y-6">
      <p className="rounded-card border-l-4 border-primary bg-surface p-4 text-sm text-ink-muted shadow-card">
        Customer contact details (name, phone, email and service address) are captured automatically by the booking
        flow. The questions below collect service-specific information.
      </p>

      {draft.intake.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="No intake questions for this service"
          description="Customers are only asked for their contact details and service address when they book."
        />
      ) : (
        <ol aria-label="Intake questions" className="space-y-4">
          {draft.intake.map((question, index) => (
            <li key={question.id} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge tone="primary">Question {index + 1}</StatusBadge>
                <StatusBadge tone="neutral">{QUESTION_TYPE_LABEL[question.type]}</StatusBadge>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={question.required}
                    onChange={(event) => setRequired(question.id, event.target.checked)}
                  />
                  Required
                  <span className="sr-only"> — {question.prompt}</span>
                </label>
              </div>
              <p className="text-base font-semibold text-ink">{question.prompt}</p>
              {question.helper && <p className="mt-1 text-sm text-ink-muted">{question.helper}</p>}
              {question.options && (
                <ul aria-label="Answer choices" className="mt-3 flex flex-wrap gap-2">
                  {question.options.map((option) => (
                    <li key={option} className="rounded-btn bg-surface-low px-3 py-1.5 text-sm text-ink">
                      {option}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AvailabilityTab() {
  const { draft, update, errors } = useServiceDraft();
  return (
    <TwoColumn
      main={
        <SectionCard title="Public visibility" description="Control where customers can find and book this service.">
          <VisibilityFields service={draft} onChange={update} errors={errors} />
        </SectionCard>
      }
      aside={
        <SectionCard title="Service status">
          <p className="flex items-center gap-2 text-sm text-ink">
            <StatusBadge tone={draft.active ? "positive" : "neutral"}>{draft.active ? "Active" : "Inactive"}</StatusBadge>
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            Use {draft.active ? "Deactivate" : "Activate"} at the top of this page to change status. Opening hours and
            technician availability are managed in Settings and Team, not per service.
          </p>
        </SectionCard>
      }
    />
  );
}
