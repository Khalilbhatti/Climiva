"use client";

import { useState } from "react";
import { FormAlert } from "@/components/auth/AuthShell";
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
  /** Resolves with the reason it failed, or nothing when it was saved (the caller then closes the dialog). */
  onConfirm: (reason: string) => Promise<string | undefined>;
};

/** Declining or cancelling needs a reason. Mount it while open so each use starts empty. */
export function ReasonDialog({ title, description, confirmLabel, keepLabel, onClose, onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const error = showError && !reason.trim() ? "Enter a reason." : undefined;

  async function confirm() {
    if (saving) return;
    if (!reason.trim()) return setShowError(true);
    setSaving(true);
    setProblem(undefined);
    const failed = await onConfirm(reason);
    setSaving(false);
    if (failed) setProblem(failed);
  }

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
          <Button variant="destructive-solid" onClick={confirm} disabled={saving}>
            {saving ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <Textarea label="Reason" required rows={3} value={reason} error={error} onChange={(event) => setReason(event.target.value)} />
      {problem && <FormAlert>{problem}</FormAlert>}
    </Modal>
  );
}
