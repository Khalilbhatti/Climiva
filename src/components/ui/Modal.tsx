"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Action row, right-aligned (e.g. a secondary and a primary Button). */
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
};

const SIZE_CLASS = { md: "max-w-md", lg: "max-w-xl", xl: "max-w-3xl" } as const;

/**
 * Modal shell on the native <dialog>: focus is trapped, the page behind is inert, and focus
 * returns to the element that opened it on close. The parent owns `open`; Esc, the backdrop and × all call onClose.
 */
export function Modal({ open, onClose, title, description, children, footer, size = "md" }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // Stable callback ref: if the parent unmounts an open modal, close the <dialog> first so the
  // browser returns focus to whatever opened it.
  const setDialog = useCallback((node: HTMLDialogElement | null) => {
    dialogRef.current = node;
    if (!node) return;
    return () => {
      if (node.open) node.close();
    };
  }, []);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={setDialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Let the parent decide: cancel the native close and route Esc through onClose.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-4rem)] w-full overflow-hidden rounded-card border border-line bg-surface p-0 text-ink shadow-overlay backdrop:bg-black/40 backdrop:backdrop-blur-sm open:flex open:flex-col",
        SIZE_CLASS[size],
      )}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-base font-bold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-m-1 rounded-btn p-1 text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {children}
      </div>
      {footer && <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>}
    </dialog>
  );
}
