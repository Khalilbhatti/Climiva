"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Button } from "./Button";
import { Modal } from "./Modal";

/**
 * Stops edits being lost silently. While `dirty`, following any link out of the page (the sidebar, a breadcrumb, a Back
 * link) asks first, and `leave(href)` does the same for a button that navigates. `confirmDiscard(action)` asks the
 * same question for a Discard button that stays on the page, and runs `action` once confirmed. The returned `guard`
 * is the dialog: render it once. `description` replaces the standard wording when a screen has its own.
 * Reloading or closing the tab is the browser's own and is not intercepted.
 */
export function useUnsavedGuard(
  dirty: boolean,
  what = "your changes",
  description?: string,
): { guard: ReactNode; leave: (href: string) => void; confirmDiscard: (action: () => void) => void } {
  const router = useRouter();
  // Either a link to follow once confirmed, or an in-page action to run.
  const [pending, setPending] = useState<{ href: string } | { action: () => void } | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ href: url.pathname + url.search + url.hash });
    };
    // Capture phase: this runs before the router's own handler on the link.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const close = () => setPending(null);

  const guard = (
    <Modal
      open={pending !== null}
      onClose={close}
      title="Discard unsaved changes?"
      description={description ?? `You have unsaved changes. If you leave now, ${what} will be lost.`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Keep editing
          </Button>
          <Button
            variant="destructive-solid"
            onClick={() => {
              const confirmed = pending;
              setPending(null);
              if (!confirmed) return;
              if ("href" in confirmed) router.push(confirmed.href as Route);
              else confirmed.action();
            }}
          >
            Discard changes
          </Button>
        </>
      }
    />
  );

  return {
    guard,
    leave: (href) => (dirty ? setPending({ href }) : router.push(href as Route)),
    confirmDiscard: (action) => (dirty ? setPending({ action }) : action()),
  };
}
