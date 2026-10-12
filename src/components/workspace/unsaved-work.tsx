"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/**
 * Which screens in this browser tab hold edits that are not saved yet. A screen with a form or an editor reports itself through
 * `useUnsavedGuard` (components/ui/UnsavedGuard), which asks before a link takes the person away. A BUTTON that leaves the workspace
 * without a link (switching to another business, logging out) cannot be caught that way, so those ask here first: nothing in one business's
 * editor can be lost, or carried into another business, silently.
 *
 * It holds only whether something is unsaved, never what: no tenant data lives in this module.
 */
const unsaved = new Set<string>();

export function setWorkDirty(id: string, dirty: boolean): void {
  if (dirty) unsaved.add(id);
  else unsaved.delete(id);
}

export const hasUnsavedWork = (): boolean => unsaved.size > 0;

/** Run an action that leaves the workspace's edits behind, after asking when some are unsaved. `modal` is the dialog: render it once. */
export function useDiscardConfirm(action: string) {
  const [pending, setPending] = useState<(() => void) | null>(null);

  // Present only while it is asked: this runs in the top bar of every page, and a closed dialog's words would otherwise be in all of them.
  const modal =
    pending === null ? null : (
      <Modal
        open
        onClose={() => setPending(null)}
        title="Discard unsaved changes?"
        description={`You have unsaved changes on this screen. If you ${action} now, they will be lost.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive-solid"
              onClick={() => {
                const run = pending;
                setPending(null);
                run?.();
              }}
            >
              Discard changes
            </Button>
          </>
        }
      />
    );

  return { run: (go: () => void) => (hasUnsavedWork() ? setPending(() => go) : go()), modal };
}
