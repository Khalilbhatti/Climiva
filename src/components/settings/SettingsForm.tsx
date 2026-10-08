"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { useUnsavedGuard } from "@/components/ui/UnsavedGuard";
import { cn } from "@/lib/cn";

/**
 * The working copy of one Settings section. Edits stay in the draft until saved; `dirty` drives the unsaved notice,
 * and leaving the page (any link, including the Settings tabs and the sidebar) or pressing Discard changes asks first.
 * `what` completes "your …" in the dialog, e.g. "business information".
 */
export function useSettingsDraft<T>(saved: T, same: (a: T, b: T) => boolean, what: string) {
  const [draft, setDraft] = useState<T>(saved);
  const [showErrors, setShowErrors] = useState(false);
  const dirty = !same(draft, saved);
  const { guard, confirmDiscard } = useUnsavedGuard(
    dirty,
    `your ${what}`,
    `Changes made to your ${what} have not been saved. If you leave without saving, your recent edits will be lost.`,
  );

  /** Puts the draft back to what is saved, after asking. `extra` lets a form clear its own transient state. */
  const discard = (extra?: () => void) =>
    confirmDiscard(() => {
      setDraft(saved);
      setShowErrors(false);
      extra?.();
    });

  return { draft, setDraft, dirty, showErrors, setShowErrors, guard, discard };
}

type SettingsFormProps = {
  title: string;
  description: string;
  /** Completes "You have unsaved changes to your …". */
  what: string;
  dirty: boolean;
  saveLabel: string;
  /** Returns false when the draft is not valid, which moves focus to the first field to fix. */
  onSave: () => boolean;
  onDiscard: () => void;
  guard: ReactNode;
  /** A side card shown beside the form on wide screens. */
  aside?: ReactNode;
  children: ReactNode;
};

/** The card every Settings section sits in: heading, unsaved notice, fields, and the Discard / Save buttons. */
export function SettingsForm({ title, description, what, dirty, saveLabel, onSave, onDiscard, guard, aside, children }: SettingsFormProps) {
  const headingId = useId();
  const form = useRef<HTMLFormElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    // Errors render on the next paint; move focus to the first field that has one.
    if (!onSave()) requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  }

  return (
    <div className={cn("grid items-start gap-6", Boolean(aside) && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
      <form ref={form} onSubmit={submit} noValidate aria-labelledby={headingId} className={cardClasses("lg")}>
        <div className="border-b border-line pb-4">
          <h2 id={headingId} className="text-xl font-bold tracking-tight text-ink">
            {title}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        </div>

        {dirty && (
          <div
            role="region"
            aria-label="Unsaved changes"
            className="mt-5 flex items-start gap-3 rounded-card border border-warning-line bg-warning-soft p-3 text-sm text-warning"
          >
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-semibold">Unsaved changes.</span> You have unsaved changes to your {what}.
            </p>
          </div>
        )}

        <div className="mt-6 space-y-6">{children}</div>

        <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
          <Button variant="secondary" onClick={onDiscard} disabled={!dirty}>
            Discard changes
          </Button>
          <Button type="submit" disabled={!dirty}>
            <Check aria-hidden className="size-4" />
            {saveLabel}
          </Button>
        </div>
      </form>
      {aside}
      {guard}
    </div>
  );
}

/** The quiet note under a form: what the section feeds. */
export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-card bg-surface-low p-3 text-sm text-ink-muted">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>{children}</span>
    </p>
  );
}

/** The side card: a heading and its content. */
export function AsidePanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cardClasses("lg")}>
      <h2 id={headingId} className="text-xs font-bold tracking-wider text-primary uppercase">
        {title}
      </h2>
      {description && <p className="mt-2 text-sm text-ink-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
