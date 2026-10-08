"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Power, SearchX } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TabNav } from "@/components/ui/TabNav";
import { useToast } from "@/components/ui/Toast";
import { serviceTabHref } from "@/config/routes";
import {
  BOOKING_METHOD_LABEL,
  VISIBILITY_LABEL,
  formatDuration,
  formatServicePrice,
  getServiceById,
  type Service,
} from "@/data/services";
import { useServices } from "./ServicesProvider";
import { isSameService, validateService, type ServiceErrors } from "./service-state";

type ServiceDraftValue = {
  /** The working copy every tab edits. */
  draft: Service;
  update: (next: Service) => void;
  /** Validation errors, populated only after a failed save attempt. */
  errors: ServiceErrors;
};

const ServiceDraftContext = createContext<ServiceDraftValue | null>(null);

/** Every tab reads and edits the same draft of the same Service record. */
export function useServiceDraft(): ServiceDraftValue {
  const context = useContext(ServiceDraftContext);
  if (!context) throw new Error("useServiceDraft must be used inside <ServiceWorkspace>.");
  return context;
}

/** Layout for /services/[serviceId]/*: resolves the record, then hosts the header, tabs and save bar. */
export function ServiceWorkspace({ serviceId, children }: { serviceId: string; children: ReactNode }) {
  const { services } = useServices();
  const saved = getServiceById(serviceId, services);

  if (!saved) {
    return (
      <EmptyState
        as="h1"
        icon={SearchX}
        title="Service not found"
        description="This service isn't in the catalog. Services added in this session are cleared when the page reloads."
        action={<ButtonLink href="/services">Back to Services</ButtonLink>}
      />
    );
  }
  return (
    <ServiceEditor key={saved.id} saved={saved}>
      {children}
    </ServiceEditor>
  );
}

function ServiceEditor({ saved, children }: { saved: Service; children: ReactNode }) {
  const { services, updateService } = useServices();
  const { toast } = useToast();

  const [draft, setDraft] = useState<Service>(saved);
  // Bumped on discard so tab bodies remount and drop any transient input state.
  const [version, setVersion] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const dirty = !isSameService(draft, saved);
  const errors = validateService(draft, services);
  const errorMessages = Object.values(errors);

  function save() {
    if (errorMessages.length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    updateService({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
    toast("Service changes saved for this session. Reloading restores the standard catalog.");
  }

  function discard() {
    setDraft(saved);
    setShowErrors(false);
    setVersion((current) => current + 1);
  }

  /** Status changes apply immediately to the saved record; other unsaved edits stay in the draft. */
  function setActive(active: boolean) {
    updateService({ ...saved, active });
    setDraft((current) => ({ ...current, active }));
    toast(`${saved.name} ${active ? "activated" : "deactivated"}.`);
  }

  return (
    <ServiceDraftContext value={{ draft, update: setDraft, errors: showErrors ? errors : {} }}>
      <BackLink href="/services">Back to Services</BackLink>

      <header className={`${cardClasses("lg")} flex flex-col justify-between gap-4 lg:flex-row lg:items-start`}>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{saved.name}</h1>
            <StatusBadge tone={saved.active ? "positive" : "neutral"}>{saved.active ? "Active" : "Inactive"}</StatusBadge>
            <span className="rounded-full bg-surface-low px-2.5 py-1 text-xs font-semibold text-ink-muted">
              {saved.category}
            </span>
            <span className="rounded-full bg-primary-subtle px-2.5 py-1 text-xs font-semibold text-primary">
              {VISIBILITY_LABEL[saved.visibility]}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {formatServicePrice(saved.pricing)} · {formatDuration(saved.durationMinutes)} ·{" "}
            {BOOKING_METHOD_LABEL[saved.bookingMethod]}
          </p>
        </div>
        {saved.active ? (
          <Button variant="destructive" onClick={() => setConfirmingDeactivate(true)}>
            <Power aria-hidden className="size-4" />
            Deactivate
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setActive(true)}>
            <Power aria-hidden className="size-4" />
            Activate
          </Button>
        )}
      </header>

      <TabNav
        label={`${saved.name} sections`}
        items={[
          { label: "Overview", href: serviceTabHref(saved.id, "overview") },
          { label: "Pricing", href: serviceTabHref(saved.id, "pricing") },
          { label: "Booking settings", href: serviceTabHref(saved.id, "booking-settings") },
          {
            label: "Customer intake",
            href: serviceTabHref(saved.id, "customer-intake"),
            count: saved.intake.length > 0 ? saved.intake.length : undefined,
          },
          { label: "Availability & visibility", href: serviceTabHref(saved.id, "availability") },
        ]}
      />

      <div key={version}>{children}</div>

      {dirty && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 shadow-overlay"
        >
          <div className="text-sm">
            <p className="font-semibold text-ink">You have unsaved changes</p>
            {showErrors && errorMessages.length > 0 && (
              <p role="alert" className="mt-0.5 text-xs text-danger">
                Fix before saving: {errorMessages.join(" ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={discard}>
              Discard changes
            </Button>
            <Button onClick={save}>Save changes</Button>
          </div>
        </div>
      )}

      <Modal
        open={confirmingDeactivate}
        onClose={() => setConfirmingDeactivate(false)}
        title={`Deactivate ${saved.name}?`}
        description="Deactivating hides this service from your public website and prevents new customer bookings. Existing bookings, scheduled appointments, and historical jobs keep their original service details."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingDeactivate(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive-solid"
              onClick={() => {
                setConfirmingDeactivate(false);
                setActive(false);
              }}
            >
              Deactivate service
            </Button>
          </>
        }
      />
    </ServiceDraftContext>
  );
}
