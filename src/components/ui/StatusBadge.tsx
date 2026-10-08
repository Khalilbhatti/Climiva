import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Tones map to the approved status taxonomy (climvia_development_handoff):
 *  positive → Confirmed, Paid, Recorded, Published, Responded
 *  warning  → Scheduled, Pending, Unpaid, Awaiting reply
 *  danger   → Cancelled, Voided, Declined
 *  neutral  → Draft, Completed, Hidden
 *  primary  → In progress
 */
export type StatusTone = "positive" | "warning" | "danger" | "neutral" | "primary";

const tones: Record<StatusTone, { pill: string; dot: string }> = {
  positive: { pill: "border-positive-line bg-positive-soft text-positive", dot: "bg-positive" },
  warning: { pill: "border-warning-line bg-warning-soft text-warning", dot: "bg-warning" },
  danger: { pill: "border-danger-line bg-danger-soft text-danger", dot: "bg-danger" },
  neutral: { pill: "border-line bg-neutral-soft text-ink-muted", dot: "bg-ink-muted" },
  primary: { pill: "border-primary/20 bg-primary-subtle text-primary", dot: "bg-primary" },
};

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const { pill, dot } = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        pill,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      {children}
    </span>
  );
}
