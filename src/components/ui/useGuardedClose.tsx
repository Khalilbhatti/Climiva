"use client";

import type { ReactNode } from "react";
import { useUnsavedGuard } from "./UnsavedGuard";

/**
 * Closing a dialog that holds typed work (Esc, the backdrop, the × and Cancel all ask to close) must not throw that work away by accident. While `dirty`, closing
 * asks the same "Discard unsaved changes?" question every other screen asks; when nothing was entered it closes at once. A dialog that has just saved calls its
 * own `onClose` directly, because by then there is nothing to lose. Render `guard` once, beside the dialog.
 */
export function useGuardedClose(dirty: boolean, onClose: () => void, what: string): { close: () => void; guard: ReactNode } {
  const { guard, confirmDiscard } = useUnsavedGuard(dirty, what, `You have started ${what}. If you close this now, what you entered will be lost.`);
  return { close: () => confirmDiscard(onClose), guard };
}
