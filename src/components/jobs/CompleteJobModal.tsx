"use client";

import { useState } from "react";
import { Camera, Fan, Thermometer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { EQUIPMENT } from "@/data/customers";
import { getAssigneeName, getPartyName, getServiceNameFor, type Job } from "@/data/operations";

type CompleteJobModalProps = {
  job: Job;
  onClose: () => void;
  onComplete: (notes: string) => void;
};

/**
 * Confirmation before a job is marked complete: the equipment worked on, the resolution notes and
 * the photos the customer will see. Completing a job does not create a quote, invoice or payment.
 */
export function CompleteJobModal({ job, onClose, onComplete }: CompleteJobModalProps) {
  const [notes, setNotes] = useState(job.details.customerSummary ?? "");
  const [showError, setShowError] = useState(false);

  const equipment = EQUIPMENT.find((item) => item.id === job.equipmentId);
  const customerPhotos = job.files.filter((file) => file.visibility === "customer");
  const error = showError && !notes.trim() ? "Enter the resolution notes." : undefined;
  const EquipmentIcon = equipment?.kind.toLowerCase().includes("thermostat") ? Thermometer : Fan;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Complete job #${job.id}`}
      description={`${getPartyName(job)} · ${getServiceNameFor(job)} · Technician: ${getAssigneeName(job) ?? "Unassigned"}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!notes.trim()) return setShowError(true);
              onComplete(notes);
            }}
          >
            Complete job
          </Button>
        </>
      }
    >
      <h3 className="text-sm font-semibold text-ink">Work summary confirmation</h3>

      {equipment && (
        <div className="flex items-center gap-3 rounded-card bg-surface-low p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-surface text-primary">
            <EquipmentIcon aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              {equipment.manufacturer} {equipment.model}
              {equipment.capacity && ` · ${equipment.capacity}`}
            </p>
            <p className="text-xs text-ink-muted">
              Serial #{equipment.serialNumber} · Model #{equipment.modelCode}
            </p>
          </div>
        </div>
      )}

      <Textarea
        label="Technician debrief & resolution notes"
        required
        rows={5}
        value={notes}
        error={error}
        hint={error ? undefined : "Included in the customer's completion summary."}
        onChange={(event) => setNotes(event.target.value)}
      />

      <div>
        <p className="mb-2 text-xs font-medium text-ink">Customer-visible photos ({customerPhotos.length})</p>
        {customerPhotos.length === 0 ? (
          <p className="rounded-btn bg-surface-low px-3 py-2 text-sm text-ink-muted">No photos are marked customer visible.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {customerPhotos.map((file) => (
              <li key={file.id} className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-btn bg-surface-low p-2 text-center">
                <Camera aria-hidden className="size-5 text-ink-muted" />
                <span className="line-clamp-2 text-mini text-ink-muted">{file.badge ?? file.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
