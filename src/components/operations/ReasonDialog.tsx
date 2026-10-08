"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";

type ReasonDialogProps = {
  title: string;
  description: string;
  /** Label of the confirming button, e.g. "Decline request". */
  confirmLabel: string;
  /** Label of the dismissing button, e.g. "Keep request". */
  keepLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
};

/** Declining or cancelling needs a reason. Mount it while open so each use starts empty. */
export function ReasonDialog({ title, description, confirmLabel, keepLabel, onClose, onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [showError, setShowError] = useState(false);
  const error = showError && !reason.trim() ? "Enter a reason." : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {keepLabel}
          </Button>
          <Button
            variant="destructive-solid"
            onClick={() => {
              if (!reason.trim()) return setShowError(true);
              onConfirm(reason);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Textarea label="Reason" required rows={3} value={reason} error={error} onChange={(event) => setReason(event.target.value)} />
    </Modal>
  );
}
