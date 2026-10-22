"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, X } from "lucide-react";
import { cardClasses } from "@/components/ui/Card";
import { gettingStartedCookie, type SetupState } from "@/lib/overview-rules";

/**
 * The first things a new business does, with how far along it is. What is done is decided on the server from the business's own records (see
 * lib/overview-rules), so a step is never ticked because someone clicked it and never stays unticked after the thing exists. The only thing kept
 * here is whether this person hid the list; that is a cookie for this person and this business in this browser (see gettingStartedCookie), read on the server so the list never flashes.
 */
export function GettingStarted({ userId, organizationId, setup }: { userId: string; organizationId: string; setup: SetupState }) {
  const router = useRouter();
  const hide = () => {
    document.cookie = `${gettingStartedCookie(userId, organizationId)}=1; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  const percent = Math.round((setup.completed / setup.total) * 100);

  return (
    <section aria-labelledby="getting-started-heading" className={cardClasses("lg", "space-y-5")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="getting-started-heading" className="text-lg font-bold tracking-tight text-ink">
            Getting started
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {setup.complete ? "Everything is set up. You can hide this list." : "Do these in any order. Each one takes a few minutes, and everything works without them."}
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label="Hide Getting started"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-btn text-ink-muted transition-colors hover:bg-surface-low hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">
          {setup.completed} of {setup.total} completed
        </p>
        <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.completed} className="h-2 overflow-hidden rounded-full bg-surface-low">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <ol aria-label="Setup steps" className="grid gap-3 md:grid-cols-2">
        {setup.steps.map((step, index) => (
          <li key={step.id}>
            <Link
              href={step.href}
              className="group flex h-full items-start gap-3 rounded-card border border-line bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-primary-subtle/40"
            >
              <span
                aria-hidden
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done ? "bg-positive text-white" : "border border-line-strong text-ink-muted"}`}
              >
                {step.done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink group-hover:text-primary">
                  {step.title}
                  {step.done && <span className="sr-only"> (done)</span>}
                </span>
                <span className="mt-0.5 block text-sm text-ink-muted">{step.done ? "Done." : step.text}</span>
              </span>
              <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted group-hover:text-primary" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
