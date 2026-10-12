"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type MenuAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** An action that cannot be taken now stays in the menu (so it can be found) and says why in `reason`. */
  disabled?: boolean;
  reason?: string;
  destructive?: boolean;
};

/** The height one action takes in the list, used to decide whether the list fits below its button. */
const ROW = 40;

/**
 * A small "more actions" menu: a button that opens a list of actions, usable from the keyboard (Enter, Space or the arrow keys open it, the
 * arrows, Home and End move, Escape closes and returns focus to the button) and by pointer. The list is drawn in a layer of its own at
 * the button's position, so it is never clipped by a scrolling panel that holds the button.
 */
export function ActionMenu({ label, actions, className }: { label: string; actions: readonly MenuAction[]; className?: string }) {
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const open = place !== null;

  const close = useCallback((returnFocus: boolean) => {
    setPlace(null);
    if (returnFocus) opener.current?.focus();
  }, []);

  // Where the list goes: under the button, or above it when it would not fit below.
  function show() {
    const rect = opener.current?.getBoundingClientRect();
    if (!rect) return;
    const height = actions.length * ROW + 24;
    const top = rect.bottom + 4 + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    setPlace({ top, right: Math.max(8, window.innerWidth - rect.right) });
  }

  // The first action takes focus as soon as the list is on screen.
  const listRef = useCallback((node: HTMLDivElement | null) => {
    menu.current = node;
    node?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (menu.current?.contains(target) || opener.current?.contains(target))) return;
      close(false);
    };
    const away = () => close(false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [open, close]);

  function onOpenerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show();
    }
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(true) : show())}
        onKeyDown={onOpenerKey}
        className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-btn text-ink-muted transition-colors hover:bg-surface-low hover:text-ink", className)}
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {place &&
        createPortal(
          <div
            ref={listRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            style={{ top: place.top, right: place.right }}
            className="fixed z-50 w-60 rounded-card border border-line bg-surface p-1.5 shadow-overlay"
          >
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                aria-disabled={action.disabled || undefined}
                title={action.disabled ? action.reason : undefined}
                onClick={() => {
                  if (action.disabled) return;
                  close(true);
                  action.onSelect();
                }}
                className={cn(
                  "flex w-full flex-col rounded-btn px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                  action.disabled ? "cursor-not-allowed text-ink-muted" : action.destructive ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-surface-low",
                )}
              >
                <span className="flex items-center gap-2.5 font-medium">
                  {action.icon && <action.icon aria-hidden className="size-4 shrink-0" />}
                  {action.label}
                </span>
                {action.disabled && action.reason && <span className="mt-0.5 pl-6.5 text-xs font-normal text-ink-muted">{action.reason}</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
