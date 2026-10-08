"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bell } from "lucide-react";

/**
 * The bell. The workspace has no notification source yet, so it opens a small panel that says so, rather than being a
 * button that does nothing. Escape, a click elsewhere or the bell itself closes it; focus stays on the bell.
 */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="flex size-9 items-center justify-center rounded-btn text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
      >
        <Bell aria-hidden className="size-5" />
      </button>
      {open && (
        <div id={panelId} role="region" aria-label="Notifications" className="absolute top-full right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-4 shadow-overlay">
          <h2 className="text-sm font-semibold text-ink">Notifications</h2>
          <p className="mt-1 text-sm text-ink-muted">No new notifications.</p>
        </div>
      )}
    </div>
  );
}
